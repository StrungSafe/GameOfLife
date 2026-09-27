import {
  binToHex,
  decodeAuthenticationInstructions,
  decodeTransactionUnsafe,
  hexToBin,
  sha256,
  vmNumberToBigInt,
  type TransactionCommon,
} from '@bitauth/libauth';

/** How the game's state token was spent in a transaction. */
export type MoveKind = 'step' | 'newGame' | 'genesis';

export interface ParsedMove {
  kind: MoveKind;
  /** The board revealed in the unlocking bytecode (current board for `step`, initial for `newGame`). */
  boardBytes?: Uint8Array;
  /** Generations advanced by a `step`. */
  generations: number;
}

type Instruction = { opcode: number; data?: Uint8Array };

const numberOf = (instruction: Instruction | undefined): number | undefined => {
  if (!instruction) return undefined;
  if (instruction.opcode === 0) return 0;
  if (instruction.opcode >= 0x51 && instruction.opcode <= 0x60) return instruction.opcode - 0x50;
  if (!instruction.data) return undefined;
  const value = vmNumberToBigInt(instruction.data, { requireMinimalEncoding: false });
  return typeof value === 'string' ? undefined : Number(value);
};

/**
 * Parse the unlocking bytecode of a GameOfLife input: `<generations> <board> <redeem script>`.
 * Inputs of any other script are reported as `genesis`.
 */
export const parseGameUnlocking = (unlocking: Uint8Array, redeemScript: Uint8Array): ParsedMove => {
  const instructions = decodeAuthenticationInstructions(unlocking) as Instruction[];
  const last = instructions[instructions.length - 1];
  if (!last?.data || binToHex(last.data) !== binToHex(redeemScript)) return { kind: 'genesis', generations: 0 };
  const boardBytes = instructions[instructions.length - 2]?.data;
  const generations = numberOf(instructions[instructions.length - 3]);
  if (!boardBytes || generations === undefined || generations < 0) throw new Error('Malformed game move');
  return { kind: generations === 0 ? 'newGame' : 'step', boardBytes, generations };
};

export const decodeTx = (hex: string): TransactionCommon => decodeTransactionUnsafe(hexToBin(hex));

export const outpointKey = (txid: string, vout: number): string => `${txid}:${vout}`;

export const txidOf = (hex: string): string =>
  binToHex(sha256.hash(sha256.hash(hexToBin(hex))).reverse());
