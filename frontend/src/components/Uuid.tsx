import { useState, type MouseEvent } from 'react';
import { Copy, Check } from 'lucide-react';

interface Props {
  value: string;
  /** Small caption rendered before the value, e.g. "App UUID". */
  label?: string;
  /** Show `head…tail` instead of the full id (full id is always in the copy). */
  truncate?: boolean;
}

/**
 * Monospace, copy-to-clipboard identifier display. Used for application UUIDs
 * across the mempool, explorer, and detail pages so an id is always readable
 * and one click away from being pasted into the proof form.
 */
export function Uuid({ value, label, truncate = false }: Props) {
  const [copied, setCopied] = useState(false);

  const copy = async (e: MouseEvent) => {
    // Safe to use inside clickable cards/links — don't trigger their navigation.
    e.preventDefault();
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      /* clipboard unavailable */
    }
  };

  const shown = truncate ? `${value.slice(0, 8)}…${value.slice(-6)}` : value;

  return (
    <span className="uuid" title={value}>
      {label && <span className="uuid-label">{label}</span>}
      <code className="uuid-val">{shown}</code>
      <button className="hash-copy" type="button" onClick={copy} aria-label={`Copy ${label ?? 'UUID'}`}>
        {copied ? <Check /> : <Copy />}
      </button>
    </span>
  );
}
