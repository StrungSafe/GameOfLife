import { beforeEach, describe, expect, it } from 'vitest';
import { MockNetworkProvider, TransactionBuilder, randomUtxo, type Utxo } from 'cashscript';
import { binToHex } from '@bitauth/libauth';
import {
  Board,
  DEFAULT_PARAMS,
  GameClient,
  NotEnoughFundsError,
  STATE_OUTPUT_DUST,
  createDeployerKey,
  deployGame,
  deployerAddress,
  encodeState,
  loadHistory,
  mockReader,
  newGameState,
  replayGame,
  stepState,
  type GameParams,
  type GameState,
  type Snapshot,
} from '../src/index.js';

const seeded = (seed: number) => () => {
  seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const { width: W, height: H } = DEFAULT_PARAMS;

const setup = async (funding = 1_000_000n, params: GameParams = DEFAULT_PARAMS) => {
  const provider = new MockNetworkProvider();
  const key = createDeployerKey('chipnet');
  provider.addUtxo(deployerAddress(key, 'chipnet'), randomUtxo({ vout: 0, satoshis: funding }));
  const { deployment } = await deployGame({ provider, network: 'chipnet', key, params });
  const client = new GameClient(deployment, provider);
  return { provider, deployment, client };
};

/** Build a hand-crafted move so tests can try to break the rules the client respects. */
const craftMove = (
  client: GameClient,
  snapshot: Snapshot,
  options: {
    fn?: 'step' | 'newGame';
    board: Board;
    state: GameState;
    fee?: bigint;
    extraInputs?: Utxo[];
    extraOutput?: { to: string; amount: bigint };
    to?: string;
  },
) => {
  const { game, vault } = client.contracts;
  const fee = options.fee ?? 3000n;
  const inputs = [snapshot.stateUtxo, ...(options.extraInputs ?? [])];
  const total = inputs.reduce((sum, utxo) => sum + utxo.satoshis, 0n);
  const unlocker = (options.fn ?? 'step') === 'step'
    ? game.unlock.step(options.board.toBytes())
    : game.unlock.newGame(options.board.toBytes());
  const builder = new TransactionBuilder({ provider: client.provider }).addInput(snapshot.stateUtxo, unlocker);
  if (options.extraInputs?.length) builder.addInputs(options.extraInputs, vault.unlock.absorb());
  builder.addOutput({
    to: options.to ?? client.gameAddress,
    amount: total - fee - (options.extraOutput?.amount ?? 0n),
    token: {
      category: client.deployment.category,
      amount: 0n,
      nft: { capability: 'mutable', commitment: binToHex(encodeState(options.state)) },
    },
  });
  if (options.extraOutput) builder.addOutput(options.extraOutput);
  return builder;
};

describe('GameOfLife covenant', () => {
  let client: GameClient;
  let provider: MockNetworkProvider;

  beforeEach(async () => {
    ({ client, provider } = await setup());
  });

  it('deploys with no game yet and all funds in the game contract', async () => {
    const snapshot = await client.fetchSnapshot();
    expect(snapshot.state.gameId).toBe(0);
    expect(snapshot.state.ended).toBe(true);
    expect(snapshot.board).toBeNull();
    expect(snapshot.stateUtxo.satoshis).toBeGreaterThan(990_000n);
    expect(snapshot.funding.canMove).toBe(true);
  });

  it('starts a game and advances it exactly like the reference implementation', async () => {
    const initial = Board.random(W, H, 0.35, seeded(7));
    await client.newGame(initial);
    let expected = initial;
    for (let i = 1; i <= 12; i += 1) {
      const result = await client.step();
      expected = expected.next();
      expect(result.board.equals(expected)).toBe(true);
      const snapshot = await client.fetchSnapshot();
      expect(snapshot.state.generation).toBe(i);
      expect(snapshot.board!.equals(expected)).toBe(true);
    }
  });

  it('handles live cells on every edge and corner', async () => {
    const board = Board.empty(W, H);
    for (let x = 0; x < W; x += 1) { board.set(x, 0, x % 3 !== 0); board.set(x, H - 1, x % 2 === 0); }
    for (let y = 0; y < H; y += 1) { board.set(0, y, y % 3 !== 1); board.set(W - 1, y, y % 2 === 1); }
    board.set(W - 1, 0, true); board.set(0, H - 1, true); board.set(W - 1, H - 1, true);
    await client.newGame(board);
    let expected = board;
    for (let i = 0; i < 4; i += 1) {
      const result = await client.step();
      expected = expected.next();
      expect(result.board.equals(expected)).toBe(true);
      if (result.state.ended) break;
    }
  });

  it('rejects a move that claims the wrong next board', async () => {
    const initial = Board.random(W, H, 0.3, seeded(3));
    await client.newGame(initial);
    const snapshot = await client.fetchSnapshot();
    const wrong = stepState(snapshot.state, initial, DEFAULT_PARAMS.maxGenerations);
    wrong.state.history[0] = Board.random(W, H, 0.3, seeded(4)).digest();
    await expect(craftMove(client, snapshot, { board: initial, state: wrong.state }).send()).rejects.toThrow();
  });

  it('rejects a move that lies about the current board', async () => {
    const initial = Board.random(W, H, 0.3, seeded(5));
    await client.newGame(initial);
    const snapshot = await client.fetchSnapshot();
    const fake = Board.random(W, H, 0.3, seeded(6));
    const next = stepState(snapshot.state, fake, DEFAULT_PARAMS.maxGenerations);
    await expect(craftMove(client, snapshot, { board: fake, state: next.state }).send())
      .rejects.toThrow(/board does not match state/);
  });

  it('refuses to start a new game while one is running', async () => {
    const initial = Board.random(W, H, 0.3, seeded(8));
    await client.newGame(initial);
    const snapshot = await client.fetchSnapshot();
    const other = Board.random(W, H, 0.3, seeded(9));
    await expect(client.newGame(other, snapshot)).rejects.toThrow(/still running/);
    await expect(craftMove(client, snapshot, { fn: 'newGame', board: other, state: newGameState(snapshot.state, other) }).send())
      .rejects.toThrow(/game is still running/);
  });

  it('refuses to step an ended game and recovers with a new game', async () => {
    const block = Board.fromText(W, H, 'OO\nOO', 10, 10);
    await client.newGame(block);
    const result = await client.step();
    expect(result.endReason).toBe('still');
    const ended = await client.fetchSnapshot();
    expect(ended.state.ended).toBe(true);
    expect(ended.endReason).toBe('still');

    const next = stepState(ended.state, ended.board!, DEFAULT_PARAMS.maxGenerations);
    await expect(craftMove(client, ended, { board: ended.board!, state: { ...next.state, ended: false } }).send())
      .rejects.toThrow(/game has ended/);
    await expect(client.step(ended)).rejects.toThrow(/no running game/);

    const glider = Board.fromText(W, H, '.O.\n..O\nOOO', 5, 5);
    await client.newGame(glider);
    const restarted = await client.fetchSnapshot();
    expect(restarted.state.gameId).toBe(2);
    expect(restarted.state.generation).toBe(0);
    expect(restarted.state.ended).toBe(false);
    expect(restarted.board!.equals(glider)).toBe(true);
  });

  it.each([
    ['extinct', 'O', 1],
    ['still', 'OO\nOO', 1],
    ['oscillating', 'OOO', 2],
    ['oscillating', '..OOO...OOO..\n.............\nO....O.O....O\nO....O.O....O\nO....O.O....O\n..OOO...OOO..\n.............\n..OOO...OOO..\nO....O.O....O\nO....O.O....O\nO....O.O....O\n.............\n..OOO...OOO..', 3],
  ])('ends the game on-chain when it is %s', async (reason, text, generations) => {
    await client.newGame(Board.fromText(W, H, text, 20, 15));
    for (let i = 1; i <= generations; i += 1) {
      const result = await client.step();
      expect(result.state.ended).toBe(i === generations);
    }
    const snapshot = await client.fetchSnapshot();
    expect(snapshot.state.ended).toBe(true);
    expect(snapshot.endReason).toBe(reason);
  });

  it('ends the game at the generation limit', async () => {
    const limited = await setup(1_000_000n, { ...DEFAULT_PARAMS, maxGenerations: 3 });
    await limited.client.newGame(Board.fromText(W, H, '.O.\n..O\nOOO', 5, 5));
    await limited.client.step();
    await limited.client.step();
    const last = await limited.client.step();
    expect(last.endReason).toBe('limit');
    expect((await limited.client.fetchSnapshot()).endReason).toBe('limit');
  });

  it('rejects an empty initial board', async () => {
    const snapshot = await client.fetchSnapshot();
    const empty = Board.empty(W, H);
    await expect(craftMove(client, snapshot, { fn: 'newGame', board: empty, state: newGameState(snapshot.state, empty) }).send())
      .rejects.toThrow(/board is empty/);
  });

  describe('funds', () => {
    let initial: Board;
    beforeEach(async () => {
      initial = Board.random(W, H, 0.3, seeded(11));
      await client.newGame(initial);
    });

    it('pays for moves itself with a small fee', async () => {
      const before = await client.fetchSnapshot();
      await client.step(before);
      const after = await client.fetchSnapshot();
      const fee = before.stateUtxo.satoshis - after.stateUtxo.satoshis;
      const txHex = await provider.getRawTransaction(after.stateUtxo.txid);
      expect(fee).toBeGreaterThanOrEqual(BigInt(txHex.length / 2));
      expect(fee).toBeLessThan(3000n);
    });

    it('merges coins from the funding address and the game address', async () => {
      provider.addUtxo(client.fundingAddress, randomUtxo({ satoshis: 50_000n }));
      provider.addUtxo(client.fundingAddress, randomUtxo({ satoshis: 20_000n }));
      provider.addUtxo(client.contracts.game.address, randomUtxo({ satoshis: 30_000n }));
      const before = await client.fetchSnapshot();
      expect(before.funding.balance).toBe(before.stateUtxo.satoshis + 100_000n);
      await client.step(before);
      const after = await client.fetchSnapshot();
      expect(after.vaultUtxos).toHaveLength(0);
      expect(after.looseUtxos).toHaveLength(0);
      expect(after.stateUtxo.satoshis).toBeGreaterThan(before.stateUtxo.satoshis + 100_000n - 3000n);
    });

    it('rejects fees above the maximum', async () => {
      const snapshot = await client.fetchSnapshot();
      const next = stepState(snapshot.state, initial, DEFAULT_PARAMS.maxGenerations);
      await expect(craftMove(client, snapshot, { board: initial, state: next.state, fee: 6000n }).send())
        .rejects.toThrow(/fee too high/);
    });

    it('rejects moves that take coins out of the contract', async () => {
      const snapshot = await client.fetchSnapshot();
      const next = stepState(snapshot.state, initial, DEFAULT_PARAMS.maxGenerations);
      const thief = deployerAddress(createDeployerKey('chipnet'), 'chipnet');
      await expect(craftMove(client, snapshot, {
        board: initial, state: next.state, extraOutput: { to: thief, amount: 10_000n },
      }).send()).rejects.toThrow();
      await expect(craftMove(client, snapshot, {
        board: initial, state: next.state, to: client.contracts.vault.tokenAddress,
      }).send()).rejects.toThrow();
    });

    it('does not let the funding address be spent without the game', async () => {
      const coin = provider.addUtxo(client.fundingAddress, randomUtxo({ satoshis: 50_000n }));
      const thief = deployerAddress(createDeployerKey('chipnet'), 'chipnet');
      const tx = new TransactionBuilder({ provider })
        .addInput(coin, client.contracts.vault.unlock.absorb())
        .addOutput({ to: thief, amount: 49_000n });
      await expect(tx.send()).rejects.toThrow();
    });

    it('explains when the contracts need funding', async () => {
      const poor = await setup(5_000n);
      const snapshot = await poor.client.fetchSnapshot();
      expect(snapshot.funding.canMove).toBe(true);
      await poor.client.newGame(Board.random(W, H, 0.3, seeded(12)));
      const broke = await poor.client.fetchSnapshot();
      expect(broke.funding.canMove).toBe(false);
      expect(broke.funding.shortfall).toBeGreaterThan(0n);
      await expect(poor.client.step(broke)).rejects.toBeInstanceOf(NotEnoughFundsError);

      // Funding the vault brings the game back to life.
      poor.provider.addUtxo(poor.client.fundingAddress, randomUtxo({ satoshis: 10_000n }));
      const funded = await poor.client.fetchSnapshot();
      expect(funded.funding.canMove).toBe(true);
      await poor.client.step(funded);
      expect((await poor.client.fetchSnapshot()).stateUtxo.satoshis).toBeGreaterThanOrEqual(STATE_OUTPUT_DUST);
    });
  });

  it('stays within VM and standardness limits', async () => {
    await client.newGame(Board.random(W, H, 0.5, seeded(13)));
    provider.addUtxo(client.fundingAddress, randomUtxo({ satoshis: 50_000n }));
    const snapshot = await client.fetchSnapshot();
    const next = stepState(snapshot.state, snapshot.board!, DEFAULT_PARAMS.maxGenerations);
    const builder = craftMove(client, snapshot, { board: snapshot.board!, state: next.state, extraInputs: snapshot.vaultUtxos });
    const [usage] = builder.getVmResourceUsage();
    expect(usage.operationCost).toBeLessThan(usage.densityControlLength * 800);
    expect(Number(builder.getTransactionSize())).toBeLessThan(3000);
  });
});

describe('history', () => {
  it('rebuilds every game and replays it to the current state', async () => {
    const { client, provider } = await setup();
    const first = Board.fromText(W, H, 'OOO', 3, 3);
    await client.newGame(first);
    await client.step();
    await client.step(); // blinker ends after 2 generations
    const second = Board.random(W, H, 0.3, seeded(21));
    await client.newGame(second);
    for (let i = 0; i < 5; i += 1) await client.step();

    const history = await loadHistory(client, mockReader(provider));
    expect(history.games.map((game) => [game.gameId, game.generations, game.ended])).toEqual([[1, 2, true], [2, 5, false]]);
    expect(history.games[0].endReason).toBe('oscillating');
    expect(history.games[1].initialBoard.equals(second)).toBe(true);

    const frames = replayGame(history.games[1]);
    expect(frames).toHaveLength(6);
    const snapshot = await client.fetchSnapshot();
    expect(frames[5].equals(snapshot.board!)).toBe(true);
    expect(history.headTxid).toBe(snapshot.stateUtxo.txid);
  });
});

describe('board sizes', () => {
  it.each([
    [16, 16],
    [100, 60],
    [128, 96],
  ])('works for %ix%i boards', async (width, height) => {
    const { client } = await setup(1_000_000n, { ...DEFAULT_PARAMS, width, height, maxFee: 10_000 });
    const initial = Board.random(width, height, 0.35, seeded(width));
    await client.newGame(initial);
    const result = await client.step();
    expect(result.board.equals(initial.next())).toBe(true);
  });
});

describe('predicted snapshots', () => {
  it('lets moves be chained without refetching', async () => {
    const { client } = await setup();
    const initial = Board.random(W, H, 0.3, seeded(31));
    let result = await client.newGame(initial);
    for (let i = 0; i < 3; i += 1) result = await client.step(result.snapshot);
    const fetched = await client.fetchSnapshot();
    expect(fetched.stateUtxo).toEqual(result.snapshot.stateUtxo);
    expect(fetched.board!.equals(result.snapshot.board!)).toBe(true);
    expect(fetched.funding.balance).toBe(result.snapshot.funding.balance);
  });
});
