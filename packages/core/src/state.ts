import { binToHex, hexToBin, bigIntToVmNumber, vmNumberToBigInt } from '@bitauth/libauth';
import { Board, boardDigest } from './board.js';

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

export type EndReason = 'extinct' | 'still' | 'oscillating' | 'limit';

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

/**
 * Mirror of the covenant's `step` state transition. Returns the next board, the next state and,
 * if the game ends with this move, why.
 */
export const stepState = (
  state: GameState,
  board: Board,
  maxGenerations: number,
): { board: Board; state: GameState; endReason?: EndReason } => {
  const next = board.next();
  const digest = boardDigest(next.toBytes());
  const generation = state.generation + 1;
  let endReason: EndReason | undefined;
  if (next.isEmpty()) endReason = 'extinct';
  else if (sameDigest(digest, state.history[0])) endReason = 'still';
  else if (state.history.some((h) => sameDigest(h, digest))) endReason = 'oscillating';
  else if (generation >= maxGenerations) endReason = 'limit';
  return {
    board: next,
    endReason,
    state: {
      gameId: state.gameId,
      generation,
      ended: endReason !== undefined,
      history: [digest, ...state.history.slice(0, HISTORY_DEPTH - 1)],
    },
  };
};

/** Explain why an ended game ended, given its final board and state. */
export const endReasonOf = (state: GameState, board: Board, maxGenerations: number): EndReason | undefined => {
  if (!state.ended || state.gameId === 0) return undefined;
  if (board.isEmpty()) return 'extinct';
  if (sameDigest(state.history[0], state.history[1])) return 'still';
  if (state.history.slice(1).some((h) => sameDigest(h, state.history[0]))) return 'oscillating';
  if (state.generation >= maxGenerations) return 'limit';
  return undefined;
};
