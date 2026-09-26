import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Board,
  DEFAULT_PARAMS,
  NETWORKS,
  NotEnoughFundsError,
  replayGame,
  stampPattern,
  type GameRecord,
  type Pattern,
} from '@gol/core';
import { BoardCanvas } from './components/BoardCanvas';
import { DeployDialog } from './components/DeployDialog';
import { FundDialog } from './components/FundDialog';
import { HistoryDialog } from './components/HistoryDialog';
import { EditorPanel, LivePanel, ReplayPanel } from './components/Panels';
import { SettingsDialog } from './components/SettingsDialog';
import { Toasts, useToasts } from './components/Toasts';
import { GliderLogo, Icon } from './components/ui';
import { SANDBOX, useGame } from './hooks/useGame';
import { useSettings } from './hooks/useSettings';
import { END_REASONS, friendlyErrorText } from './lib/format';

type Dialog = 'settings' | 'fund' | 'history' | 'deploy' | null;

interface Replay {
  title: string;
  frames: Board[];
  index: number;
  playing: boolean;
  fps: number;
}

const AUTO_PLAY_DELAY = 1200;

export default function App() {
  const { settings, update, dark } = useSettings();
  const game = useGame(settings);
  const { snapshot, client, deployment, busy } = game;
  const { toasts, push, dismiss } = useToasts();
  const network = NETWORKS[settings.network];

  const [dialog, setDialog] = useState<Dialog>(null);
  const [mode, setMode] = useState<'live' | 'edit' | 'replay'>('live');
  const [focus, setFocus] = useState(false);
  const [autoPlay, setAutoPlay] = useState(false);

  const width = deployment?.width ?? DEFAULT_PARAMS.width;
  const height = deployment?.height ?? DEFAULT_PARAMS.height;
  const emptyBoard = useMemo(() => Board.empty(width, height), [width, height]);

  // Editor state.
  const [draft, setDraft] = useState<Board>(emptyBoard);
  const [density, setDensity] = useState(0.3);
  const [stamp, setStamp] = useState<Pattern | null>(null);
  const [zoom, setZoom] = useState(1);

  // Replay state.
  const [replay, setReplay] = useState<Replay | null>(null);

  // Leave editing/replay when switching games.
  useEffect(() => {
    setMode('live');
    setReplay(null);
    setAutoPlay(false);
  }, [client]);

  const explorerLink = (txid: string) => ({ href: `${network.explorerTx}${txid}`, label: 'View transaction' });

  const handleError = useCallback((error: unknown) => {
    if (error instanceof NotEnoughFundsError) {
      push({ kind: 'error', message: 'The contracts are out of fuel. Send some BCH to keep the game going!' });
      setDialog('fund');
    } else {
      push({ kind: 'error', message: friendlyErrorText(error) });
    }
    setAutoPlay(false);
  }, [push]);

  const step = useCallback(async (quiet = false) => {
    try {
      const result = await game.step();
      if (result.endReason) {
        const reason = END_REASONS[result.endReason];
        push({ kind: 'info', message: `${reason.emoji} Game over: ${reason.title}. Time for a new game!` });
        setAutoPlay(false);
      } else if (!quiet) {
        push({ kind: 'success', message: `Generation ${result.state.generation} is on the blockchain!`, link: explorerLink(result.txid) });
      }
    } catch (error) {
      handleError(error);
    }
  }, [game, push, handleError]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-play keeps stepping while the game runs and funds last.
  const autoTimer = useRef<number | undefined>(undefined);
  useEffect(() => {
    window.clearTimeout(autoTimer.current);
    if (!autoPlay || busy || mode !== 'live' || !snapshot) return undefined;
    if (snapshot.state.ended || snapshot.state.gameId === 0 || !snapshot.funding.canMove) {
      setAutoPlay(false);
      return undefined;
    }
    autoTimer.current = window.setTimeout(() => { void step(true); }, AUTO_PLAY_DELAY);
    return () => window.clearTimeout(autoTimer.current);
  }, [autoPlay, busy, mode, snapshot, step]);

  const startEditing = () => {
    if (snapshot && !snapshot.funding.canMove) {
      push({ kind: 'error', message: 'The contracts need more fuel before a new game can start.' });
      setDialog('fund');
      return;
    }
    setDraft(Board.random(width, height, density));
    setStamp(null);
    setZoom(1);
    setMode('edit');
  };

  const startGame = async () => {
    try {
      const result = await game.newGame(draft);
      push({ kind: 'success', message: `Game #${result.state.gameId} has begun! Press "Next generation" to evolve it.`, link: explorerLink(result.txid) });
      setMode('live');
    } catch (error) {
      handleError(error);
    }
  };

  const paint = useCallback((cells: Array<[number, number]>, alive: boolean) => {
    setDraft((current) => {
      const next = current.clone();
      for (const [x, y] of cells) next.set(x, y, alive);
      return next;
    });
  }, []);

  const openReplay = (record: GameRecord) => {
    const frames = replayGame(record);
    setReplay({ title: `Game #${record.gameId}`, frames, index: 0, playing: true, fps: 6 });
    setMode('replay');
    setAutoPlay(false);
    setDialog(null);
  };

  const replayCurrent = async () => {
    try {
      const history = await game.fetchHistory();
      const record = history?.games.find((entry) => entry.gameId === snapshot?.state.gameId);
      if (!record) throw new Error('This game was not found in the history yet. Try again in a moment.');
      openReplay(record);
    } catch (error) {
      push({ kind: 'error', message: friendlyErrorText(error) });
    }
  };

  // Replay playback.
  useEffect(() => {
    if (!replay?.playing) return undefined;
    const timer = window.setInterval(() => {
      setReplay((current) => {
        if (!current) return current;
        if (current.index >= current.frames.length - 1) return { ...current, playing: false };
        return { ...current, index: current.index + 1 };
      });
    }, 1000 / replay.fps);
    return () => window.clearInterval(timer);
  }, [replay?.playing, replay?.fps]);

  const displayed = mode === 'edit'
    ? draft
    : mode === 'replay' && replay
      ? replay.frames[replay.index]
      : snapshot?.board ?? emptyBoard;

  const animationMs = mode === 'replay' && replay
    ? Math.min(settings.animationMs, (1000 / replay.fps) * 0.9)
    : settings.animationMs;

  const toggleTheme = () => update({ theme: dark ? 'light' : 'dark' });

  const badge = (() => {
    if (mode === 'edit') return `Designing · ${draft.population()} alive`;
    if (mode === 'replay' && replay) return `Replay · generation ${replay.index}`;
    if (!snapshot) return null;
    if (snapshot.state.gameId === 0) return 'Waiting for the first game';
    return `Game #${snapshot.state.gameId} · generation ${snapshot.state.generation} · ${snapshot.board?.population() ?? 0} alive`;
  })();

  return (
    <div className="flex h-dvh flex-col">
      <header className="flex items-center gap-2 px-3 pt-3 sm:gap-3 sm:px-4">
        <GliderLogo className="size-9 shrink-0 animate-float sm:size-10" />
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-xl leading-none font-bold whitespace-nowrap sm:text-3xl">
            <span className="text-bubble">Life</span> <span className="text-ink/40 dark:text-white/40">on</span> <span className="text-mint">Chain</span>
          </h1>
          <p className="hidden truncate text-xs font-semibold opacity-60 md:block">Conway's Game of Life, played by Bitcoin Cash contracts. No wallet needed.</p>
          <button type="button" onClick={() => setDialog('settings')} className="text-[0.65rem] font-bold tracking-wide uppercase opacity-70 sm:hidden">
            ● {SANDBOX ? `${network.label} sandbox` : network.label}
          </button>
        </div>
        <button type="button" onClick={() => setDialog('settings')} className={`pill hidden border-2 border-ink sm:inline-flex dark:border-black ${network.isTestnet ? 'bg-sky text-ink' : 'bg-sun text-ink'}`}>
          <span className={`size-2 rounded-full ${game.error ? 'bg-bubble' : 'bg-ink'}`} /> {SANDBOX ? `${network.label} sandbox` : network.label}
        </button>
        <nav className="flex items-center gap-1.5 sm:gap-2 [&>button]:max-sm:size-9">
          <button type="button" className="icon-btn" onClick={() => setDialog('history')} disabled={!client} aria-label="All games" title="All games">
            <Icon name="history" />
          </button>
          <button type="button" className="icon-btn" onClick={() => setDialog('fund')} disabled={!client} aria-label="Fund the game" title="Fund the game">
            <Icon name="coin" className="size-5 text-sun" />
          </button>
          <button type="button" className="icon-btn" onClick={toggleTheme} aria-label="Toggle dark mode" title="Toggle dark mode">
            <Icon name={dark ? 'sun' : 'moon'} />
          </button>
          <button type="button" className="icon-btn" onClick={() => setDialog('settings')} aria-label="Settings" title="Settings">
            <Icon name="gear" />
          </button>
        </nav>
      </header>

      <main className={`flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3 sm:p-4 lg:flex-row lg:overflow-hidden`}>
        <section
          className="card relative flex shrink-0 flex-col p-2 sm:p-3 max-lg:min-h-64 lg:min-h-0 lg:flex-1"
          style={{ '--board-aspect': `${width} / ${height}` } as React.CSSProperties}
        >
          <div className="pointer-events-none absolute top-4 left-4 z-10 flex flex-wrap gap-2 sm:top-5 sm:left-5">
            {badge && <span className="pill border-2 border-ink/10 bg-white/85 text-ink backdrop-blur dark:border-white/10 dark:bg-night-3/85 dark:text-violet-50">{badge}</span>}
            {busy && <span className="pill animate-pulse bg-sun text-ink">{busy === 'step' ? 'Evolving…' : 'Starting…'}</span>}
            {autoPlay && <span className="pill bg-bubble text-ink">Auto-play</span>}
          </div>
          <button
            type="button"
            className="icon-btn absolute top-3 right-3 z-10 hidden size-9 lg:inline-flex"
            onClick={() => setFocus((value) => !value)}
            aria-label={focus ? 'Show the side panel' : 'Maximise the board'}
            title={focus ? 'Show the side panel' : 'Maximise the board'}
          >
            <Icon name={focus ? 'zoomOut' : 'zoomIn'} className="size-4" />
          </button>

          <div className="min-h-0 flex-1 max-lg:aspect-(--board-aspect)">
            <BoardCanvas
              board={displayed}
              dark={dark}
              animation={settings.animation}
              duration={animationMs}
              showGrid={settings.showGrid}
              zoom={mode === 'edit' ? zoom : 1}
              editable={mode === 'edit'}
              onPaint={paint}
              stamp={mode === 'edit' ? stamp : null}
              onStamp={(x, y) => stamp && setDraft((current) => stampPattern(current, stamp, x, y))}
              dimmed={!!client && !snapshot && mode === 'live'}
            />
          </div>

          {!deployment && (
            <div className="absolute inset-0 z-20 flex items-center justify-center p-4">
              <div className="card max-w-md animate-pop-in space-y-4 p-6 text-center">
                <GliderLogo className="mx-auto size-16" />
                <h2 className="font-display text-3xl font-semibold">No game on {network.label} yet</h2>
                <p className="opacity-80">Deploy the Game of Life contracts on this network, or paste the ID of an existing game in the settings.</p>
                <div className="flex flex-wrap justify-center gap-2">
                  <button type="button" className="btn-primary" onClick={() => setDialog('deploy')}><Icon name="rocket" /> Deploy a game</button>
                  <button type="button" className="btn-ghost" onClick={() => setDialog('settings')}>Settings</button>
                </div>
              </div>
            </div>
          )}
          {client && !snapshot && (
            <div className="absolute inset-0 z-20 flex items-center justify-center p-4">
              <div className="card max-w-md space-y-3 p-6 text-center">
                {game.error ? (
                  <>
                    <Icon name="warning" className="mx-auto size-10 text-bubble" />
                    <p className="font-display text-xl">{game.error}</p>
                    <div className="flex justify-center gap-2">
                      <button type="button" className="btn-sky btn-sm" onClick={() => game.refresh(true)}><Icon name="refresh" className="size-4" /> Retry</button>
                      <button type="button" className="btn-ghost btn-sm" onClick={() => setDialog('settings')}>Settings</button>
                    </div>
                  </>
                ) : (
                  <>
                    <GliderLogo className="mx-auto size-14 animate-spin [animation-duration:3s]" />
                    <p className="font-display text-xl">Connecting to {network.label}…</p>
                  </>
                )}
              </div>
            </div>
          )}
        </section>

        {!(focus && mode === 'live') && (
          <aside className="w-full shrink-0 lg:w-80 lg:overflow-y-auto lg:pb-2">
            {mode === 'edit' && (
              <EditorPanel
                population={draft.population()}
                density={density}
                stamp={stamp}
                zoom={zoom}
                busy={busy === 'newGame'}
                onDensity={setDensity}
                onRandom={() => setDraft(Board.random(width, height, density))}
                onClear={() => setDraft(Board.empty(width, height))}
                onStamp={setStamp}
                onZoom={setZoom}
                onStart={startGame}
                onCancel={() => setMode('live')}
              />
            )}
            {mode === 'replay' && replay && (
              <ReplayPanel
                title={replay.title}
                index={replay.index}
                total={replay.frames.length}
                playing={replay.playing}
                fps={replay.fps}
                onPlay={() => setReplay({ ...replay, playing: !replay.playing, index: replay.index >= replay.frames.length - 1 && !replay.playing ? 0 : replay.index })}
                onSeek={(index) => setReplay({ ...replay, index, playing: false })}
                onFps={(fps) => setReplay({ ...replay, fps })}
                onExit={() => { setMode('live'); setReplay(null); }}
              />
            )}
            {mode === 'live' && snapshot && (
              <LivePanel
                snapshot={snapshot}
                busy={busy}
                autoPlay={autoPlay}
                onStep={() => void step()}
                onToggleAuto={() => setAutoPlay((value) => !value)}
                onNewGame={startEditing}
                onReplay={replayCurrent}
                onFund={() => setDialog('fund')}
              />
            )}
          </aside>
        )}
        {focus && mode === 'live' && snapshot && snapshot.state.gameId > 0 && !snapshot.state.ended && (
          <div className="fixed bottom-6 left-1/2 z-30 hidden -translate-x-1/2 gap-2 lg:flex">
            <button type="button" className="btn-primary" onClick={() => void step()} disabled={!!busy || autoPlay || !snapshot.funding.canMove}>
              <Icon name="next" /> Next generation
            </button>
            <button type="button" className={autoPlay ? 'btn-pink' : 'btn-ghost'} onClick={() => setAutoPlay((value) => !value)}>
              <Icon name={autoPlay ? 'pause' : 'play'} /> {autoPlay ? 'Stop' : 'Auto-play'}
            </button>
          </div>
        )}
      </main>

      {dialog === 'settings' && (
        <SettingsDialog settings={settings} update={update} dark={dark} onClose={() => setDialog(null)} onDeploy={() => setDialog('deploy')} />
      )}
      {dialog === 'fund' && client && (
        <FundDialog
          client={client}
          snapshot={snapshot}
          onClose={() => setDialog(null)}
          onRefresh={() => void game.refresh(true)}
          onSimulateDonation={game.sandbox ? () => { game.sandbox!.donate(client.fundingAddress, 25_000n); void game.refresh(true); } : undefined}
        />
      )}
      {dialog === 'history' && client && (
        <HistoryDialog
          network={settings.network}
          history={game.history}
          progress={game.historyProgress}
          load={game.fetchHistory}
          dark={dark}
          onReplay={openReplay}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === 'deploy' && game.connection && !SANDBOX && (
        <DeployDialog
          connection={game.connection}
          onClose={() => setDialog(null)}
          onDeployed={(created, txid) => {
            update({ deployments: { ...settings.deployments, [created.network]: created } });
            setDialog(null);
            push({ kind: 'success', message: 'Your game is live on the blockchain! Start the first game.', link: explorerLink(txid) });
          }}
        />
      )}
      <Toasts toasts={toasts} dismiss={dismiss} />
    </div>
  );
}
