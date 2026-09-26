import { useEffect, useRef, useState, type ReactNode } from 'react';
import QRCode from 'qrcode';

type IconName =
  | 'play' | 'pause' | 'next' | 'prev' | 'gear' | 'sun' | 'moon' | 'coin' | 'history' | 'replay'
  | 'sparkle' | 'dice' | 'trash' | 'close' | 'copy' | 'check' | 'rocket' | 'eraser' | 'pencil'
  | 'zoomIn' | 'zoomOut' | 'external' | 'refresh' | 'warning' | 'link';

const PATHS: Record<IconName, ReactNode> = {
  play: <path d="M8 5.5v13l11-6.5z" fill="currentColor" />,
  pause: <><rect x="6" y="5" width="4.5" height="14" rx="1.5" fill="currentColor" /><rect x="13.5" y="5" width="4.5" height="14" rx="1.5" fill="currentColor" /></>,
  next: <><path d="M5 5.5v13l9-6.5z" fill="currentColor" /><rect x="15.5" y="5.5" width="3.5" height="13" rx="1.2" fill="currentColor" /></>,
  prev: <><path d="M19 5.5v13l-9-6.5z" fill="currentColor" /><rect x="5" y="5.5" width="3.5" height="13" rx="1.2" fill="currentColor" /></>,
  gear: <path d="M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Zm8.3 5.2-1.6-.9a7 7 0 0 0 0-1.6l1.6-.9a.8.8 0 0 0 .3-1.1l-1.5-2.6a.8.8 0 0 0-1.1-.3l-1.6.9a7 7 0 0 0-1.4-.8V4.6a.8.8 0 0 0-.8-.8h-3a.8.8 0 0 0-.8.8v1.8a7 7 0 0 0-1.4.8l-1.6-.9a.8.8 0 0 0-1.1.3L3.4 9.2a.8.8 0 0 0 .3 1.1l1.6.9a7 7 0 0 0 0 1.6l-1.6.9a.8.8 0 0 0-.3 1.1l1.5 2.6a.8.8 0 0 0 1.1.3l1.6-.9a7 7 0 0 0 1.4.8v1.8c0 .4.4.8.8.8h3c.4 0 .8-.4.8-.8v-1.8a7 7 0 0 0 1.4-.8l1.6.9c.4.2.9.1 1.1-.3l1.5-2.6a.8.8 0 0 0-.3-1.1Z" fill="currentColor" />,
  sun: <><circle cx="12" cy="12" r="4.5" fill="currentColor" /><path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></>,
  moon: <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z" fill="currentColor" />,
  coin: <><circle cx="12" cy="12" r="9" fill="currentColor" /><path d="M13.8 8.2c-.5-.6-1.3-.9-2.2-.9-1.4 0-2.4.8-2.4 1.9 0 2.6 5 1.4 5 4 0 1.1-1.1 1.9-2.5 1.9-1 0-1.9-.4-2.4-1.1M11.5 6v1.3M11.5 15.3v1.4" stroke="white" strokeWidth="1.6" strokeLinecap="round" fill="none" /></>,
  history: <path d="M12 4a8 8 0 1 1-7.4 5M4 4v5h5M12 8v4.5l3 2" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" fill="none" />,
  replay: <path d="M4 12a8 8 0 1 0 2.5-5.8M4 4v4.5h4.5M10 9v6l5-3z" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" fill="none" />,
  sparkle: <path d="M12 2.5l2.2 6.3 6.3 2.2-6.3 2.2L12 19.5l-2.2-6.3L3.5 11l6.3-2.2zM19 15.5l.9 2.6 2.6.9-2.6.9-.9 2.6-.9-2.6-2.6-.9 2.6-.9z" fill="currentColor" />,
  dice: <><rect x="3.5" y="3.5" width="17" height="17" rx="4" fill="none" stroke="currentColor" strokeWidth="2.2" /><circle cx="8.5" cy="8.5" r="1.6" fill="currentColor" /><circle cx="15.5" cy="15.5" r="1.6" fill="currentColor" /><circle cx="15.5" cy="8.5" r="1.6" fill="currentColor" /><circle cx="8.5" cy="15.5" r="1.6" fill="currentColor" /><circle cx="12" cy="12" r="1.6" fill="currentColor" /></>,
  trash: <path d="M5 7h14M10 11v6M14 11v6M6.5 7l1 12.5h9l1-12.5M9.5 7V4.5h5V7" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" fill="none" />,
  close: <path d="M6 6l12 12M18 6 6 18" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" />,
  copy: <><rect x="8.5" y="8.5" width="11" height="11" rx="2.5" fill="none" stroke="currentColor" strokeWidth="2.2" /><path d="M15.5 5.5v-.5a1.5 1.5 0 0 0-1.5-1.5H6A2.5 2.5 0 0 0 3.5 6v8A1.5 1.5 0 0 0 5 15.5h.5" fill="none" stroke="currentColor" strokeWidth="2.2" /></>,
  check: <path d="M5 12.5l4.5 4.5L19 7.5" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" fill="none" />,
  rocket: <path d="M14.5 4.5c3-1.5 5-1 5-1s.5 2-1 5L13 14l-3-3zM10 11l-4.5-.5L3.5 13l4 1M13 14l.5 4.5-2.5 2-1-4M8 16l-3 3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" />,
  eraser: <path d="M8 20h12M4.5 14.5l9-9a2 2 0 0 1 2.8 0l3.2 3.2a2 2 0 0 1 0 2.8L12 19H8.5l-4-4a.4.4 0 0 1 0-.5ZM9 10l5.5 5.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" />,
  pencil: <path d="M4 20l1-4.5L15.5 5a2.1 2.1 0 0 1 3 3L8 18.5zM13.5 7l3 3" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" fill="none" />,
  zoomIn: <path d="M10.5 4a6.5 6.5 0 1 1 0 13 6.5 6.5 0 0 1 0-13Zm5 11.5L20 20M10.5 7.5v6M7.5 10.5h6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" fill="none" />,
  zoomOut: <path d="M10.5 4a6.5 6.5 0 1 1 0 13 6.5 6.5 0 0 1 0-13Zm5 11.5L20 20M7.5 10.5h6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" fill="none" />,
  external: <path d="M14 4h6v6M20 4l-9 9M18 14v4.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" />,
  refresh: <path d="M20 12a8 8 0 1 1-2.3-5.7M20 4v4.5h-4.5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" fill="none" />,
  warning: <path d="M12 3.5 2.5 20h19zM12 10v4.5M12 17.3v.2" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" fill="none" />,
  link: <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" fill="none" />,
};

export function Icon({ name, className = 'size-5' }: { name: IconName; className?: string }) {
  return <svg viewBox="0 0 24 24" aria-hidden="true" className={className}>{PATHS[name]}</svg>;
}

export function Modal({ title, onClose, children, wide = false, icon }: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
  icon?: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      onCancel={(event) => { event.preventDefault(); onClose(); }}
      onClick={(event) => { if (event.target === ref.current) onClose(); }}
      className={`card m-auto max-h-[92dvh] w-[calc(100%-1.5rem)] overflow-hidden p-0 text-ink backdrop:bg-ink/40 backdrop:backdrop-blur-sm dark:text-violet-50 ${wide ? 'max-w-3xl' : 'max-w-lg'} animate-pop-in bg-white dark:bg-night-2`}
    >
      <div className="flex max-h-[92dvh] flex-col">
        <header className="flex items-center gap-3 border-b-2 border-ink/10 px-5 py-4 dark:border-white/10">
          {icon}
          <h2 className="flex-1 font-display text-2xl font-semibold">{title}</h2>
          <button type="button" className="icon-btn size-9" onClick={onClose} aria-label="Close">
            <Icon name="close" className="size-4" />
          </button>
        </header>
        <div className="overflow-y-auto px-5 py-5">{children}</div>
      </div>
    </dialog>
  );
}

export function QrCode({ value, size = 200 }: { value: string; size?: number }) {
  const [svg, setSvg] = useState('');
  useEffect(() => {
    let cancelled = false;
    QRCode.toString(value, { type: 'svg', margin: 1, errorCorrectionLevel: 'M', color: { dark: '#1b1540', light: '#ffffff' } })
      .then((result) => { if (!cancelled) setSvg(result); })
      .catch(() => setSvg(''));
    return () => { cancelled = true; };
  }, [value]);
  return (
    <div
      className="overflow-hidden rounded-2xl border-2 border-ink bg-white p-1 shadow-[0_4px_0_0_var(--color-ink)] dark:border-black"
      style={{ width: size, height: size }}
      role="img"
      aria-label={`QR code for ${value}`}
      // The SVG is generated locally from the address by the qrcode library.
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

export function CopyButton({ text, label = 'Copy', className = 'btn-ghost btn-sm' }: { text: string; label?: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className={className}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          window.prompt('Copy this:', text);
        }
      }}
    >
      <Icon name={copied ? 'check' : 'copy'} className="size-4" />
      {copied ? 'Copied!' : label}
    </button>
  );
}

export function AddressCard({ label, address, description, primary = false, qrSize = 176 }: {
  label: string;
  address: string;
  description: string;
  primary?: boolean;
  qrSize?: number;
}) {
  return (
    <div className={`flex flex-col items-center gap-3 rounded-3xl border-2 p-4 text-center sm:flex-row sm:items-start sm:text-left ${
      primary ? 'border-mint bg-mint/10' : 'border-ink/10 dark:border-white/10'
    }`}>
      <QrCode value={address} size={qrSize} />
      <div className="min-w-0 flex-1 space-y-2">
        <div className="font-display text-lg font-semibold">{label}</div>
        <p className="text-sm text-ink/70 dark:text-violet-100/70">{description}</p>
        <code className="block rounded-xl bg-ink/5 p-2 text-xs break-all dark:bg-white/5">{address}</code>
        <CopyButton text={address} label="Copy address" />
      </div>
    </div>
  );
}

/** A tiny animated glider for the logo. */
export function GliderLogo({ className = 'size-9' }: { className?: string }) {
  const frames = [
    [[1, 0], [2, 1], [0, 2], [1, 2], [2, 2]],
    [[0, 1], [2, 1], [1, 2], [2, 2], [1, 3]],
    [[2, 1], [0, 2], [2, 2], [1, 3], [2, 3]],
    [[1, 1], [2, 2], [3, 2], [1, 3], [2, 3]],
  ];
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setFrame((f) => (f + 1) % frames.length), 600);
    return () => clearInterval(timer);
  }, [frames.length]);
  const colors = ['#ff7ac6', '#ffc93c', '#3ddc84', '#38bdf8', '#8b5cf6'];
  return (
    <svg viewBox="0 0 4 4" className={className} aria-hidden="true">
      <rect width="4" height="4" rx="0.9" className="fill-ink dark:fill-night-3" />
      {frames[frame].map(([x, y], i) => (
        <rect key={i} x={x + 0.12} y={y + 0.12} width="0.76" height="0.76" rx="0.22" fill={colors[i]} />
      ))}
    </svg>
  );
}

export function Stat({ label, value, accent }: { label: string; value: ReactNode; accent?: string }) {
  return (
    <div className="rounded-2xl bg-ink/5 px-3 py-2 dark:bg-white/5">
      <div className="text-[0.65rem] font-bold tracking-widest text-ink/50 uppercase dark:text-violet-200/50">{label}</div>
      <div className={`font-display text-xl font-semibold ${accent ?? ''}`}>{value}</div>
    </div>
  );
}
