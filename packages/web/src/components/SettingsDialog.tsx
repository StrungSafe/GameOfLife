import { useEffect, useState } from 'react';
import { Board, NETWORKS, NETWORK_NAMES, KNOWN_DEPLOYMENTS, DEFAULT_PARAMS, validateDeployment, type NetworkName } from '@gol/core';
import { BoardCanvas } from './BoardCanvas';
import { CopyButton, Icon, Modal } from './ui';
import { shareLink, type AnimationStyle, type Settings, type Theme } from '../hooks/useSettings';

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

export function SettingsDialog({ settings, update, dark, onClose, onDeploy }: {
  settings: Settings;
  update: (patch: Partial<Settings>) => void;
  dark: boolean;
  onClose: () => void;
  onDeploy: () => void;
}) {
  const { network } = settings;
  const deployment = settings.deployments[network] ?? KNOWN_DEPLOYMENTS[network];
  const [server, setServer] = useState(settings.servers[network] ?? '');
  const [category, setCategory] = useState('');
  const [categoryError, setCategoryError] = useState('');

  useEffect(() => {
    setServer(settings.servers[network] ?? '');
    setCategory('');
    setCategoryError('');
  }, [network, settings.servers]);

  const selectNetwork = (name: NetworkName) => update({ network: name });

  const saveServer = () => {
    const servers = { ...settings.servers };
    if (server.trim()) servers[network] = server.trim();
    else delete servers[network];
    update({ servers });
  };

  const useGame = () => {
    try {
      const custom = validateDeployment({ ...DEFAULT_PARAMS, network, category: category.trim() });
      update({ deployments: { ...settings.deployments, [network]: custom } });
      setCategory('');
      setCategoryError('');
    } catch (error) {
      setCategoryError(error instanceof Error ? error.message : String(error));
    }
  };

  const resetGame = () => {
    const deployments = { ...settings.deployments };
    delete deployments[network];
    update({ deployments });
  };

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
            <p className="mt-2 flex items-center gap-2 text-sm text-bubble"><Icon name="warning" className="size-4" /> Mainnet moves are paid with real BCH (about 2,100 sats each).</p>
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
          <h3 className="label">Game on {NETWORKS[network].label}</h3>
          {deployment ? (
            <div className="space-y-2 rounded-2xl bg-ink/5 p-3 dark:bg-white/5">
              <div className="text-xs opacity-60">Game token category</div>
              <code className="block text-xs break-all">{deployment.category}</code>
              <div className="text-xs opacity-60">{deployment.width} x {deployment.height} board · max {deployment.maxGenerations} generations per game</div>
              <div className="flex flex-wrap gap-2 pt-1">
                <CopyButton text={shareLink(deployment)} label="Copy share link" />
                {settings.deployments[network] && KNOWN_DEPLOYMENTS[network] && (
                  <button type="button" className="btn-ghost btn-sm" onClick={resetGame}>Use the default game</button>
                )}
              </div>
            </div>
          ) : (
            <p className="text-sm opacity-70">No game is set up for this network yet.</p>
          )}
          <div>
            <label className="label" htmlFor="category">Play another game</label>
            <div className="flex gap-2">
              <input
                id="category"
                className="field"
                placeholder="Paste a game token category (64 hex characters)"
                value={category}
                onChange={(event) => setCategory(event.target.value)}
              />
              <button type="button" className="btn-sky btn-sm" onClick={useGame} disabled={!category.trim()}>Use</button>
            </div>
            {categoryError && <p className="mt-1 text-sm text-bubble">{categoryError}</p>}
          </div>
          <button type="button" className="btn-sun btn-sm" onClick={onDeploy}>
            <Icon name="rocket" className="size-4" /> Deploy a new game contract
          </button>
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
