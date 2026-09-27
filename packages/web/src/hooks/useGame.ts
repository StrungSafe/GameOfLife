import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  GameClient,
  NotEnoughFundsError,
  DEFAULT_PARAMS,
  connect,
  createSandbox,
  discoverGames,
  loadHistory,
  pickDefaultGame,
  type DiscoveredGame,
  type Sandbox,
  type Board,
  type GameHistory,
  type MoveResult,
  type Snapshot,
} from '@gol/core';
import type { Settings } from './useSettings';
import { txCache } from '../lib/txCache';
import { friendlyErrorText as friendlyError } from '../lib/format';

const POLL_MS = 12_000;

const isNewer = (candidate: Snapshot, current: Snapshot | null): boolean => {
  if (!current || current.deployment.category !== candidate.deployment.category) return true;
  if (candidate.state.gameId !== current.state.gameId) return candidate.state.gameId > current.state.gameId;
  // Same generation: the fetched snapshot knows about new funding coins.
  return candidate.state.generation >= current.state.generation;
};

/**
 * `?sandbox` runs the real contracts on an in-memory mock network, no coins needed.
 * `?sandbox=5000` starts it with only that many satoshis (to try the funding flow).
 */
const sandboxParam = new URLSearchParams(window.location.search).get('sandbox');
export const SANDBOX = sandboxParam !== null;
const SANDBOX_FUNDS = /^\d+$/.test(sandboxParam ?? '') ? BigInt(sandboxParam!) : 200_000n;

export const useGame = (settings: Settings) => {
  const { network } = settings;
  const server = settings.servers[network];

  const [sandbox, setSandbox] = useState<Sandbox | null>(null);
  useEffect(() => {
    if (!SANDBOX) return;
    setSandbox(null);
    let cancelled = false;
    void createSandbox(network, DEFAULT_PARAMS, SANDBOX_FUNDS).then((created) => { if (!cancelled) setSandbox(created); });
    return () => { cancelled = true; };
  }, [network]);

  const connection = useMemo(
    () => (SANDBOX ? sandbox?.connection ?? null : connect(network, server, { persistent: true })),
    [network, server, sandbox],
  );
  useEffect(() => () => { void connection?.close(); }, [connection]);

  // Every game on the network, found on chain through the registry (most active first).
  const [games, setGames] = useState<DiscoveredGame[] | null>(null);
  const [discovering, setDiscovering] = useState(false);
  const [discoverError, setDiscoverError] = useState<string | null>(null);
  const discover = useCallback(async () => {
    if (!connection) return null;
    setDiscovering(true);
    try {
      const found = await discoverGames(connection);
      setGames(found);
      setDiscoverError(null);
      return found;
    } catch (e) {
      setDiscoverError(friendlyError(e));
      return null;
    } finally {
      setDiscovering(false);
    }
  }, [connection]);
  useEffect(() => {
    setGames(null);
    void discover();
  }, [discover]);

  // The chosen game, or else the most active one on chain.
  const selected = SANDBOX ? sandbox?.deployment : settings.deployments[network];
  const chosen = selected ?? (games ? pickDefaultGame(games)?.deployment : undefined);
  const autoSelected = !selected;
  // Keep the same object while the choice stays the same, so refreshing the list doesn't reset the game.
  const deployment = useMemo(() => chosen, [chosen?.network, chosen?.category]); // eslint-disable-line react-hooks/exhaustive-deps

  const client = useMemo(
    () => (deployment && connection ? new GameClient(deployment, connection.provider) : null),
    [deployment, connection],
  );

  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<null | 'step' | 'newGame'>(null);
  const snapshotRef = useRef<Snapshot | null>(null);
  snapshotRef.current = snapshot;

  const refresh = useCallback(async (force = false) => {
    if (!client) return null;
    setLoading(true);
    try {
      const fetched = await client.fetchSnapshot();
      setError(null);
      if (force || isNewer(fetched, snapshotRef.current)) {
        snapshotRef.current = fetched;
        setSnapshot(fetched);
      }
      return fetched;
    } catch (e) {
      setError(friendlyError(e));
      return null;
    } finally {
      setLoading(false);
    }
  }, [client]);

  useEffect(() => {
    setSnapshot(null);
    snapshotRef.current = null;
    setError(null);
    if (!client) return undefined;
    void refresh(true);
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refresh();
    }, POLL_MS);
    const onVisible = () => { if (document.visibilityState === 'visible') void refresh(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [client, refresh]);

  const runMove = useCallback(async (kind: 'step' | 'newGame', move: (current: Snapshot) => Promise<MoveResult>) => {
    if (!client) throw new Error('No game is configured for this network.');
    setBusy(kind);
    try {
      const current = snapshotRef.current ?? await client.fetchSnapshot();
      const result = await move(current);
      snapshotRef.current = result.snapshot;
      setSnapshot(result.snapshot);
      return result;
    } catch (e) {
      if (!(e instanceof NotEnoughFundsError)) void refresh(true);
      throw e;
    } finally {
      setBusy(null);
    }
  }, [client, refresh]);

  const step = useCallback(
    (generations = 1) => runMove('step', (current) => client!.step(current, generations)),
    [runMove, client],
  );
  const newGame = useCallback((board: Board) => runMove('newGame', (current) => client!.newGame(board, current)), [runMove, client]);

  const [history, setHistory] = useState<GameHistory | null>(null);
  const [historyProgress, setHistoryProgress] = useState<{ done: number; total: number } | null>(null);
  const historyKey = useRef<string>('');

  const fetchHistory = useCallback(async () => {
    if (!client) return null;
    setHistoryProgress({ done: 0, total: 0 });
    try {
      const result = await loadHistory(client, connection!.reader, {
        cache: txCache,
        onProgress: (done, total) => setHistoryProgress({ done, total }),
      });
      historyKey.current = client.deployment.category;
      setHistory(result);
      return result;
    } finally {
      setHistoryProgress(null);
    }
  }, [client, connection]);

  useEffect(() => {
    if (client && historyKey.current !== client.deployment.category) setHistory(null);
  }, [client]);

  return {
    sandbox,
    games,
    discovering,
    discoverError,
    discover,
    autoSelected,
    deployment,
    connection,
    client,
    snapshot,
    loading,
    error,
    busy,
    refresh,
    step,
    newGame,
    history,
    historyProgress,
    fetchHistory,
  };
};

export type GameApi = ReturnType<typeof useGame>;
