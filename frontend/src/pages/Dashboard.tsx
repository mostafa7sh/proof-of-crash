import { Link } from 'react-router-dom';
import {
  TrendingUp, Coins, CheckCircle, Wallet, Clock, ExternalLink, Bug,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useSupply, useLatestBlock, useBalance, useProofs } from '../hooks/useData';
import { StatCard, Card } from '../components/Card';
import { Badge } from '../components/Badge';
import { Hash } from '../components/Hash';
import { Loading, ErrorState } from '../components/states';
import { formatAmount, formatDate, statusVariant, relativeTime } from '../utils/format';
import type { CrashProof } from '../types';

export function Dashboard() {
  const { user } = useAuth();
  const supply = useSupply();
  const balance = useBalance(user?.address ?? null);
  const latest = useLatestBlock();
  const recent = useProofs({ page: 1, page_size: 6 });

  return (
    <div className="page stack gap-lg">
      <div className="page-header">
        <h1>Dashboard</h1>
        <p className="muted mono text-sm">Address: {user?.address ?? '—'}</p>
      </div>

      {/* Stats */}
      <div className="grid grid-4">
        <StatCard
          icon={<TrendingUp />}
          accent="cyan"
          label="Reputation Score"
          value={user ? formatAmount(user.reputation) : '0'}
        />
        <StatCard
          icon={<Coins />}
          accent="emerald"
          label="Token Balance"
          value={balance.loading ? '…' : formatAmount(balance.data?.balance ?? 0)}
          sub="POC"
        />
        <StatCard
          icon={<CheckCircle />}
          accent="blue"
          label="Chain Height"
          value={supply.loading ? '…' : (supply.data?.tip.height ?? 0)}
          sub="blocks"
        />
        <StatCard
          icon={<Wallet />}
          accent="purple"
          label="Total Supply"
          value={supply.loading ? '…' : formatAmount(supply.data?.total_supply ?? 0)}
          sub="POC minted"
        />
      </div>

      {/* Recent bug proofs as cards */}
      <section>
        <div className="row-between" style={{ marginBottom: 20 }}>
          <h2>Recent Bug Proofs</h2>
          <Link to="/proofs" className="row gap-sm mono text-sm">
            View All <ExternalLink style={{ width: 16, height: 16 }} />
          </Link>
        </div>

        {recent.loading ? (
          <Loading />
        ) : recent.error ? (
          <ErrorState message={recent.error} onRetry={recent.reload} />
        ) : recent.data && recent.data.data.length > 0 ? (
          <div className="grid grid-3">
            {recent.data.data.map((p) => <ProofCard key={p.proof_id} proof={p} />)}
          </div>
        ) : (
          <Card>
            <div className="state" style={{ padding: 32 }}>
              <Bug style={{ width: 32, height: 32, color: 'var(--text-faint)' }} />
              <p className="muted">No bug proofs submitted yet.</p>
              <Link to="/submit" className="btn btn-primary"><Bug /> Submit the first proof</Link>
            </div>
          </Card>
        )}
      </section>

      {/* Latest block */}
      <section>
        <h2 style={{ marginBottom: 20 }}>Latest Block</h2>
        <Card>
          {latest.loading ? (
            <Loading />
          ) : latest.data ? (
            <dl className="dl">
              <dt>Height</dt><dd>#{String(latest.data.block_number)}</dd>
              <dt>Hash</dt><dd><Hash value={latest.data.block_hash} head={14} tail={10} /></dd>
              <dt>Merkle root</dt><dd><Hash value={latest.data.merkle_root} head={14} tail={10} /></dd>
              <dt>Timestamp</dt><dd>{formatDate(latest.data.timestamp)}</dd>
              <dt>Proofs</dt><dd>{latest.data.proofs?.length ?? 0}</dd>
            </dl>
          ) : (
            <p className="muted text-sm">No blocks yet — the genesis block appears once the engine starts.</p>
          )}
        </Card>
      </section>
    </div>
  );
}

function ProofCard({ proof }: { proof: CrashProof }) {
  return (
    <Link
      to={`/proofs/${proof.proof_id}`}
      className="card card-hover stack-sm"
      style={{ textDecoration: 'none', color: 'inherit' }}
    >
      <div className="row-between">
        <Hash value={proof.proof_id} copyable={false} head={8} tail={6} />
        <Badge variant={statusVariant(proof.status) as never} dot pulse={proof.status === 'voting'}>
          {proof.status}
        </Badge>
      </div>
      <div className="row gap-sm text-sm muted" style={{ marginTop: 4 }}>
        <Bug style={{ width: 14, height: 14, color: 'var(--cyan-400)' }} />
        <span className="mono">target {proof.app_id.slice(0, 8)}…</span>
      </div>
      <div className="row-between text-sm" style={{ marginTop: 8 }}>
        <span className="muted">Reward score</span>
        <span className="cyan mono">{proof.reward_score != null ? formatAmount(proof.reward_score) : '—'}</span>
      </div>
      <div className="row gap-sm faint text-xs mono" style={{ marginTop: 4 }}>
        <Clock style={{ width: 12, height: 12 }} />
        {relativeTime(proof.submitted_at)}
      </div>
    </Link>
  );
}
