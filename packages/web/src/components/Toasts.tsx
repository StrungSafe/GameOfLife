import { useCallback, useState } from 'react';
import { Icon } from './ui';

export interface Toast {
  id: number;
  kind: 'success' | 'error' | 'info';
  message: string;
  link?: { href: string; label: string };
}

let nextId = 1;

export const useToasts = () => {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const dismiss = useCallback((id: number) => setToasts((list) => list.filter((toast) => toast.id !== id)), []);
  const push = useCallback((toast: Omit<Toast, 'id'>) => {
    const id = nextId++;
    setToasts((list) => [...list.slice(-3), { ...toast, id }]);
    setTimeout(() => dismiss(id), toast.kind === 'error' ? 9000 : 5000);
  }, [dismiss]);
  return { toasts, push, dismiss };
};

const STYLES: Record<Toast['kind'], string> = {
  success: 'bg-mint',
  error: 'bg-bubble',
  info: 'bg-sky',
};

export function Toasts({ toasts, dismiss }: { toasts: Toast[]; dismiss: (id: number) => void }) {
  return (
    <div className="pointer-events-none fixed right-3 bottom-3 z-50 flex w-[min(24rem,calc(100%-1.5rem))] flex-col gap-2" aria-live="polite">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`pointer-events-auto flex animate-pop-in items-start gap-2 rounded-2xl border-2 border-ink p-3 text-ink shadow-[0_4px_0_0_var(--color-ink)] dark:border-black ${STYLES[toast.kind]}`}
        >
          <Icon name={toast.kind === 'error' ? 'warning' : toast.kind === 'success' ? 'check' : 'sparkle'} className="mt-0.5 size-5 shrink-0" />
          <div className="min-w-0 flex-1 text-sm font-semibold">
            <p className="break-words">{toast.message}</p>
            {toast.link && (
              <a className="inline-flex items-center gap-1 text-xs underline" href={toast.link.href} target="_blank" rel="noreferrer">
                {toast.link.label} <Icon name="external" className="size-3" />
              </a>
            )}
          </div>
          <button type="button" onClick={() => dismiss(toast.id)} aria-label="Dismiss" className="opacity-60 hover:opacity-100">
            <Icon name="close" className="size-4" />
          </button>
        </div>
      ))}
    </div>
  );
}
