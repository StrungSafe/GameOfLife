export const formatSats = (value: bigint | number, short = false): string => {
  const n = Number(value);
  if (short && n >= 1_000_000) return `${(n / 100_000_000).toFixed(n >= 10_000_000 ? 2 : 4)} BCH`;
  if (short && n >= 10_000) return `${Math.round(n / 1000).toLocaleString('en-US')}k sats`;
  return `${n.toLocaleString('en-US')} sats`;
};

export const END_REASONS: Record<string, { title: string; emoji: string }> = {
  extinct: { title: 'Everyone died out', emoji: '💀' },
  still: { title: 'Frozen in a still life', emoji: '🧊' },
  oscillating: { title: 'Stuck in a loop', emoji: '🔁' },
  limit: { title: 'Reached the generation limit', emoji: '🏁' },
};

export const shortTxid = (txid: string): string => `${txid.slice(0, 8)}…${txid.slice(-6)}`;

export const friendlyErrorText = (error: unknown): string => {
  const message = error instanceof Error ? error.message : String(error);
  if (/missing inputs|mempool conflict|already spent|txn-mempool-conflict|bad-txns-inputs/i.test(message)) {
    return 'Someone else moved first! The board has been refreshed - try again.';
  }
  if (/timeout|websocket|connect/i.test(message)) {
    return `Could not reach the server. Check your connection or pick another server in the settings. (${message})`;
  }
  return message;
};
