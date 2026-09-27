import type { NetworkProvider } from 'cashscript';
import type { Deployment } from './deployment.js';
import { GameClient, type Snapshot } from './game.js';
import type { NetworkName } from './network.js';
import { discoverDeployments, type RegistryReader } from './registry.js';

export interface DiscoveredGame {
  deployment: Deployment;
  genesisTxid: string;
  /** Current state, if it could be loaded. */
  snapshot?: Snapshot;
  error?: string;
}

/** Running games first, then the most advanced, then the best funded. */
const activity = (game: DiscoveredGame): number[] => {
  const snapshot = game.snapshot;
  if (!snapshot) return [-1, 0, 0, 0];
  const running = snapshot.state.gameId > 0 && !snapshot.state.ended ? 1 : 0;
  return [running, snapshot.state.gameId, snapshot.state.generation, Number(snapshot.funding.balance)];
};

const compareActivity = (a: DiscoveredGame, b: DiscoveredGame): number => {
  const [x, y] = [activity(a), activity(b)];
  for (let i = 0; i < x.length; i += 1) if (x[i] !== y[i]) return y[i] - x[i];
  return 0;
};

/**
 * Find every game deployed on `network` through the on-chain registry and load its current
 * state. The most active games come first.
 */
export const discoverGames = async (connection: {
  network: NetworkName;
  provider: NetworkProvider;
  reader: RegistryReader;
}): Promise<DiscoveredGame[]> => {
  const deployments = await discoverDeployments(connection.network, connection.provider, connection.reader);
  const games = await Promise.all(deployments.map(async ({ deployment, genesisTxid }): Promise<DiscoveredGame> => {
    try {
      const snapshot = await new GameClient(deployment, connection.provider).fetchSnapshot();
      return { deployment, genesisTxid, snapshot };
    } catch (error) {
      return { deployment, genesisTxid, error: error instanceof Error ? error.message : String(error) };
    }
  }));
  return games.sort(compareActivity);
};

/** The game clients open by default: the most active one. */
export const pickDefaultGame = (games: DiscoveredGame[]): DiscoveredGame | undefined =>
  games.find((game) => game.snapshot) ?? games[0];
