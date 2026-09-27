import { describe, expect, it } from 'vitest';
import { Board, PATTERNS, centerPattern, decodeState, encodeState, genesisState, newGameState, planMove } from '../src/index.js';

const seeded = (seed: number) => () => {
  // mulberry32
  seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

describe('Board', () => {
  it('packs cells MSB-first, row-major', () => {
    const board = Board.empty(8, 3);
    board.set(0, 0, true);
    board.set(7, 0, true);
    board.set(1, 2, true);
    expect([...board.toBytes()]).toEqual([0x81, 0x00, 0x40]);
  });

  it('round-trips through bytes', () => {
    const board = Board.random(64, 48, 0.4, seeded(1));
    expect(Board.fromBytes(64, 48, board.toBytes()).equals(board)).toBe(true);
  });

  it('rejects sizes that do not pack into whole bytes', () => {
    expect(() => Board.empty(5, 5)).toThrow();
  });

  it('blinker oscillates with period 2', () => {
    const board = Board.fromText(8, 5, '\n.OOO');
    const next = board.next();
    expect(next.toText()).toBe(['..O.....', '..O.....', '..O.....', '........', '........'].join('\n'));
    expect(next.next().equals(board)).toBe(true);
  });

  it('block is a still life', () => {
    const board = Board.fromText(8, 4, '....\n.OO.\n.OO.');
    expect(board.next().equals(board)).toBe(true);
  });

  it('glider moves one cell diagonally every 4 generations', () => {
    let board = Board.fromText(16, 16, '.O.\n..O\nOOO');
    for (let i = 0; i < 4; i += 1) board = board.next();
    expect(board.equals(Board.fromText(16, 16, '.O.\n..O\nOOO', 1, 1))).toBe(true);
  });

  it('treats cells beyond the edges as dead (no wrap-around)', () => {
    // A vertical line on the left edge must not see the right edge as its neighbour.
    const board = Board.fromText(8, 5, 'O......O\nO......O\nO......O');
    const next = board.next();
    expect(next.toText()).toBe(['........', 'OO....OO', '........', '........', '........'].join('\n'));
  });

  it('all patterns fit on the default board', () => {
    for (const pattern of PATTERNS) {
      expect(centerPattern(Board.empty(64, 48), pattern).population()).toBeGreaterThan(0);
    }
  });
});

describe('state commitment', () => {
  it('round-trips', () => {
    const board = Board.random(64, 48, 0.3, seeded(2));
    let state = newGameState({ ...genesisState(), gameId: 41 }, board);
    state = planMove(state, board).state;
    const decoded = decodeState(encodeState(state));
    expect(decoded.gameId).toBe(42);
    expect(decoded.generation).toBe(1);
    expect(decoded.ended).toBe(false);
    expect(decoded.history.map((h) => Buffer.from(h).toString('hex')))
      .toEqual(state.history.map((h) => Buffer.from(h).toString('hex')));
    expect(encodeState(state).length).toBe(121);
  });

  it('encodes large numbers', () => {
    const state = { ...genesisState(), gameId: 70000, generation: 2_000_000_000 };
    const decoded = decodeState(encodeState(state));
    expect(decoded.gameId).toBe(70000);
    expect(decoded.generation).toBe(2_000_000_000);
  });

  it('detects the ways a game ends', () => {
    const start = (text: string) => {
      const board = Board.fromText(16, 16, text, 4, 4);
      return { board, state: newGameState(genesisState(), board) };
    };
    const run = (text: string, perMove = 1) => {
      let { board, state } = start(text);
      for (let i = 0; i < 50; i += 1) {
        const result = planMove(state, board, perMove);
        ({ state } = result);
        board = result.frames[result.frames.length - 1];
        if (result.endReason) return { reason: result.endReason, generation: state.generation };
      }
      return undefined;
    };
    expect(run('O')).toEqual({ reason: 'extinct', generation: 1 });
    expect(run('OO\nOO')).toEqual({ reason: 'still', generation: 1 });
    expect(run('OOO')).toEqual({ reason: 'oscillating', generation: 2 });
    // Bigger moves stop exactly where the game ends.
    expect(run('OOO', 5)).toEqual({ reason: 'oscillating', generation: 2 });
    expect(run('.O.\n..O\nOOO', 5)).toMatchObject({ reason: 'still' }); // the glider crashes into a corner block
  });
});
