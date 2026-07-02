import { useEffect, useRef, useState } from 'react';
import { useReducedMotion } from 'framer-motion';

interface Options {
  /** Final value to count up to. */
  to: number;
  /** Start the animation. Pass an in-view flag so it runs when scrolled into view. */
  start: boolean;
  /** Duration in ms. Kept short for snappy, non-distracting motion. */
  duration?: number;
  /** Decimal places to render. */
  decimals?: number;
}

/**
 * Animate a number from 0 → `to` once `start` becomes true, using
 * requestAnimationFrame (no timers, no deps). Honors reduced-motion by jumping
 * straight to the final value. Returns the current display value.
 */
export function useCountUp({ to, start, duration = 1400, decimals = 0 }: Options): number {
  const reduce = useReducedMotion();
  const [value, setValue] = useState(0);
  const frame = useRef<number | null>(null);
  const done = useRef(false);

  useEffect(() => {
    if (!start || done.current) return;

    if (reduce || to === 0) {
      setValue(to);
      done.current = true;
      return;
    }

    const startTime = performance.now();
    // easeOutCubic — fast start, gentle settle.
    const ease = (t: number) => 1 - Math.pow(1 - t, 3);
    const round = (n: number) => {
      const f = 10 ** decimals;
      return Math.round(n * f) / f;
    };

    const tick = (now: number) => {
      const t = Math.min(1, (now - startTime) / duration);
      setValue(round(to * ease(t)));
      if (t < 1) {
        frame.current = requestAnimationFrame(tick);
      } else {
        done.current = true;
      }
    };

    frame.current = requestAnimationFrame(tick);
    return () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    };
  }, [start, to, duration, decimals, reduce]);

  return value;
}
