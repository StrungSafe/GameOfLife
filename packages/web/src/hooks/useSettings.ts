import { useCallback, useEffect, useState } from 'react';
import { isNetworkName, validateDeployment, type Deployment, type NetworkName } from '@gol/core';

export type AnimationStyle = 'pop' | 'fade' | 'ripple' | 'none';
export type Theme = 'system' | 'light' | 'dark';

export interface Settings {
  network: NetworkName;
  /** Custom Fulcrum server per network (empty = default). */
  servers: Partial<Record<NetworkName, string>>;
  /** The game picked per network (otherwise the most active game found on chain). */
  deployments: Partial<Record<NetworkName, Deployment>>;
  animation: AnimationStyle;
  /** Animation length in milliseconds. */
  animationMs: number;
  theme: Theme;
  showGrid: boolean;
}

const KEY = 'gol.settings';

export const DEFAULT_SETTINGS: Settings = {
  network: 'chipnet',
  servers: {},
  deployments: {},
  animation: 'pop',
  animationMs: 450,
  theme: 'system',
  showGrid: true,
};

const load = (): Settings => {
  let settings = DEFAULT_SETTINGS;
  try {
    settings = { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') };
  } catch {
    // Storage can be unavailable (private mode); fall back to defaults.
  }
  // A shared link (?network=chipnet&game=<category>) selects a game.
  const params = new URLSearchParams(window.location.search);
  const network = params.get('network');
  const game = params.get('game');
  if (isNetworkName(network)) {
    settings = { ...settings, network };
    if (game) {
      try {
        const deployment = validateDeployment({
          network,
          category: game,
          width: Number(params.get('w') ?? 128),
          height: Number(params.get('h') ?? 80),
          maxFee: Number(params.get('fee') ?? 5000),
        });
        settings = { ...settings, deployments: { ...settings.deployments, [network]: deployment } };
      } catch {
        // Ignore malformed links.
      }
    }
  }
  return settings;
};

export const shareLink = (deployment: Deployment): string => {
  const url = new URL(window.location.href);
  url.search = new URLSearchParams({
    network: deployment.network,
    game: deployment.category,
    w: String(deployment.width),
    h: String(deployment.height),
    fee: String(deployment.maxFee),
  }).toString();
  return url.toString();
};

const prefersDark = () => window.matchMedia('(prefers-color-scheme: dark)').matches;

export const useSettings = () => {
  const [settings, setSettings] = useState<Settings>(load);
  const [systemDark, setSystemDark] = useState(prefersDark);

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(settings));
    } catch {
      // Not persisted; settings still apply for this visit.
    }
  }, [settings]);

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => setSystemDark(media.matches);
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);

  const dark = settings.theme === 'dark' || (settings.theme === 'system' && systemDark);
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
  }, [dark]);

  const update = useCallback((patch: Partial<Settings>) => setSettings((current) => ({ ...current, ...patch })), []);

  return { settings, update, dark };
};
