import { useEffect, useState } from 'react';
import { NETWORKS, type GameHistory, type GameRecord, type NetworkName } from '@gol/core';
import { Icon, Modal } from './ui';
import { MiniBoard } from './MiniBoard';
import { END_REASONS, friendlyErrorText, shortTxid } from '../lib/format';

export function HistoryDialog({ network, history, progress, load, dark, onReplay, onClose }: {
  network: NetworkName;
  history: GameHistory | null;
  progress: { done: number; total: number } | null;
  load: () => Promise<GameHistory | null>;
  dark: boolean;
  onReplay: (game: GameRecord) => void;
  onClose: () => void;
}) {
  const [error, setError] = useState('');
  useEffect(() => {
    load().catch((e) => setError(friendlyErrorText(e)));
  }, [load]);

  const games = history ? [...history.games].reverse() : [];

  return (
    <Modal title="All games" onClose={onClose} wide icon={<Icon name="history" className="size-7 text-sky" />}>
      {error && <p className="mb-3 rounded-2xl bg-bubble/15 p-3 text-sm">{error}</p>}
      {!history && !error && (
        <div className="py-10 text-center">
          <div className="mx-auto mb-3 size-10 animate-spin rounded-full border-4 border-grape border-t-transparent" />
          <p className="font-display text-lg">Reading the blockchain…</p>
          {progress && progress.total > 0 && (
            <p className="text-sm opacity-60">{progress.done} / {progress.total} transactions</p>
          )}
        </div>
      )}
      {history && games.length === 0 && (
        <p className="py-10 text-center font-display text-lg">No games have been played yet. Be the first!</p>
      )}
      <ul className="space-y-3">
        {games.map((game) => {
          const reason = game.endReason ? END_REASONS[game.endReason] : undefined;
          return (
            <li key={game.gameId} className="flex flex-col gap-3 rounded-3xl border-2 border-ink/10 p-3 sm:flex-row sm:items-center dark:border-white/10">
              <MiniBoard board={game.initialBoard} dark={dark} className="h-20 self-start" />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-display text-xl font-semibold">Game #{game.gameId}</span>
                  {game.ended ? (
                    <span className="pill bg-grape/15 text-grape">{reason ? `${reason.emoji} ${reason.title}` : 'Ended'}</span>
                  ) : (
                    <span className="pill bg-mint/20 text-emerald-700 dark:text-mint">● Live</span>
                  )}
                </div>
                <div className="text-sm opacity-75">
                  {game.generations} generation{game.generations === 1 ? '' : 's'} · {game.initialBoard.population()} → {game.finalPopulation} cells
                </div>
                <a
                  className="text-xs underline decoration-dotted opacity-60 hover:opacity-100"
                  href={`${NETWORKS[network].explorerTx}${game.startTxid}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  started in {shortTxid(game.startTxid)}
                </a>
              </div>
              <button type="button" className="btn-sky btn-sm self-start sm:self-center" onClick={() => onReplay(game)}>
                <Icon name="replay" className="size-4" /> Replay
              </button>
            </li>
          );
        })}
      </ul>
    </Modal>
  );
}
