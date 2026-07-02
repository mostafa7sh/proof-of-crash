import { useRef } from 'react';
import { useInView } from 'framer-motion';
import { useCountUp } from '../../hooks/useCountUp';

interface Props {
  value: number;
  decimals?: number;
  /** Rendered before the number, e.g. a currency-style glyph. */
  prefix?: string;
  /** Rendered after the number, e.g. "+" or "POC". */
  suffix?: string;
  /** Thousands separators (default true). */
  separator?: boolean;
  className?: string;
}

/**
 * Counts up to `value` the first time it scrolls into view. Lightweight: a
 * single IntersectionObserver (framer's useInView) drives the rAF-based
 * useCountUp hook, which jumps straight to the value under reduced-motion.
 */
export function CountUp({ value, decimals = 0, prefix = '', suffix = '', separator = true, className }: Props) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: '-60px' });
  const n = useCountUp({ to: value, start: inView, decimals });

  const text = separator
    ? n.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
    : n.toFixed(decimals);

  return (
    <span ref={ref} className={className}>
      {prefix}{text}{suffix}
    </span>
  );
}
