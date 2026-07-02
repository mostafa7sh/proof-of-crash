import { useState } from 'react';
import { Copy, Check } from 'lucide-react';
import { truncate } from '../utils/format';

interface Props {
  value: string | null | undefined;
  full?: boolean;
  head?: number;
  tail?: number;
  copyable?: boolean;
}

/** Monospace hash/address chip with optional copy-to-clipboard. */
export function Hash({ value, full = false, head = 6, tail = 4, copyable = true }: Props) {
  const [copied, setCopied] = useState(false);
  if (!value) return <span className="hash">—</span>;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      /* clipboard unavailable */
    }
  };

  return (
    <span className="hash" title={value}>
      {full ? value : truncate(value, head, tail)}
      {copyable && (
        <button className="hash-copy" onClick={copy} aria-label="Copy" type="button">
          {copied ? <Check /> : <Copy />}
        </button>
      )}
    </span>
  );
}
