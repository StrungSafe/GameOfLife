import { MockNetworkProvider, randomUtxo } from 'cashscript';
import { DEFAULT_PARAMS, type Deployment, type GameParams } from './deployment.js';
import { createDeployerKey, deployGame, deployerAddress } from './deploy.js';
import { mockReader } from './history.js';
import type { NetworkName } from './network.js';
import type { Connection } from './provider.js';

export interface Sandbox {
  connection: Connection;
  deployment: Deployment;
  /** Simulate someone sending `satoshis` to an address (e.g. the funding address). */
  donate(address: string, satoshis: bigint): void;
}

/**
 * An offline playground: the real contracts run against CashScript's in-memory mock network,
 * so every move is fully evaluated by the BCH virtual machine without spending real coins.
 */
export const createSandbox = async (
  network: NetworkName = 'chipnet',
  params: GameParams = DEFAULT_PARAMS,
  funding = 200_000n,
): Promise<Sandbox> => {
  const provider = new MockNetworkProvider();
  const key = createDeployerKey(network);
  provider.addUtxo(deployerAddress(key, network), randomUtxo({ vout: 0, satoshis: funding }));
  const { deployment } = await deployGame({ provider, network, key, params });
  return {
    connection: { network, server: 'sandbox', provider, reader: mockReader(provider), close: async () => {} },
    deployment,
    donate: (address, satoshis) => { provider.addUtxo(address, randomUtxo({ satoshis })); },
  };
};
