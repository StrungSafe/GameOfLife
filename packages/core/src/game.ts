import { TransactionBuilder, type NetworkProvider, type Utxo } from 'cashscript';
import { binToHex, hexToBin } from '@bitauth/libauth';
import { Board } from './board.js';
import { createContracts, type Deployment, type GameContracts } from './deployment.js';
import {
  decodeState,
  encodeState,
  endReasonOf,
  newGameState,
  planMove,
  type EndReason,
  type GameState,
} from './state.js';
import { decodeTx, parseGameUnlocking } from './transactions.js';

/** Fee rate used for moves, in satoshis per byte (the network minimum is 1). */
export const FEE_RATE = 1;
/** Extra satoshis added on top of the exact size-based fee. */
const FEE_MARGIN = 2n;
/** At most this many funding coins are merged into the game per move. */
export const MAX_FUNDING_INPUTS = 20;
/**
 * Most generations a single move advances. A move costs the same whatever it advances, so
 * bigger moves are cheaper per generation; the limit keeps each move within the VM's
 * operation budget with room to spare (9 is the most that fits a 128 x 80 board).
 */
export const MAX_GENERATIONS_PER_MOVE = 8;

/** Dust limit of the state output (token prefix with a 121-byte commitment, P2SH32). */
export const STATE_OUTPUT_DUST = BigInt(444 + 3 * (8 + 3 + 1 + 32 + 1 + 1 + 121 + 35));

export interface FundingStatus {
  /** Every satoshi the game can spend: the state token plus the coins at the funding address. */
  balance: bigint;
  /** Fee of the next move. */
  moveFee: bigint;
  /** The state output must keep at least this much. */
  reserve: bigint;
  /** Whether the next move is affordable. */
  canMove: boolean;
  /** Rough number of moves the current balance pays for. */
  movesLeft: number;
  /** Satoshis missing for the next move (0 when affordable). */
  shortfall: bigint;
}

export interface Snapshot {
  deployment: Deployment;
  stateUtxo: Utxo;
  state: GameState;
  /** The current board, or null before the very first game. */
  board: Board | null;
  endReason?: EndReason;
  /** Coins waiting at the funding (vault) address. */
  vaultUtxos: Utxo[];
  funding: FundingStatus;
}

export interface MoveResult {
  txid: string;
  fee: bigint;
  /** The new board. */
  board: Board;
  /** Every board the move went through, one per generation (just the board for a new game). */
  frames: Board[];
  /** Generations advanced (0 for a new game). */
  generations: number;
  state: GameState;
  endReason?: EndReason;
  /** Predicted snapshot after this move (valid as soon as the transaction is accepted). */
  snapshot: Snapshot;
}

export class NotEnoughFundsError extends Error {
  constructor(readonly funding: FundingStatus, readonly fundingAddress: string) {
    super(`Not enough funds in the game contracts: ${funding.shortfall} more satoshis are needed. `
      + `Send BCH to the funding address ${fundingAddress}.`);
    this.name = 'NotEnoughFundsError';
  }
}

const sum = (utxos: Utxo[]): bigint => utxos.reduce((total, utxo) => total + utxo.satoshis, 0n);

export class GameClient {
  readonly contracts: GameContracts;

  constructor(readonly deployment: Deployment, readonly provider: NetworkProvider) {
    this.contracts = createContracts(deployment, provider);
  }

  /** Token-aware address holding the game's state NFT. */
  get gameAddress(): string {
    return this.contracts.game.tokenAddress;
  }

  /** Where anyone can send BCH to fund future moves. */
  get fundingAddress(): string {
    return this.contracts.vault.address;
  }

  /** Every address of this deployment, for display. */
  addresses(): { label: string; address: string; description: string }[] {
    return [
      { label: 'Funding address', address: this.fundingAddress, description: 'Send BCH here from any wallet to pay for moves.' },
      { label: 'Game contract', address: this.gameAddress, description: 'Holds the game state token. Do not send BCH here - use the funding address.' },
    ];
  }

  private isStateToken(utxo: Utxo): boolean {
    return utxo.token?.category === this.deployment.category && utxo.token.nft?.capability === 'mutable';
  }

  /** Load the current state, board and funding of the game. */
  async fetchSnapshot(): Promise<Snapshot> {
    const [gameUtxos, vaultUtxos] = await Promise.all([
      this.provider.getUtxos(this.contracts.game.address),
      this.provider.getUtxos(this.contracts.vault.address),
    ]);
    const stateUtxo = gameUtxos.find((utxo) => this.isStateToken(utxo));
    if (!stateUtxo) {
      throw new Error(`Game state token ${this.deployment.category} was not found on ${this.deployment.network}. `
        + 'Check the network and game in the settings.');
    }
    const state = decodeState(stateUtxo.token!.nft!.commitment);
    const board = await this.boardOf(stateUtxo, state);
    const snapshot: Snapshot = {
      deployment: this.deployment,
      stateUtxo,
      state,
      board,
      endReason: board ? endReasonOf(state, board) : undefined,
      vaultUtxos: vaultUtxos.filter((utxo) => !utxo.token),
      funding: undefined as unknown as FundingStatus,
    };
    snapshot.funding = this.fundingStatus(snapshot);
    return snapshot;
  }

  /** Reconstruct the board of a state UTXO from the transaction that created it. */
  private async boardOf(stateUtxo: Utxo, state: GameState): Promise<Board | null> {
    if (state.gameId === 0) return null;
    const tx = decodeTx(await this.provider.getRawTransaction(stateUtxo.txid));
    const move = parseGameUnlocking(tx.inputs[0].unlockingBytecode, this.redeemScript());
    if (!move.boardBytes) throw new Error('Could not find the board in the state transaction');
    let board = Board.fromBytes(this.deployment.width, this.deployment.height, move.boardBytes);
    for (let i = 0; i < move.generations; i += 1) board = board.next();
    if (binToHex(board.digest()) !== binToHex(state.history[0])) {
      throw new Error('The reconstructed board does not match the on-chain state');
    }
    return board;
  }

  redeemScript(): Uint8Array {
    return hexToBin(this.contracts.game.bytecode);
  }

  private fundingInputs(snapshot: Snapshot): Utxo[] {
    return [...snapshot.vaultUtxos].sort((a, b) => Number(b.satoshis - a.satoshis)).slice(0, MAX_FUNDING_INPUTS);
  }

  /** Build a move; `fee` of null builds a sizing draft with a placeholder output amount. */
  private buildMove(snapshot: Snapshot, board: Board, generations: number, nextState: GameState, fee: bigint | null): TransactionBuilder {
    const { game, vault } = this.contracts;
    const funding = this.fundingInputs(snapshot);
    const builder = new TransactionBuilder({ provider: this.provider })
      .addInput(snapshot.stateUtxo, game.unlock.play(board.toBytes(), BigInt(generations)));
    if (funding.length) builder.addInputs(funding, vault.unlock.absorb());
    return builder.addOutput({
      to: this.gameAddress,
      amount: fee === null ? 100_000n : sum([snapshot.stateUtxo, ...funding]) - fee,
      token: {
        category: this.deployment.category,
        amount: 0n,
        nft: { capability: 'mutable', commitment: binToHex(encodeState(nextState)) },
      },
    });
  }

  /** Exact fee for a move, from the size of the fully built transaction. */
  private moveFee(snapshot: Snapshot, board: Board, generations: number, nextState: GameState): bigint {
    const size = this.buildMove(snapshot, board, generations, nextState, null).getTransactionSize();
    return BigInt(Math.ceil(Number(size) * FEE_RATE)) + FEE_MARGIN;
  }

  /** Estimate what the next move costs and whether the contracts can afford it. */
  fundingStatus(snapshot: Snapshot): FundingStatus {
    const balance = sum([snapshot.stateUtxo, ...snapshot.vaultUtxos]);
    const spendable = sum([snapshot.stateUtxo, ...this.fundingInputs(snapshot)]);
    const sample = snapshot.board ?? Board.empty(this.deployment.width, this.deployment.height);
    const moveFee = this.moveFee(snapshot, sample, 1, snapshot.state);
    const reserve = STATE_OUTPUT_DUST;
    const shortfall = spendable - moveFee >= reserve ? 0n : reserve + moveFee - spendable;
    // A move without funding inputs is a little cheaper; use it for the long-run estimate.
    const plainFee = BigInt(920 + (this.deployment.width * this.deployment.height) / 8);
    const movesLeft = balance > reserve ? Number((balance - reserve) / plainFee) : 0;
    return { balance, moveFee, reserve, canMove: shortfall === 0n, movesLeft, shortfall };
  }

  /**
   * Broadcast a move and predict the snapshot it produces, so callers can chain moves right away
   * without waiting for the indexer to see the new transaction.
   */
  private async sendMove(
    snapshot: Snapshot,
    board: Board,
    generations: number,
    nextState: GameState,
    frames: Board[],
    endReason?: EndReason,
  ): Promise<MoveResult> {
    const fee = this.moveFee(snapshot, board, generations, nextState);
    const funding = this.fundingInputs(snapshot);
    const spendable = sum([snapshot.stateUtxo, ...funding]);
    if (fee > BigInt(this.deployment.maxFee)) throw new Error(`Move fee ${fee} exceeds the contract's maximum fee`);
    if (spendable - fee < STATE_OUTPUT_DUST) {
      const status = { ...snapshot.funding, canMove: false, shortfall: STATE_OUTPUT_DUST + fee - spendable };
      throw new NotEnoughFundsError(status, this.fundingAddress);
    }
    const details = await this.buildMove(snapshot, board, generations, nextState, fee).send();
    const spent = new Set(funding);
    const nextBoard = frames[frames.length - 1];
    const next: Snapshot = {
      deployment: this.deployment,
      stateUtxo: {
        txid: details.txid,
        vout: 0,
        satoshis: spendable - fee,
        token: {
          category: this.deployment.category,
          amount: 0n,
          nft: { capability: 'mutable', commitment: binToHex(encodeState(nextState)) },
        },
      },
      state: nextState,
      board: nextBoard,
      endReason,
      vaultUtxos: snapshot.vaultUtxos.filter((utxo) => !spent.has(utxo)),
      funding: undefined as unknown as FundingStatus,
    };
    next.funding = this.fundingStatus(next);
    return { txid: details.txid, fee, snapshot: next, board: nextBoard, frames, generations, state: nextState, endReason };
  }

  /**
   * Advance the running game by up to `generations` generations in one transaction (capped at
   * MAX_GENERATIONS_PER_MOVE, and stopping exactly where the game ends).
   */
  async step(snapshot?: Snapshot, generations = 1): Promise<MoveResult> {
    const current = snapshot ?? await this.fetchSnapshot();
    if (!current.board || current.state.ended) {
      throw new Error('There is no running game. Start a new game first.');
    }
    const plan = planMove(current.state, current.board, Math.min(Math.max(1, generations), MAX_GENERATIONS_PER_MOVE));
    return this.sendMove(current, current.board, plan.generations, plan.state, plan.frames, plan.endReason);
  }

  /** Start a new game with `board` as generation 0. Only allowed once the previous game ended. */
  async newGame(board: Board, snapshot?: Snapshot): Promise<MoveResult> {
    const current = snapshot ?? await this.fetchSnapshot();
    if (!current.state.ended) throw new Error('The current game is still running.');
    if (board.width !== this.deployment.width || board.height !== this.deployment.height) {
      throw new Error(`The board must be ${this.deployment.width}x${this.deployment.height}`);
    }
    if (board.isEmpty()) throw new Error('The board is empty. Bring some cells to life first.');
    return this.sendMove(current, board, 0, newGameState(current.state, board), [board.clone()]);
  }
}
