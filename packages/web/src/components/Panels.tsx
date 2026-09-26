import { PATTERNS, type Pattern, type Snapshot } from '@gol/core';
import { Icon, Stat } from './ui';
import { END_REASONS, formatSats } from '../lib/format';

export function LivePanel({ snapshot, busy, autoPlay, onStep, onToggleAuto, onNewGame, onReplay, onFund }: {
  snapshot: Snapshot;
  busy: null | 'step' | 'newGame';
  autoPlay: boolean;
  onStep: () => void;
  onToggleAuto: () => void;
  onNewGame: () => void;
  onReplay: () => void;
  onFund: () => void;
}) {
  const { state, board, funding, endReason } = snapshot;
  const hasGame = state.gameId > 0;
  const running = hasGame && !state.ended;
  const reason = endReason ? END_REASONS[endReason] : undefined;

  return (
    <div className="space-y-3">
      <div className="card space-y-3 p-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-display text-2xl font-semibold">{hasGame ? `Game #${state.gameId}` : 'No game yet'}</h2>
          {running && <span className="pill bg-mint/20 text-emerald-700 dark:text-mint"><span className="size-2 animate-pulse rounded-full bg-mint" /> Live</span>}
          {hasGame && state.ended && <span className="pill bg-grape/15 text-grape">Game over</span>}
        </div>
        {hasGame ? (
          <div className="grid grid-cols-2 gap-2">
            <Stat label="Generation" value={state.generation} />
            <Stat label="Alive" value={board?.population() ?? 0} accent="text-mint" />
          </div>
        ) : (
          <p className="text-sm opacity-80">Be the first to seed this board with life!</p>
        )}
        {hasGame && state.ended && (
          <div className="rounded-2xl border-2 border-dashed border-grape/40 p-3 text-sm">
            <div className="font-display text-lg">{reason ? `${reason.emoji} ${reason.title}` : 'This game is over'}</div>
            <p className="opacity-80">The contract is ready for a fresh start. Design a new board!</p>
          </div>
        )}
      </div>

      {!funding.canMove && (
        <div className="card animate-wiggle border-bubble! bg-bubble/10! p-4">
          <div className="flex items-start gap-3">
            <Icon name="warning" className="mt-1 size-6 shrink-0 text-bubble" />
            <div className="space-y-2">
              <p className="font-display text-lg font-semibold">Out of fuel!</p>
              <p className="text-sm">The contracts need <b>{formatSats(funding.shortfall)}</b> more to pay for the next move. Anyone can chip in from any wallet.</p>
              <button type="button" className="btn-pink btn-sm" onClick={onFund}><Icon name="coin" className="size-4" /> Fund the game</button>
            </div>
          </div>
        </div>
      )}

      <div className="card space-y-2 p-4">
        {running ? (
          <>
            <button type="button" className="btn-primary w-full py-3 text-lg" onClick={onStep} disabled={!!busy || autoPlay || !funding.canMove}>
              <Icon name="next" /> {busy === 'step' ? 'Evolving…' : 'Next generation'}
            </button>
            <button type="button" className={`${autoPlay ? 'btn-pink' : 'btn-ghost'} w-full`} onClick={onToggleAuto} disabled={!funding.canMove && !autoPlay}>
              <Icon name={autoPlay ? 'pause' : 'play'} /> {autoPlay ? 'Stop auto-play' : 'Auto-play'}
            </button>
            <p className="text-center text-xs opacity-60">Every generation is a transaction paid by the contract (~{formatSats(funding.moveFee)}).</p>
          </>
        ) : (
          <button type="button" className="btn-pink w-full py-3 text-lg" onClick={onNewGame} disabled={!!busy}>
            <Icon name="sparkle" /> New game
          </button>
        )}
        {hasGame && (
          <button type="button" className="btn-sky w-full" onClick={onReplay}>
            <Icon name="replay" /> Replay this game
          </button>
        )}
      </div>

      <button type="button" onClick={onFund} className="card flex w-full items-center gap-3 p-4 text-left transition hover:-translate-y-0.5">
        <Icon name="coin" className="size-9 shrink-0 text-sun" />
        <div className="flex-1">
          <div className="text-xs font-bold tracking-widest uppercase opacity-60">Contract fuel</div>
          <div className="font-display text-xl font-semibold">{formatSats(funding.balance, true)}</div>
          <div className="text-xs opacity-70">~{funding.movesLeft} moves left · tap to add funds</div>
        </div>
      </button>
    </div>
  );
}

export function EditorPanel({ population, density, stamp, zoom, busy, onDensity, onRandom, onClear, onStamp, onZoom, onStart, onCancel }: {
  population: number;
  density: number;
  stamp: Pattern | null;
  zoom: number;
  busy: boolean;
  onDensity: (value: number) => void;
  onRandom: () => void;
  onClear: () => void;
  onStamp: (pattern: Pattern | null) => void;
  onZoom: (value: number) => void;
  onStart: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="space-y-3">
      <div className="card space-y-3 p-4">
        <h2 className="font-display text-2xl font-semibold">Design a new world</h2>
        <p className="text-sm opacity-80">
          {stamp ? <>Click the board to drop a <b>{stamp.name}</b>.</> : <>Click or drag on the board to bring cells to life (or kill them).</>}
        </p>
        <Stat label="Alive" value={population} accent="text-mint" />
      </div>

      <div className="card space-y-3 p-4">
        <div className="flex items-center gap-2">
          <button type="button" className="btn-sun btn-sm flex-1" onClick={onRandom}><Icon name="dice" className="size-4" /> Random</button>
          <button type="button" className="btn-ghost btn-sm flex-1" onClick={onClear}><Icon name="trash" className="size-4" /> Clear</button>
        </div>
        <label className="block" htmlFor="density">
          <span className="label">Random density: {Math.round(density * 100)}%</span>
          <input id="density" type="range" min={0.05} max={0.8} step={0.05} value={density} onChange={(event) => onDensity(Number(event.target.value))} className="w-full accent-sun" />
        </label>
        <div>
          <div className="label">Stamp a pattern</div>
          <div className="grid grid-cols-2 gap-1.5">
            <button
              type="button"
              onClick={() => onStamp(null)}
              className={`rounded-xl border-2 px-2 py-1.5 text-left text-xs font-bold ${!stamp ? 'border-ink bg-mint/30 dark:border-mint' : 'border-ink/15 dark:border-white/15'}`}
            >
              <Icon name="pencil" className="mr-1 inline size-3.5" /> Draw cells
            </button>
            {PATTERNS.map((pattern) => (
              <button
                key={pattern.id}
                type="button"
                title={pattern.description}
                onClick={() => onStamp(stamp?.id === pattern.id ? null : pattern)}
                className={`truncate rounded-xl border-2 px-2 py-1.5 text-left text-xs font-bold ${stamp?.id === pattern.id ? 'border-ink bg-sky/30 dark:border-sky' : 'border-ink/15 dark:border-white/15'}`}
              >
                {pattern.name}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="label mb-0 flex-1">Zoom {zoom}x</span>
          <button type="button" className="icon-btn size-8" onClick={() => onZoom(Math.max(1, zoom / 2))} disabled={zoom <= 1} aria-label="Zoom out"><Icon name="zoomOut" className="size-4" /></button>
          <button type="button" className="icon-btn size-8" onClick={() => onZoom(Math.min(8, zoom * 2))} disabled={zoom >= 8} aria-label="Zoom in"><Icon name="zoomIn" className="size-4" /></button>
        </div>
      </div>

      <div className="card space-y-2 p-4">
        <button type="button" className="btn-primary w-full py-3 text-lg" onClick={onStart} disabled={busy || population === 0}>
          <Icon name="rocket" /> {busy ? 'Starting…' : 'Start the game!'}
        </button>
        <button type="button" className="btn-ghost w-full" onClick={onCancel} disabled={busy}>Cancel</button>
      </div>
    </div>
  );
}

export function ReplayPanel({ title, index, total, playing, fps, onPlay, onSeek, onFps, onExit }: {
  title: string;
  index: number;
  total: number;
  playing: boolean;
  fps: number;
  onPlay: () => void;
  onSeek: (index: number) => void;
  onFps: (fps: number) => void;
  onExit: () => void;
}) {
  return (
    <div className="space-y-3">
      <div className="card space-y-3 p-4">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-2xl font-semibold">{title}</h2>
          <span className="pill bg-sky/20 text-sky">Replay</span>
        </div>
        <Stat label="Generation" value={`${index} / ${total - 1}`} />
        <input
          type="range"
          min={0}
          max={Math.max(0, total - 1)}
          value={index}
          onChange={(event) => onSeek(Number(event.target.value))}
          className="w-full accent-sky"
          aria-label="Generation"
        />
        <div className="flex items-center gap-2">
          <button type="button" className="icon-btn" onClick={() => onSeek(0)} aria-label="First generation"><Icon name="prev" /></button>
          <button type="button" className="icon-btn" onClick={() => onSeek(Math.max(0, index - 1))} aria-label="Previous generation"><Icon name="prev" className="size-4" /></button>
          <button type="button" className="btn-sky flex-1" onClick={onPlay}><Icon name={playing ? 'pause' : 'play'} /> {playing ? 'Pause' : 'Play'}</button>
          <button type="button" className="icon-btn" onClick={() => onSeek(Math.min(total - 1, index + 1))} aria-label="Next generation"><Icon name="next" className="size-4" /></button>
          <button type="button" className="icon-btn" onClick={() => onSeek(total - 1)} aria-label="Latest generation"><Icon name="next" /></button>
        </div>
        <div>
          <div className="label">Speed</div>
          <div className="grid grid-cols-5 gap-1">
            {[1, 3, 6, 12, 24].map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => onFps(value)}
                className={`rounded-xl border-2 py-1 text-xs font-bold ${fps === value ? 'border-ink bg-sky/30 dark:border-sky' : 'border-ink/15 dark:border-white/15'}`}
              >
                {value}/s
              </button>
            ))}
          </div>
        </div>
      </div>
      <button type="button" className="btn-ghost w-full" onClick={onExit}>Back to the live game</button>
    </div>
  );
}
