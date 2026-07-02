import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, FileCode, Bug, Upload, Clock, User, Hash as HashIcon, CheckCircle2 } from 'lucide-react';
import { useApp, useAppSource, useProofs } from '../hooks/useData';
import { Card } from '../components/Card';
import { Badge } from '../components/Badge';
import { CodeBlockBadge } from '../components/BlockType';
import { Button } from '../components/Button';
import { Hash } from '../components/Hash';
import { Uuid } from '../components/Uuid';
import { AsyncBoundary, EmptyState } from '../components/states';
import { formatDate, formatAmount, statusVariant } from '../utils/format';
import { looksLikeUuid } from '../utils/validation';

// Application detail — the single home for everything about one uploaded target:
// its UUID, source code, and every crash proof filed against it. Reached from the
// mempool, the explorer (block submissions), and proof pages. From here a user
// can submit a proof with the target id already pre-filled.
export function Application() {
  const { appId = '' } = useParams();
  const navigate = useNavigate();
  const valid = looksLikeUuid(appId);

  const app = useApp(appId);
  const source = useAppSource(appId);
  const proofs = useProofs({ app_id: valid ? appId : undefined, page: 1, page_size: 50 });

  if (!valid) {
    return (
      <div className="page stack gap-lg">
        <BackLink onClick={() => navigate(-1)} />
        <Card>
          <EmptyState>“{appId}” is not a valid application UUID. Copy the App UUID from a mempool card and try again.</EmptyState>
        </Card>
      </div>
    );
  }

  return (
    <div className="page stack gap-lg">
      <BackLink onClick={() => navigate(-1)} />

      <AsyncBoundary loading={app.loading} error={app.error} data={app.data} onRetry={app.reload}>
        {(a) => {
          // An app is "completed" once one of its proofs has been accepted into
          // the ledger. Bug hunting is a race: the winning proof is the only one
          // that counts, and the app no longer accepts new submissions.
          const acceptedProof = proofs.data?.data.find((p) => p.status === 'finalized');
          const completed = !!acceptedProof;
          return (
          <>
            <div className="row-between wrap" style={{ gap: 16 }}>
              <div className="stack-sm">
                <h1 className="row gap-sm"><FileCode style={{ width: 28, height: 28, color: 'var(--cyan-400)' }} /> {a.name}</h1>
                <div className="row gap-sm wrap">
                  <CodeBlockBadge hasConfirmedBug={completed} />
                  <Badge variant="neutral">{a.language}</Badge>
                  <Uuid value={a.app_id} label="App UUID" />
                </div>
              </div>
              {completed ? (
                <div className="stack-sm" style={{ alignItems: 'flex-end' }}>
                  <Badge variant="green" dot icon={<CheckCircle2 style={{ width: 13, height: 13 }} />}>Completed</Badge>
                  <Link to={`/proofs/${acceptedProof!.proof_id}`} className="text-sm mono cyan">View accepted proof →</Link>
                </div>
              ) : (
                <Link to={`/submit?app=${a.app_id}`}>
                  <Button><Bug /> Submit a proof for this app</Button>
                </Link>
              )}
            </div>

            {completed && (
              <div className="alert alert-success">
                This application has a confirmed bug accepted into the blockchain ledger — it is{' '}
                <strong>completed</strong> and closed to new proofs. The accepted proof is the official
                result; any competing submissions can no longer be accepted.
              </div>
            )}

            <Card title="Application">
              {a.description && <p className="muted" style={{ marginBottom: 18 }}>{a.description}</p>}
              <div className="grid grid-2" style={{ gap: 16 }}>
                <div className="info-tile"><HashIcon /><div><div className="lbl">Application UUID</div><div className="val"><Uuid value={a.app_id} /></div></div></div>
                <div className="info-tile"><User /><div><div className="lbl">Author</div><div className="val"><Hash value={a.developer_address} /></div></div></div>
                <div className="info-tile"><Clock /><div><div className="lbl">Uploaded</div><div className="val">{formatDate(a.uploaded_at)}</div></div></div>
                <div className="info-tile"><FileCode /><div><div className="lbl">Language</div><div className="val">{a.language}</div></div></div>
              </div>
              <div style={{ marginTop: 18 }}>
                <p className="mono text-xs muted" style={{ marginBottom: 8 }}>Content hash — SHA-256(source)</p>
                <div className="code-block">{a.content_hash}</div>
              </div>
            </Card>

            <Card title="Source Code">
              <AsyncBoundary loading={source.loading} error={source.error} data={source.data} onRetry={source.reload}>
                {(s) => (
                  <div className="stack-sm">
                    <p className="faint text-xs mono">{s.size_bytes.toLocaleString()} bytes · {s.language}</p>
                    <pre className="source-view">{s.source_code}</pre>
                  </div>
                )}
              </AsyncBoundary>
            </Card>

            <Card title={`Crash proofs against this app (${proofs.data?.total ?? 0})`} noPad>
              <AsyncBoundary
                loading={proofs.loading}
                error={proofs.error}
                data={proofs.data}
                onRetry={proofs.reload}
                isEmpty={(d) => d.data.length === 0}
                empty={
                  <div style={{ padding: 24 }} className="stack-sm">
                    <EmptyState>No proofs yet — this app is in the mempool awaiting bug reports.</EmptyState>
                    <div><Link to={`/submit?app=${a.app_id}`}><Button variant="ghost"><Upload /> Be the first to submit a proof</Button></Link></div>
                  </div>
                }
              >
                {(d) => (
                  <div className="table-wrap">
                    <table className="table">
                      <thead><tr><th>Proof</th><th>Tester</th><th>Status</th><th>Reward</th><th>Submitted</th></tr></thead>
                      <tbody>
                        {d.data.map((p) => (
                          <tr key={p.proof_id} className="clickable" onClick={() => navigate(`/proofs/${p.proof_id}`)}>
                            <td><Hash value={p.proof_id} copyable={false} /></td>
                            <td><Hash value={p.tester_address} copyable={false} /></td>
                            <td><Badge variant={statusVariant(p.status) as never} dot pulse={p.status === 'voting'}>{p.status}</Badge></td>
                            <td className="mono cyan">{p.reward_score != null ? formatAmount(p.reward_score) : '—'}</td>
                            <td className="muted text-sm nowrap">{formatDate(p.submitted_at)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </AsyncBoundary>
            </Card>
          </>
          );
        }}
      </AsyncBoundary>
    </div>
  );
}

function BackLink({ onClick }: { onClick: () => void }) {
  return (
    <button className="row gap-sm muted text-sm" onClick={onClick} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, width: 'fit-content' }}>
      <ArrowLeft style={{ width: 16, height: 16 }} /> Back
    </button>
  );
}
