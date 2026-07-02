import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Upload } from 'lucide-react';
import { useProofs } from '../hooks/useData';
import { Card } from '../components/Card';
import { Badge } from '../components/Badge';
import { Hash } from '../components/Hash';
import { Button } from '../components/Button';
import { Pagination } from '../components/Pagination';
import { AsyncBoundary, EmptyState } from '../components/states';
import { formatAmount, formatDate, statusVariant } from '../utils/format';
import type { ProofStatus } from '../types';

// Rejected proofs are never surfaced (they are clutter); the default "All" view
// already excludes them server-side.
const FILTERS: Array<{ label: string; value: ProofStatus | 'all' }> = [
  { label: 'All', value: 'all' },
  { label: 'Voting', value: 'voting' },
  { label: 'Finalized', value: 'finalized' },
  { label: 'Archived', value: 'archived' },
];

const PAGE_SIZE = 20;

export function Proofs() {
  const navigate = useNavigate();
  const [status, setStatus] = useState<ProofStatus | 'all'>('all');
  const [page, setPage] = useState(1);

  const { data, loading, error, reload } = useProofs({
    page,
    page_size: PAGE_SIZE,
    ...(status !== 'all' ? { status } : {}),
  });

  const changeFilter = (value: ProofStatus | 'all') => {
    setStatus(value);
    setPage(1);
  };

  return (
    <div className="page stack">
      <div className="row-between wrap page-header">
        <div>
          <h1>Bug Proofs</h1>
          <p className="muted">Crash proofs submitted by the community, awaiting or past consensus.</p>
        </div>
        <Button onClick={() => navigate('/submit')}><Upload /> Submit Proof</Button>
      </div>

      <div className="tabs">
        {FILTERS.map((f) => (
          <button
            key={f.value}
            className={`tab ${status === f.value ? 'active' : ''}`}
            onClick={() => changeFilter(f.value)}
          >
            {f.label}
          </button>
        ))}
      </div>

      <Card noPad>
        <AsyncBoundary
          loading={loading}
          error={error}
          data={data}
          onRetry={reload}
          isEmpty={(d) => d.data.length === 0}
          empty={<EmptyState>No proofs match this filter.</EmptyState>}
        >
          {(d) => (
            <>
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Proof</th>
                      <th>Tester</th>
                      <th>Status</th>
                      <th>Score</th>
                      <th>Submitted</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.data.map((p) => (
                      <tr key={p.proof_id} className="clickable" onClick={() => navigate(`/proofs/${p.proof_id}`)}>
                        <td><Hash value={p.proof_id} copyable={false} /></td>
                        <td><Hash value={p.tester_address} copyable={false} /></td>
                        <td>
                          <Badge variant={statusVariant(p.status) as never} dot pulse={p.status === 'voting'}>
                            {p.status}
                          </Badge>
                        </td>
                        <td className="mono">{p.reward_score != null ? formatAmount(p.reward_score) : '—'}</td>
                        <td className="muted text-sm nowrap">{formatDate(p.submitted_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pagination page={page} pageSize={PAGE_SIZE} total={d.total} onPage={setPage} />
            </>
          )}
        </AsyncBoundary>
      </Card>
    </div>
  );
}
