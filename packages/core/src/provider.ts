import { ElectrumNetworkProvider, type NetworkProvider } from 'cashscript';
import { NETWORKS, type NetworkName } from './network.js';
import { electrumReader, type ChainReader } from './history.js';

export interface Connection {
  network: NetworkName;
  server: string;
  provider: NetworkProvider;
  reader: ChainReader;
  /** Close the WebSocket (only needed for `persistent` connections). */
  close(): Promise<void>;
}

/**
 * Connect to a Fulcrum server (WebSocket, works in browsers and Node) for `network`.
 * A `persistent` connection keeps one socket open for all requests, which is much faster for
 * apps that make many requests; otherwise a socket is opened per burst of requests.
 */
export const connect = (network: NetworkName, server?: string, options: { persistent?: boolean } = {}): Connection => {
  const hostname = server?.trim() || NETWORKS[network].servers[0];
  const provider = new ElectrumNetworkProvider(network, {
    hostname,
    manualConnectionManagement: options.persistent ?? false,
  });
  if (!options.persistent) {
    return { network, server: hostname, provider, reader: electrumReader(provider), close: async () => {} };
  }
  // Open lazily and transparently before the first request.
  let opening: Promise<void> | undefined;
  const ensureOpen = () => {
    opening ??= provider.connect().catch((error: unknown) => {
      opening = undefined;
      throw error;
    });
    return opening;
  };
  const perform = provider.performRequest.bind(provider);
  provider.performRequest = async (name: string, ...parameters: unknown[]) => {
    await ensureOpen();
    try {
      return await perform(name, ...(parameters as never[]));
    } catch (error) {
      // After a dropped socket (sleep, network change) reconnect on the next request.
      if (/connect|closed|socket|timed? ?out/i.test(error instanceof Error ? error.message : String(error))) {
        opening = undefined;
        await provider.disconnect().catch(() => undefined);
      }
      throw error;
    }
  };
  return {
    network,
    server: hostname,
    provider,
    reader: electrumReader(provider),
    close: async () => {
      if (opening) {
        opening = undefined;
        await provider.disconnect().catch(() => undefined);
      }
    },
  };
};
