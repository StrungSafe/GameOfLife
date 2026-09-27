import { binToHex, hexToBin, sha256, type TransactionCommon } from '@bitauth/libauth';
import type { ElectrumNetworkProvider, MockNetworkProvider } from 'cashscript';
import { Board } from './board.js';
import type { GameClient } from './game.js';
import { decodeState, endReasonOf, type EndReason } from './state.js';
import { decodeTx, outpointKey, parseGameUnlocking } from './transactions.js';

/** Minimal chain access needed to rebuild the history of a game. */
export interface ChainReader {
  getRawTransaction(txid: string): Promise<string>;
  /** Every txid that created or spent an output with this locking bytecode (any order). */
  getHistory(lockingBytecode: Uint8Array): Promise<string[]>;
}

/** Optional persistent cache of raw transactions (they never change once known). */
export interface TxCache {
  get(txid: string): Promise<string | undefined> | string | undefined;
  set(txid: string, hex: string): Promise<void> | void;
}

export const electrumScriptHash = (lockingBytecode: Uint8Array): string =>
  binToHex(sha256.hash(lockingBytecode).reverse());

export const electrumReader = (provider: ElectrumNetworkProvider): ChainReader => ({
  getRawTransaction: (txid) => provider.getRawTransaction(txid),
  getHistory: async (lockingBytecode) => {
    const history = await provider.performRequest(
      'blockchain.scripthash.get_history',
      electrumScriptHash(lockingBytecode),
    ) as Array<{ tx_hash: string }>;
    return history.map((entry) => entry.tx_hash);
  },
});

/** Reader over a MockNetworkProvider, used by tests. */
export const mockReader = (provider: MockNetworkProvider): ChainReader => ({
  getRawTransaction: (txid) => provider.getRawTransaction(txid),
  getHistory: async () => Object.keys((provider as unknown as { transactionMap: Record<string, string> }).transactionMap),
});

export interface MoveRecord {
  txid: string;
  kind: 'newGame' | 'step';
  gameId: number;
  /** Generation of the board after this move. */
  generation: number;
  /** Generations this move advanced (0 for a new game). */
  generations: number;
  ended: boolean;
}

export interface GameRecord {
  gameId: number;
  startTxid: string;
  initialBoard: Board;
  /** Number of generations played so far (0 = only the initial board). */
  generations: number;
  ended: boolean;
  endReason?: EndReason;
  moves: MoveRecord[];
  finalPopulation: number;
}

export interface GameHistory {
  genesisTxid: string;
  games: GameRecord[];
  /** The txid holding the current state token. */
  headTxid: string;
}

const mapWithConcurrency = async <T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> => {
  const results: R[] = new Array(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await fn(items[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
};

/**
 * Rebuild the full history of a deployment: every game with its initial board. Boards of later
 * generations follow deterministically from the initial board (see `replayGame`).
 */
export const loadHistory = async (
  client: GameClient,
  reader: ChainReader,
  options: { cache?: TxCache; onProgress?: (done: number, total: number) => void } = {},
): Promise<GameHistory> => {
  const { deployment } = client;
  const lockingBytecode = hexToBin(client.contracts.game.lockingBytecode);
  const redeemScript = client.redeemScript();
  const txids = [...new Set(await reader.getHistory(lockingBytecode))];

  let done = 0;
  const txs = await mapWithConcurrency(txids, 8, async (txid) => {
    let hex = await options.cache?.get(txid);
    if (!hex) {
      hex = await reader.getRawTransaction(txid);
      await options.cache?.set(txid, hex);
    }
    done += 1;
    options.onProgress?.(done, txids.length);
    return { txid, tx: decodeTx(hex) };
  });

  // Index each transaction by the outpoint its first input spends (the state token is always input 0).
  const spenders = new Map<string, { txid: string; tx: TransactionCommon }>();
  let genesis: { txid: string; tx: TransactionCommon } | undefined;
  for (const entry of txs) {
    const input = entry.tx.inputs[0];
    const prevTxid = binToHex(input.outpointTransactionHash);
    spenders.set(outpointKey(prevTxid, input.outpointIndex), entry);
    const output = entry.tx.outputs[0];
    const category = output?.token ? binToHex(output.token.category) : undefined;
    if (prevTxid === deployment.category && input.outpointIndex === 0 && category === deployment.category) {
      genesis = entry;
    }
  }
  if (!genesis) throw new Error('Could not find the genesis transaction of this game');

  const games: GameRecord[] = [];
  let head = genesis;
  for (;;) {
    const spender = spenders.get(outpointKey(head.txid, 0));
    if (!spender) break;
    const move = parseGameUnlocking(spender.tx.inputs[0].unlockingBytecode, redeemScript);
    const token = spender.tx.outputs[0]?.token;
    if (move.kind === 'genesis' || !token?.nft || !move.boardBytes) break;
    const state = decodeState(token.nft.commitment);
    const record: MoveRecord = {
      txid: spender.txid,
      kind: move.kind,
      gameId: state.gameId,
      generation: state.generation,
      generations: move.generations,
      ended: state.ended,
    };
    if (move.kind === 'newGame') {
      games.push({
        gameId: state.gameId,
        startTxid: spender.txid,
        initialBoard: Board.fromBytes(deployment.width, deployment.height, move.boardBytes),
        generations: 0,
        ended: state.ended,
        moves: [record],
        finalPopulation: 0,
      });
    } else {
      const current = games[games.length - 1];
      if (!current) throw new Error('Found a step before the first game');
      current.generations = state.generation;
      current.ended = state.ended;
      current.moves.push(record);
    }
    head = spender;
  }

  for (const record of games) {
    const frames = replayGame(record);
    const last = frames[frames.length - 1];
    record.finalPopulation = last.population();
    const lastMove = record.moves[record.moves.length - 1];
    const headOutput = [...spenders.values(), genesis].find((entry) => entry.txid === lastMove.txid)?.tx.outputs[0];
    if (headOutput?.token?.nft) {
      record.endReason = endReasonOf(decodeState(headOutput.token.nft.commitment), last);
    }
  }

  return { genesisTxid: genesis.txid, games, headTxid: head.txid };
};

/** Every board of a game, from its initial board up to its latest generation. */
export const replayGame = (record: Pick<GameRecord, 'initialBoard' | 'generations'>): Board[] => {
  const frames = [record.initialBoard];
  for (let i = 0; i < record.generations; i += 1) frames.push(frames[i].next());
  return frames;
};

