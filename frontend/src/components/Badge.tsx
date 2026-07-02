import type { ReactNode } from 'react';

type Variant = 'accent' | 'info' | 'warn' | 'danger' | 'purple' | 'green' | 'orange' | 'neutral';

export function Badge({
  variant = 'neutral',
  dot = false,
  pulse = false,
  icon,
  children,
}: {
  variant?: Variant;
  dot?: boolean;
  pulse?: boolean;
  icon?: ReactNode;
  children: ReactNode;
}) {
  return (
    <span className={`badge badge-${variant}`}>
      {dot && <span className={`dot ${pulse ? 'dot-pulse' : ''}`} />}
      {icon}
      {children}
    </span>
  );
}
