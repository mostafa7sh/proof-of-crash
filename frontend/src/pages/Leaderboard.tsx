import { Trophy, Coins, Bug, ShieldCheck, ArrowUpRight, ArrowDownLeft, Medal } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useLeaderboard } from '../hooks/useData';
import { Card } from '../components/Card';
import { Hash } from '../components/Hash';
import { AsyncBoundary, EmptyState } from '../components/states';
import { formatAmount } from '../utils/format';
import type { LeaderboardCategory } from '../types';

// Per-category icon (keyed; falls back to the trophy for future categories).
const ICONS: Record<string, LucideIcon> = {
  coins: Coins,
  proofs: ShieldCheck,
  bugs: Bug,
  sent: ArrowUpRight,
  received: ArrowDownLeft,
};

export function Leaderboard() {
  const board = useLeaderboard();

  return (
    <div className="page stack gap-lg">
      <div className="page-header">
        <h1 className="row gap-sm"><Trophy style={{ width: 28, height: 28, color: 'var(--cyan-400)' }} /> Leaderboard</h1>
        <p className="muted">Top researchers, developers, and holders — ranked from the on-chain record.</p>
      </div>

      <AsyncBoundary loading={board.loading} error={board.error} data={board.data} onRetry={board.reload}>
        {(d) => (
          <div className="grid grid-2">
            {d.categories.map((c) => <CategoryCard key={c.key} category={c} />)}
          </div>
        )}
      </AsyncBoundary>
    </div>
  );
}

function CategoryCard({ category }: { category: LeaderboardCategory }) {
  const Icon = ICONS[category.key] ?? Trophy;
  const fmt = (v: number) => (category.unit === 'POC' ? `${formatAmount(v)} POC` : `${v} ${category.unit}`);

  return (
    <Card
      title={<span className="row gap-sm"><Icon style={{ width: 18, height: 18, color: 'var(--cyan-400)' }} /> {category.title}</span>}
    >
      <p className="muted text-sm" style={{ marginTop: -6, marginBottom: 16 }}>{category.description}</p>
      {category.entries.length === 0 ? (
        <EmptyState>No entries yet.</EmptyState>
      ) : (
        <ol className="leaderboard">
          {category.entries.map((e, i) => (
            <li key={e.address} className="lb-row">
              <span className={`lb-rank ${i < 3 ? `lb-rank-${i + 1}` : ''}`}>
                {i < 3 ? <Medal style={{ width: 15, height: 15 }} /> : i + 1}
              </span>
              <span className="lb-addr"><Hash value={e.address} head={10} tail={6} /></span>
              <span className="lb-value mono cyan">{fmt(e.value)}</span>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}
