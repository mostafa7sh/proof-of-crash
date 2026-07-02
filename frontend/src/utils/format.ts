// Display formatting helpers.

/** Truncate a hash/address to `0x1234…abcd` style (hex assumed). */
export function truncate(hash: string | null | undefined, head = 6, tail = 4): string {
  if (!hash) return '—';
  if (hash.length <= head + tail + 1) return hash;
  return `${hash.slice(0, head)}…${hash.slice(-tail)}`;
}

/** Unix seconds → human readable absolute date. */
export function formatDate(unixSeconds: number | string | null | undefined): string {
  if (unixSeconds === null || unixSeconds === undefined) return '—';
  const ms = Number(unixSeconds) * 1000;
  if (!Number.isFinite(ms)) return '—';
  return new Date(ms).toLocaleString();
}

/** Relative time, e.g. "in 3 days" / "2 hours ago". */
export function relativeTime(unixSeconds: number | string | null | undefined): string {
  if (unixSeconds === null || unixSeconds === undefined) return '—';
  const target = Number(unixSeconds) * 1000;
  const diffMs = target - Date.now();
  const abs = Math.abs(diffMs);
  const units: [number, string][] = [
    [86400000, 'day'],
    [3600000, 'hour'],
    [60000, 'minute'],
    [1000, 'second'],
  ];
  for (const [ms, label] of units) {
    if (abs >= ms || label === 'second') {
      const n = Math.round(abs / ms);
      const plural = n === 1 ? label : `${label}s`;
      return diffMs >= 0 ? `in ${n} ${plural}` : `${n} ${plural} ago`;
    }
  }
  return '—';
}

/** PoC token amount with thousands separators. */
export function formatAmount(amount: number | null | undefined): string {
  if (amount === null || amount === undefined || !Number.isFinite(Number(amount))) return '0';
  return Number(amount).toLocaleString(undefined, { maximumFractionDigits: 8 });
}

const STATUS_VARIANT: Record<string, string> = {
  finalized: 'accent',
  voting: 'info',
  pending: 'warn',
  rejected: 'danger',
  archived: 'neutral',
};
export function statusVariant(status: string): string {
  return STATUS_VARIANT[status] ?? 'neutral';
}
