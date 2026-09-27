import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  NETWORKS,
  validateDeployment,
  type Deployment,
  type NetworkName,
  type TxCache,
} from '@gol/core';

export interface CliConfig {
  network: NetworkName;
  /** Custom Fulcrum server per network. */
  servers: Partial<Record<NetworkName, string>>;
  /** The game to play per network (otherwise the most active game found on chain). */
  deployments: Partial<Record<NetworkName, Deployment>>;
  /** Throwaway deployer keys (WIF) per network, kept until a deployment succeeds. */
  deployerKeys: Partial<Record<NetworkName, string>>;
}

export const CONFIG_DIR = process.env.GOL_HOME ?? join(homedir(), '.gol-bch');
const CONFIG_FILE = join(CONFIG_DIR, 'config.json');

const defaults = (): CliConfig => ({ network: 'chipnet', servers: {}, deployments: {}, deployerKeys: {} });

export const loadConfig = (): CliConfig => {
  if (!existsSync(CONFIG_FILE)) return defaults();
  try {
    return { ...defaults(), ...JSON.parse(readFileSync(CONFIG_FILE, 'utf8')) };
  } catch {
    return defaults();
  }
};

export const saveConfig = (config: CliConfig): void => {
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
};

export const configPath = (): string => CONFIG_FILE;

export const deploymentFor = (config: CliConfig, network: NetworkName): Deployment | undefined => {
  const deployment = config.deployments[network];
  return deployment ? validateDeployment(deployment) : undefined;
};

export const serverFor = (config: CliConfig, network: NetworkName): string =>
  config.servers[network] ?? NETWORKS[network].servers[0];

/** Raw transactions never change, so they are cached on disk to make replays fast. */
export const fileTxCache = (deployment: Deployment): TxCache & { flush(): void } => {
  const dir = join(CONFIG_DIR, 'cache');
  const file = join(dir, `${deployment.network}-${deployment.category.slice(0, 16)}.json`);
  let entries: Record<string, string> = {};
  if (existsSync(file)) {
    try { entries = JSON.parse(readFileSync(file, 'utf8')); } catch { entries = {}; }
  }
  let dirty = false;
  return {
    get: (txid) => entries[txid],
    set: (txid, hex) => { entries[txid] = hex; dirty = true; },
    flush: () => {
      if (!dirty) return;
      mkdirSync(dir, { recursive: true });
      writeFileSync(file, JSON.stringify(entries));
      dirty = false;
    },
  };
};
