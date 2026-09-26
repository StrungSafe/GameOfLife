import { Contract, type NetworkProvider } from 'cashscript';
import { hexToBin } from '@bitauth/libauth';
import gameOfLifeArtifact from './artifacts/GameOfLife.js';
import gameVaultArtifact from './artifacts/GameVault.js';
import type { NetworkName } from './network.js';

/** Contract parameters shared by every deployment of this app. */
export interface GameParams {
  width: number;
  height: number;
  /** A running game ends automatically at this generation. */
  maxGenerations: number;
  /** Upper bound on the fee (in satoshis) a single move may take from the contract. */
  maxFee: number;
}

/**
 * The default board: 128 x 80 cells (1,280 bytes, 16:10 to fill landscape screens).
 * Each move reveals the whole board in the unlocking bytecode, so a move costs about
 * 820 + board bytes in fees (~2,100 sats at 1 sat/byte). The covenant itself works for any
 * size up to the 10,000 byte standard unlocking bytecode limit (tested up to 128 x 96 here
 * and uses under 20% of the VM operation budget).
 */
export const DEFAULT_PARAMS: GameParams = {
  width: 128,
  height: 80,
  maxGenerations: 1000,
  maxFee: 5000,
};

export interface Deployment extends GameParams {
  network: NetworkName;
  /** Token category of the game's state NFT (hex, as shown in explorers). */
  category: string;
}

/** Known deployments per network. Add yours here after running `gol deploy`. */
export const KNOWN_DEPLOYMENTS: Partial<Record<NetworkName, Deployment>> = {};

const isHex32 = (value: string): boolean => /^[0-9a-f]{64}$/i.test(value);

export const validateParams = (params: GameParams): void => {
  const { width, height, maxGenerations, maxFee } = params;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 3 || height < 3) {
    throw new Error('Board width and height must be integers >= 3');
  }
  if ((width * height) % 8 !== 0) throw new Error('width * height must be a multiple of 8');
  if ((width * height) / 8 > 9000) throw new Error('Board is too large for a standard transaction');
  if (!Number.isInteger(maxGenerations) || maxGenerations < 1) throw new Error('Invalid maxGenerations');
  if (!Number.isInteger(maxFee) || maxFee < 1000) throw new Error('maxFee must be at least 1000 sats');
};

export const validateDeployment = (deployment: Deployment): Deployment => {
  if (!isHex32(deployment.category)) throw new Error('Game category must be a 32-byte hex string');
  validateParams(deployment);
  return { ...deployment, category: deployment.category.toLowerCase() };
};

/** Token categories are displayed byte-reversed relative to how the VM sees them. */
export const categoryToVmBytes = (category: string): Uint8Array => hexToBin(category).reverse();

export interface GameContracts {
  game: Contract<typeof gameOfLifeArtifact>;
  vault: Contract<typeof gameVaultArtifact>;
}

export const createContracts = (deployment: Deployment, provider: NetworkProvider): GameContracts => {
  const category = categoryToVmBytes(deployment.category);
  const game = new Contract(
    gameOfLifeArtifact,
    [
      category,
      BigInt(deployment.width),
      BigInt(deployment.height),
      BigInt(deployment.maxGenerations),
      BigInt(deployment.maxFee),
    ],
    { provider, contractType: 'p2sh32' as const },
  );
  const vault = new Contract(gameVaultArtifact, [category], { provider, contractType: 'p2sh32' as const });
  return { game, vault };
};

export { gameOfLifeArtifact, gameVaultArtifact };
