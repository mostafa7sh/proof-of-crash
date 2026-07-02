import type { ReactNode } from 'react';
import { motion } from 'framer-motion';
import { fadeUp, fadeIn, fadeLeft, fadeRight } from './variants';

type Direction = 'up' | 'in' | 'left' | 'right';

const VARIANTS = { up: fadeUp, in: fadeIn, left: fadeLeft, right: fadeRight };

interface Props {
  children: ReactNode;
  /** Entrance direction. Transform directions are auto-neutralised under reduced-motion. */
  direction?: Direction;
  /** Extra delay (seconds) before this element animates. */
  delay?: number;
  className?: string;
  /** Animate every time it enters view, or just once (default). */
  once?: boolean;
}

/**
 * Drop-in scroll reveal: fades (and optionally slides) its children in when they
 * scroll into view, using framer-motion's IntersectionObserver-backed
 * `whileInView` (no scroll listeners). The single reusable primitive behind the
 * landing page's subtle entrance animations.
 */
export function Reveal({ children, direction = 'up', delay = 0, className, once = true }: Props) {
  const base = VARIANTS[direction];
  const variants = delay
    ? { hidden: base.hidden, show: { ...base.show, transition: { ...(base.show as { transition?: object }).transition, delay } } }
    : base;

  return (
    <motion.div
      className={className}
      variants={variants}
      initial="hidden"
      whileInView="show"
      viewport={{ once, margin: '-80px' }}
    >
      {children}
    </motion.div>
  );
}
