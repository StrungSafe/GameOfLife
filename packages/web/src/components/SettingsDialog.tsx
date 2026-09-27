import { useEffect, useState } from 'react';
import { Board, NETWORKS, NETWORK_NAMES, type Deployment, type DiscoveredGame, type NetworkName } from '@gol/core';
import { BoardCanvas } from './BoardCanvas';
import { CopyButton, Icon, Modal } from './ui';
import { shareLink, type AnimationStyle, type Settings, type Theme } from '../hooks/useSettings';
import { formatSats } from '../lib/format';

const ANIMATIONS: { id: AnimationStyle; name: string; blurb: string }[] = [
  { id: 'pop', name: 'Pop', blurb: 'Cells bounce in and shrink away' },
  { id: 'fade', name: 'Fade', blurb: 'Soft cross-fade between generations' },
  { id: 'ripple', name: 'Ripple', blurb: 'Changes wash out from the centre' },
  { id: 'none', name: 'Snap', blurb: 'No animation, instant updates' },
];

const PREVIEW_A = Board.fromText(8, 8, '\n\n..O.....\n...O..O.\n.OOO..O.\n......O.');
const PREVIEW_B = PREVIEW_A.next();

function AnimationPreview({ style, duration, dark }: { style: AnimationStyle; duration: number; dark: boolean }) {
  const [flip, setFlip] = useState(false);
  useEffect(() => {
    const timer = setInterval(() => setFlip((value) => !value), Math.max(900, duration + 500));
    return () => clearInterval(timer);
  }, [duration]);
  return (
    <div className="pointer-events-none size-16 shrink-0">
      <BoardCanvas board={flip ? PREVIEW_B : PREVIEW_A} dark={dark} animation={style} duration={duration} showGrid={false} />
    </div>
  );
}

export function SettingsDialog({ settings, update, dark, games, discovering, discoverError, onDiscover, activeDeployment, onClose, onDeploy, canDeploy }: {
  settings: Settings;
  update: (patch: Partial<Settings>) => void;
  dark: boolean;
  /** Games found on chain for the selected network, most active first. */
  games: DiscoveredGame[] | null;
  discovering: boolean;
  discoverError: string | null;
  onDiscover: () => void;
  /** The game being played right now (chosen or automatic). */
  activeDeployment?: Deployment;
  onClose: () => void;
  onDeploy: () => void;
  canDeploy: boolean;
}) {
  const { network } = settings;
  const chosen = settings.deployments[network];
  const [server, setServer] = useState(settings.servers[network] ?? '');

  useEffect(() => {
    setServer(settings.servers[network] ?? '');
  }, [network, settings.servers]);

  // Show fresh game states whenever the dialog opens.
  useEffect(() => { onDiscover(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const selectNetwork = (name: NetworkName) => update({ network: name });

  const saveServer = () => {
    const servers = { ...settings.servers };
    if (server.trim()) servers[network] = server.trim();
    else delete servers[network];
    update({ servers });
  };

  const selectGame = (deployment?: Deployment) => {
    const deployments = { ...settings.deployments };
    if (deployment) deployments[network] = deployment;
    else delete deployments[network];
    update({ deployments });
  };

  const optionClass = (selected: boolean) => `w-full rounded-2xl border-2 p-3 text-left transition-all ${
    selected
      ? 'border-ink bg-sky/20 shadow-[0_4px_0_0_var(--color-ink)] dark:border-sky'
      : 'border-ink/15 hover:border-ink/40 dark:border-white/15 dark:hover:border-white/40'
  }`;

  return (
    <Modal title="Settings" onClose={onClose} wide icon={<Icon name="gear" className="size-7 text-grape" />}>
      <div className="space-y-7">
        <section>
          <h3 className="label">Network</h3>
          <div className="grid grid-cols-3 gap-2">
            {NETWORK_NAMES.map((name) => (
              <button
                key={name}
                type="button"
                onClick={() => selectNetwork(name)}
                className={`rounded-2xl border-2 px-3 py-3 text-left transition-all ${
                  network === name
                    ? 'border-ink bg-sun shadow-[0_4px_0_0_var(--color-ink)] dark:border-black dark:text-ink'
                    : 'border-ink/15 hover:border-ink/40 dark:border-white/15 dark:hover:border-white/40'
                }`}
              >
                <div className="font-display text-lg font-semibold">{NETWORKS[name].label}</div>
                <div className="text-xs opacity-70">{NETWORKS[name].isTestnet ? 'Free test coins' : 'Real BCH'}</div>
              </button>
            ))}
          </div>
          {network === 'mainnet' && (
            <p className="mt-2 flex items-center gap-2 text-sm text-bubble"><Icon name="warning" className="size-4" /> Mainnet moves are paid with real BCH (about 2,200 sats per move of up to 8 generations).</p>
          )}
        </section>

        <section>
          <label className="label" htmlFor="server">Fulcrum server for {NETWORKS[network].label}</label>
          <div className="flex gap-2">
            <input
              id="server"
              className="field"
              list="servers"
              placeholder={NETWORKS[network].servers[0]}
              value={server}
              onChange={(event) => setServer(event.target.value)}
              onBlur={saveServer}
              onKeyDown={(event) => { if (event.key === 'Enter') saveServer(); }}
            />
            <datalist id="servers">
              {NETWORKS[network].servers.map((host) => <option key={host} value={host} />)}
            </datalist>
          </div>
          <p className="mt-1 text-xs opacity-60">Leave empty to use the default. Connects over secure WebSockets (port 50004).</p>
        </section>

        <section className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h3 className="label mb-0">Games on {NETWORKS[network].label}</h3>
            <button type="button" className="btn-ghost btn-sm" onClick={onDiscover} disabled={discovering}>
              <Icon name="refresh" className={`size-4 ${discovering ? 'animate-spin' : ''}`} /> {discovering ? 'Searching…' : 'Refresh'}
            </button>
          </div>
          <p className="text-xs opacity-70">Every game announces itself in an on-chain registry, so the app finds them all by itself.</p>
          <button type="button" className={optionClass(!chosen)} onClick={() => selectGame(undefined)}>
            <div className="font-display text-lg font-semibold">✨ Most active game</div>
            <div className="text-xs opacity-70">Automatically follow the liveliest game on this network.</div>
          </button>
          {discoverError && <p className="rounded-2xl bg-bubble/15 p-3 text-sm">{discoverError}</p>}
          {games && games.length === 0 && <p className="text-sm opacity-70">No games on this network yet - deploy the first one!</p>}
          <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
            {games?.map((game) => {
              const s = game.snapshot;
              const status = !s ? 'Unavailable'
                : s.state.gameId === 0 ? 'Waiting for its first game'
                  : s.state.ended ? `Game #${s.state.gameId} over at generation ${s.state.generation}`
                    : `Game #${s.state.gameId} live · generation ${s.state.generation}`;
              return (
                <button key={game.deployment.category} type="button" className={optionClass(chosen?.category === game.deployment.category)} onClick={() => selectGame(game.deployment)}>
                  <div className="flex items-center justify-between gap-2">
                    <code className="truncate text-xs">{game.deployment.category}</code>
                    {activeDeployment?.category === game.deployment.category && <span className="pill shrink-0 bg-mint/25 text-emerald-700 dark:text-mint">Playing</span>}
                  </div>
                  <div className="mt-1 text-sm font-semibold">{status}</div>
                  <div className="text-xs opacity-70">
                    {game.deployment.width} x {game.deployment.height} board{s ? ` · ${formatSats(s.funding.balance, true)} fuel` : ''}
                  </div>
                </button>
              );
            })}
          </div>
          <div className="flex flex-wrap gap-2">
            {activeDeployment && <CopyButton text={shareLink(activeDeployment)} label="Copy link to this game" />}
            {canDeploy && (
              <button type="button" className="btn-sun btn-sm" onClick={onDeploy}>
                <Icon name="rocket" className="size-4" /> Deploy a new game
              </button>
            )}
          </div>
        </section>

        <section>
          <h3 className="label">Animation</h3>
          <div className="grid gap-2 sm:grid-cols-2">
            {ANIMATIONS.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => update({ animation: option.id })}
                className={`flex items-center gap-3 rounded-2xl border-2 p-2 text-left transition-all ${
                  settings.animation === option.id
                    ? 'border-ink bg-mint/25 shadow-[0_4px_0_0_var(--color-ink)] dark:border-mint'
                    : 'border-ink/15 hover:border-ink/40 dark:border-white/15'
                }`}
              >
                <AnimationPreview style={option.id} duration={settings.animationMs} dark={dark} />
                <div>
                  <div className="font-display text-lg font-semibold">{option.name}</div>
                  <div className="text-xs opacity-70">{option.blurb}</div>
                </div>
              </button>
            ))}
          </div>
          <label className="mt-4 block" htmlFor="speed">
            <span className="label">Animation length: {settings.animationMs} ms</span>
            <input
              id="speed"
              type="range"
              min={120}
              max={1500}
              step={30}
              value={settings.animationMs}
              onChange={(event) => update({ animationMs: Number(event.target.value) })}
              className="w-full accent-grape"
            />
          </label>
        </section>

        <section className="grid gap-5 sm:grid-cols-2">
          <div>
            <h3 className="label">Theme</h3>
            <div className="flex gap-2">
              {(['system', 'light', 'dark'] as Theme[]).map((theme) => (
                <button
                  key={theme}
                  type="button"
                  onClick={() => update({ theme })}
                  className={`flex-1 rounded-xl border-2 px-2 py-2 text-sm font-bold capitalize ${
                    settings.theme === theme ? 'border-ink bg-grape text-white dark:border-black' : 'border-ink/15 dark:border-white/15'
                  }`}
                >
                  {theme}
                </button>
              ))}
            </div>
          </div>
          <div>
            <h3 className="label">Board</h3>
            <label className="flex items-center gap-2 rounded-xl border-2 border-ink/15 px-3 py-2 text-sm font-bold dark:border-white/15">
              <input type="checkbox" checked={settings.showGrid} onChange={(event) => update({ showGrid: event.target.checked })} className="size-4 accent-grape" />
              Show grid lines
            </label>
          </div>
        </section>
      </div>
    </Modal>
  );
}
