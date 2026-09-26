import {
  binToHex,
  decodeAuthenticationInstructions,
  decodeTransactionUnsafe,
  hexToBin,
  sha256,
  type TransactionCommon,
} from '@bitauth/libauth';

/** How the game's state token was spent in a transaction. */
export type MoveKind = 'step' | 'newGame' | 'genesis';

export interface ParsedMove {
  kind: MoveKind;
  /** The board revealed in the unlocking bytecode (current board for `step`, initial for `newGame`). */
  boardBytes?: Uint8Array;
}

// Function indices follow the declaration order in GameOfLife.cash.
const FUNCTIONS: Record<number, MoveKind | 'absorb'> = { 0: 'step', 1: 'newGame' };

const selectorOf = (instruction: { opcode: number; data?: Uint8Array }): number | undefined => {
  if (instruction.opcode === 0) return 0;
  if (instruction.opcode >= 0x51 && instruction.opcode <= 0x60) return instruction.opcode - 0x50;
  return undefined;
};

/**
 * Parse the unlocking bytecode of a GameOfLife input. `redeemScript` is the game contract's
 * redeem script; inputs of any other script are reported as `genesis`.
 */
export const parseGameUnlocking = (unlocking: Uint8Array, redeemScript: Uint8Array): ParsedMove => {
  const instructions = decodeAuthenticationInstructions(unlocking) as Array<{ opcode: number; data?: Uint8Array }>;
  const last = instructions[instructions.length - 1];
  if (!last?.data || binToHex(last.data) !== binToHex(redeemScript)) return { kind: 'genesis' };
  const selector = selectorOf(instructions[instructions.length - 2] ?? { opcode: -1 });
  const kind = selector === undefined ? undefined : FUNCTIONS[selector];
  if (kind !== 'step' && kind !== 'newGame') throw new Error('Unexpected game function in state input');
  return { kind, boardBytes: instructions[instructions.length - 3]?.data };
};

export const decodeTx = (hex: string): TransactionCommon => decodeTransactionUnsafe(hexToBin(hex));

export const outpointKey = (txid: string, vout: number): string => `${txid}:${vout}`;

export const txidOf = (hex: string): string =>
  binToHex(sha256.hash(sha256.hash(hexToBin(hex))).reverse());
