import {
  binToHex,
  decodeAuthenticationInstructions,
  lockingBytecodeToCashAddress,
  sha256,
  utf8ToBin,
  type TransactionCommon,
} from '@bitauth/libauth';
import type { NetworkProvider } from 'cashscript';
import { createContracts, validateDeployment, type Deployment, type GameParams } from './deployment.js';
import { NETWORKS, type NetworkName } from './network.js';
import { encodeState, genesisState } from './state.js';
import { decodeTx } from './transactions.js';

/**
 * On-chain discovery of games.
 *
 * Every deployment's genesis transaction pays a small marker output to the registry address and
 * carries its parameters in an OP_RETURN output. Clients list all games from the registry
 * address's history, then verify each candidate against the contracts, so spam sent to the
 * registry is simply ignored.
 *
 * The registry is a P2SH32 address whose redeem script starts with OP_RETURN: nobody can ever
 * spend from it, it has no owner, and it is the same on every network.
 */
const REGISTRY_TAG = 'life-on-chain registry v1';
const REGISTRY_REDEEM_SCRIPT = Uint8Array.from([0x6a, REGISTRY_TAG.length, ...utf8ToBin(REGISTRY_TAG)]);
const hash256 = (bin: Uint8Array): Uint8Array => sha256.hash(sha256.hash(bin));

export const REGISTRY_LOCKING_BYTECODE = Uint8Array.from([0xaa, 0x20, ...hash256(REGISTRY_REDEEM_SCRIPT), 0x87]);

/** Satoshis sent to the registry by every deployment (just above the dust limit). */
export const REGISTRY_MARKER_VALUE = 800n;

export const registryAddress = (network: NetworkName): string => {
  const result = lockingBytecodeToCashAddress({ prefix: NETWORKS[network].prefix, bytecode: REGISTRY_LOCKING_BYTECODE });
  if (typeof result === 'string') throw new Error(result);
  return result.address;
};

/** Protocol identifier of the parameters OP_RETURN. */
const PARAMS_PREFIX = 'LIFE';
const PARAMS_VERSION = 1;

const uintLE = (value: number, bytes: number): string => {
  let hex = '';
  for (let i = 0; i < bytes; i += 1) hex += ((value >>> (8 * i)) & 0xff).toString(16).padStart(2, '0');
  return hex;
};

const readUintLE = (bin: Uint8Array): number => bin.reduceRight((value, byte) => value * 256 + byte, 0);

/** OP_RETURN chunks (CashScript `addOpReturnOutput` format) announcing a game's parameters. */
export const paramsOpReturnChunks = (params: GameParams): string[] => [
  PARAMS_PREFIX,
  `0x${uintLE(PARAMS_VERSION, 1)}`,
  `0x${uintLE(params.width, 2)}`,
  `0x${uintLE(params.height, 2)}`,
  `0x${uintLE(params.maxFee, 4)}`,
];

const parseParams = (tx: TransactionCommon): GameParams | undefined => {
  for (const output of tx.outputs) {
    if (output.lockingBytecode[0] !== 0x6a) continue;
    const chunks = (decodeAuthenticationInstructions(output.lockingBytecode) as Array<{ data?: Uint8Array }>)
      .slice(1)
      .map((instruction) => instruction.data ?? new Uint8Array());
    if (chunks.length < 5 || binToHex(chunks[0]) !== binToHex(utf8ToBin(PARAMS_PREFIX))) continue;
    if (readUintLE(chunks[1]) !== PARAMS_VERSION) continue;
    return { width: readUintLE(chunks[2]), height: readUintLE(chunks[3]), maxFee: readUintLE(chunks[4]) };
  }
  return undefined;
};

/**
 * Check that `tx` is a genuine genesis of a game on `network` and return its deployment.
 * `provider` is only used to derive contract addresses.
 */
export const parseGenesis = (tx: TransactionCommon, network: NetworkName, provider: NetworkProvider): Deployment | undefined => {
  try {
    const input = tx.inputs[0];
    const output = tx.outputs[0];
    if (!input || input.outpointIndex !== 0 || !output?.token?.nft) return undefined;
    const category = binToHex(input.outpointTransactionHash);
    if (binToHex(output.token.category) !== category || output.token.nft.capability !== 'mutable') return undefined;
    if (binToHex(output.token.nft.commitment) !== binToHex(encodeState(genesisState()))) return undefined;
    const params = parseParams(tx);
    if (!params) return undefined;
    const deployment = validateDeployment({ network, category, ...params });
    const { game } = createContracts(deployment, provider);
    if (binToHex(output.lockingBytecode) !== game.lockingBytecode) return undefined;
    return deployment;
  } catch {
    return undefined;
  }
};

export interface RegistryReader {
  getRawTransaction(txid: string): Promise<string>;
  getHistory(lockingBytecode: Uint8Array): Promise<string[]>;
}

/** Every valid game deployed on `network`, oldest first. */
export const discoverDeployments = async (
  network: NetworkName,
  provider: NetworkProvider,
  reader: RegistryReader,
  options: { limit?: number } = {},
): Promise<Array<{ deployment: Deployment; genesisTxid: string }>> => {
  const txids = [...new Set(await reader.getHistory(REGISTRY_LOCKING_BYTECODE))].slice(0, options.limit ?? 500);
  const found = await Promise.all(txids.map(async (txid) => {
    try {
      const tx = decodeTx(await reader.getRawTransaction(txid));
      const pays = tx.outputs.some((output) => binToHex(output.lockingBytecode) === binToHex(REGISTRY_LOCKING_BYTECODE));
      const deployment = pays ? parseGenesis(tx, network, provider) : undefined;
      return deployment ? { deployment, genesisTxid: txid } : undefined;
    } catch {
      return undefined;
    }
  }));
  const unique = new Map<string, { deployment: Deployment; genesisTxid: string }>();
  for (const entry of found) if (entry && !unique.has(entry.deployment.category)) unique.set(entry.deployment.category, entry);
  return [...unique.values()];
};
