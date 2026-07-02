import type { Variants } from 'framer-motion';

// Shared easing — a gentle ease-out used across every landing animation so the
// motion language stays consistent. Short durations keep things snappy.
export const EASE = [0.22, 0.61, 0.36, 1] as const;
export const DURATION = 0.55;

/**
 * Parent container that staggers its children into view. Pair with `fadeUp`
 * (or any *Item variant) on the children. Reduced-motion is handled globally by
 * <MotionConfig reducedMotion="user">, which neutralises the transforms while
 * keeping the opacity fade.
 */
export const staggerContainer = (stagger = 0.1, delayChildren = 0): Variants => ({
  hidden: {},
  show: { transition: { staggerChildren: stagger, delayChildren } },
});

export const fadeUp: Variants = {
  hidden: { opacity: 0, y: 22 },
  show: { opacity: 1, y: 0, transition: { duration: DURATION, ease: EASE } },
};

export const fadeIn: Variants = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { duration: DURATION, ease: EASE } },
};

export const fadeLeft: Variants = {
  hidden: { opacity: 0, x: 28 },
  show: { opacity: 1, x: 0, transition: { duration: DURATION, ease: EASE } },
};

export const fadeRight: Variants = {
  hidden: { opacity: 0, x: -28 },
  show: { opacity: 1, x: 0, transition: { duration: DURATION, ease: EASE } },
};
