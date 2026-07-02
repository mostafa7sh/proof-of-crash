import type { ReactNode } from 'react';

interface Props {
  title?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  noPad?: boolean;
}

export function Card({ title, actions, children, className = '', noPad = false }: Props) {
  return (
    <section className={`card ${noPad ? 'card-pad-0' : ''} ${className}`}>
      {(title || actions) && (
        <div
          className="row-between"
          style={{
            marginBottom: noPad ? 0 : 18,
            padding: noPad ? '18px 24px' : 0,
            borderBottom: noPad ? '1px solid var(--border-soft)' : 'none',
          }}
        >
          {title && <h3>{title}</h3>}
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

type Accent = 'cyan' | 'emerald' | 'blue' | 'purple' | 'yellow' | 'red';

/**
 * Dashboard stat card. Matches the Figma layout: an accent-coloured lucide icon
 * top-left, an optional trend chip top-right, then label + big value + subtitle.
 */
export function StatCard({
  label,
  value,
  sub,
  icon,
  trend,
  accent = 'cyan',
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  icon?: ReactNode;
  trend?: ReactNode;
  accent?: Accent;
}) {
  return (
    <div className="card stat">
      {(icon || trend) && (
        <div className="row-between" style={{ alignItems: 'flex-start' }}>
          {icon && <span className={`stat-icon accent-${accent}`}>{icon}</span>}
          {trend && <span className="stat-trend">{trend}</span>}
        </div>
      )}
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );
}
