import type { ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Button } from './Button';

export function Spinner({ size = 22 }: { size?: number }) {
  return <span className="spinner" style={{ width: size, height: size }} />;
}

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="state">
      <Spinner />
      <span>{label}</span>
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="state state-error">
      <span className="row" style={{ gap: 8 }}><AlertTriangle style={{ width: 18, height: 18 }} /> {message}</span>
      {onRetry && (
        <Button variant="secondary" size="sm" onClick={onRetry}>
          Retry
        </Button>
      )}
    </div>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <div className="state">{children}</div>;
}

/**
 * Standard async wrapper: shows Loading / ErrorState / empty / content based on
 * the state from useAsync. Keeps every screen's loading + error handling uniform.
 */
export function AsyncBoundary<T>({
  loading,
  error,
  data,
  onRetry,
  isEmpty,
  empty,
  children,
}: {
  loading: boolean;
  error: string | null;
  data: T | null;
  onRetry?: () => void;
  isEmpty?: (data: T) => boolean;
  empty?: ReactNode;
  children: (data: T) => ReactNode;
}) {
  if (loading && data === null) return <Loading />;
  if (error) return <ErrorState message={error} onRetry={onRetry} />;
  if (data === null) return <Loading />;
  if (isEmpty && isEmpty(data)) return <>{empty ?? <EmptyState>Nothing here yet.</EmptyState>}</>;
  return <>{children(data)}</>;
}
