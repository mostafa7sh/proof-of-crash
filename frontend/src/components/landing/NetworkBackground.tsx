import { useMemo } from 'react';

interface Node { x: number; y: number; r: number }

// Deterministic node field (viewBox is 1000×600). Hand-tuned spread so the
// network reads as a security/blockchain mesh rather than random noise.
const NODES: Node[] = [
  { x: 80, y: 120, r: 4 }, { x: 210, y: 70, r: 3 }, { x: 330, y: 180, r: 5 },
  { x: 180, y: 280, r: 3 }, { x: 60, y: 400, r: 4 }, { x: 280, y: 460, r: 3 },
  { x: 430, y: 330, r: 4 }, { x: 500, y: 110, r: 3 }, { x: 620, y: 220, r: 5 },
  { x: 560, y: 420, r: 3 }, { x: 700, y: 500, r: 4 }, { x: 760, y: 130, r: 3 },
  { x: 850, y: 300, r: 5 }, { x: 920, y: 470, r: 3 }, { x: 940, y: 180, r: 4 },
  { x: 400, y: 540, r: 3 },
];

// Connect nodes closer than the threshold — precomputed once.
const LINKS: Array<[Node, Node]> = (() => {
  const out: Array<[Node, Node]> = [];
  const THRESHOLD = 230;
  for (let i = 0; i < NODES.length; i++) {
    for (let j = i + 1; j < NODES.length; j++) {
      const a = NODES[i]!, b = NODES[j]!;
      if (Math.hypot(a.x - b.x, a.y - b.y) < THRESHOLD) out.push([a, b]);
    }
  }
  return out;
})();

/**
 * Lightweight animated node mesh rendered as a single scalable SVG. Pure
 * CSS keyframes (opacity/scale only) drive a gentle pulse; nothing runs on the
 * main thread per-frame. Decorative + non-interactive, and fully stilled under
 * prefers-reduced-motion (see landing.css).
 */
export function NetworkBackground({ className = '' }: { className?: string }) {
  // Stable per-node animation delays so the pulse looks organic, not in lockstep.
  const delays = useMemo(() => NODES.map((_, i) => ((i * 0.37) % 4).toFixed(2)), []);

  return (
    <svg
      className={`net-bg ${className}`}
      viewBox="0 0 1000 600"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
      focusable="false"
    >
      <g className="net-links">
        {LINKS.map(([a, b], i) => (
          <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} />
        ))}
      </g>
      <g className="net-nodes">
        {NODES.map((n, i) => (
          <circle key={i} cx={n.x} cy={n.y} r={n.r} style={{ animationDelay: `${delays[i]}s` }} />
        ))}
      </g>
    </svg>
  );
}
