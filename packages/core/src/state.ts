import { binToHex, hexToBin, bigIntToVmNumber, vmNumberToBigInt } from '@bitauth/libauth';
import type { Board } from './board.js';

export const COMMITMENT_LENGTH = 121;
export const HISTORY_DEPTH = 7;
const DIGEST_LENGTH = 16;

/** Decoded NFT commitment of the game's state token. */
export interface GameState {
  /** 0 before the first game, then 1, 2, 3... */
  gameId: number;
  generation: number;
  ended: boolean;
  /** Board digests, newest (current board) first. */
  history: Uint8Array[];
}

export type EndReason = 'extinct' | 'still' | 'oscillating';

const padNumber = (value: number, length: number): Uint8Array => {
  const encoded = bigIntToVmNumber(BigInt(value));
  if (encoded.length > length) throw new Error(`Number ${value} does not fit in ${length} bytes`);
  const padded = new Uint8Array(length);
  padded.set(encoded);
  return padded;
};

const readNumber = (bytes: Uint8Array): number => {
  // OP_BIN2NUM semantics: trim trailing zero padding to the minimal encoding.
  let end = bytes.length;
  while (end > 0 && bytes[end - 1] === 0) end -= 1;
  const minimal = bytes.slice(0, end);
  const result = vmNumberToBigInt(minimal, { requireMinimalEncoding: false });
  if (typeof result === 'string') throw new Error(result);
  return Number(result);
};

export const encodeState = (state: GameState): Uint8Array => {
  if (state.history.length !== HISTORY_DEPTH) throw new Error('History must hold 7 digests');
  const bytes = new Uint8Array(COMMITMENT_LENGTH);
  bytes.set(padNumber(state.gameId, 4), 0);
  bytes.set(padNumber(state.generation, 4), 4);
  bytes[8] = state.ended ? 1 : 0;
  state.history.forEach((digest, i) => bytes.set(digest, 9 + i * DIGEST_LENGTH));
  return bytes;
};

export const decodeState = (commitment: Uint8Array | string): GameState => {
  const bytes = typeof commitment === 'string' ? hexToBin(commitment) : commitment;
  if (bytes.length !== COMMITMENT_LENGTH) {
    throw new Error(`Invalid state commitment length ${bytes.length}`);
  }
  const history: Uint8Array[] = [];
  for (let i = 0; i < HISTORY_DEPTH; i += 1) {
    history.push(bytes.slice(9 + i * DIGEST_LENGTH, 9 + (i + 1) * DIGEST_LENGTH));
  }
  return {
    gameId: readNumber(bytes.slice(0, 4)),
    generation: readNumber(bytes.slice(4, 8)),
    ended: bytes[8] === 1,
    history,
  };
};

const emptyHistory = (): Uint8Array[] => Array.from({ length: HISTORY_DEPTH }, () => new Uint8Array(DIGEST_LENGTH));

/** The state minted at deployment: no game yet, so a new game may be started right away. */
export const genesisState = (): GameState => ({ gameId: 0, generation: 0, ended: true, history: emptyHistory() });

/** State after starting a new game with `board`. */
export const newGameState = (previous: GameState, board: Board): GameState => ({
  gameId: previous.gameId + 1,
  generation: 0,
  ended: false,
  history: [board.digest(), ...emptyHistory().slice(1)],
});

const sameDigest = (a: Uint8Array, b: Uint8Array): boolean => binToHex(a) === binToHex(b);

export interface PlannedMove {
  /** Every board this move produces, one per generation; the last one is the new board. */
  frames: Board[];
  /** Generations actually advanced (fewer than requested if the game ends first). */
  generations: number;
  state: GameState;
  endReason?: EndReason;
}

/**
 * Mirror of the covenant's `play(board, generations)` for a running game: advance up to
 * `requested` generations, stopping early at the generation where the game ends (the board died
 * out or repeated one of the 7 boards before it).
 */
export const planMove = (state: GameState, board: Board, requested = 1): PlannedMove => {
  if (!Number.isInteger(requested) || requested < 1) throw new Error('A move must advance at least one generation');
  const frames: Board[] = [];
  // Digests of the boards so far, newest first (the covenant's `recent`).
  let recent = state.history;
  let current = board;
  let endReason: EndReason | undefined;
  while (frames.length < requested && !endReason) {
    current = current.next();
    frames.push(current);
    const digest = current.digest();
    if (current.isEmpty()) endReason = 'extinct';
    else if (sameDigest(digest, recent[0])) endReason = 'still';
    else if (recent.slice(0, HISTORY_DEPTH).some((h) => sameDigest(h, digest))) endReason = 'oscillating';
    recent = [digest, ...recent];
  }
  return {
    frames,
    generations: frames.length,
    endReason,
    state: {
      gameId: state.gameId,
      generation: state.generation + frames.length,
      ended: endReason !== undefined,
      history: recent.slice(0, HISTORY_DEPTH),
    },
  };
};

/** Explain why an ended game ended, given its final board and state. */
export const endReasonOf = (state: GameState, board: Board): EndReason | undefined => {
  if (!state.ended || state.gameId === 0) return undefined;
  if (board.isEmpty()) return 'extinct';
  if (sameDigest(state.history[0], state.history[1])) return 'still';
  return 'oscillating';
};
