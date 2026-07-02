import { useParams, Link } from 'react-router-dom';
import { ArrowLeft, Shield, FileCode, Code, Users, CheckCircle, XCircle, Boxes, Coins, Bug, ArrowRightLeft, Sparkles } from 'lucide-react';
import { useBlock, useAppSource, useVerifications, useAiVerifications } from '../hooks/useData';
import { Card } from '../components/Card';
import { Badge } from '../components/Badge';
import { LedgerBlockBadge } from '../components/BlockType';
import { AiVerdictChips } from '../components/AiReview';
import { Hash } from '../components/Hash';
import { Uuid } from '../components/Uuid';
import { AsyncBoundary, EmptyState } from '../components/states';
import { formatAmount, formatDate, statusVariant } from '../utils/format';
import type { CrashProof, BlockTransaction } from '../types';

export function BlockDetail() {
  const { blockHash = '' } = useParams();
  const block = useBlock(blockHash);

  return (
    <div className="page stack gap-lg">
      <div className="stack-sm">
        <Link to="/explorer" className="row gap-sm muted text-sm"><ArrowLeft style={{ width: 16, height: 16 }} /> Back to Ledger</Link>
        <h1 className="row gap-sm"><Boxes style={{ width: 28, height: 28, color: 'var(--cyan-400)' }} /> Block Detail</h1>
      </div>

      <AsyncBoundary loading={block.loading} error={block.error} data={block.data} onRetry={block.reload}>
        {(b) => {
          const isGenesis = Number(b.block_number) === 0;
          return (
            <>
              <div className="row wrap"><LedgerBlockBadge block={b} /></div>

              <Card title="Block Header">
                <dl className="dl">
                  <dt>Block number</dt><dd>#{String(b.block_number)}</dd>
                  <dt>Block hash</dt><dd><Hash value={b.block_hash} full /></dd>
                  <dt>Previous hash</dt><dd>{b.previous_hash ? <Hash value={b.previous_hash} full /> : <span className="muted">— none (chain origin)</span>}</dd>
                  <dt>Merkle root</dt><dd><Hash value={b.merkle_root} full /></dd>
                  <dt>Version</dt><dd className="mono">{b.version}</dd>
                  <dt>Timestamp</dt><dd>{formatDate(b.timestamp)}</dd>
                </dl>
              </Card>

              {/* Included submissions — the apps/proofs minted into this block. */}
              <div className="stack-sm">
                <h2 className="row gap-sm"><FileCode style={{ width: 22, height: 22, color: 'var(--cyan-400)' }} /> Included Submissions ({b.proofs?.length ?? 0})</h2>
                <p className="muted text-sm">Every proof finalized into this block, with its target application, community consensus, and validator votes.</p>
              </div>

              {b.proofs && b.proofs.length > 0 ? (
                b.proofs.map((p) => <SubmissionInBlock key={p.proof_id} proof={p} />)
              ) : (
                <Card>
                  <EmptyState>
                    {isGenesis
                      ? 'The genesis block anchors the chain and contains no submissions.'
                      : 'No crash proofs are linked to this block.'}
                  </EmptyState>
                </Card>
              )}

              {b.transactions && b.transactions.length > 0 && (
                <Card title={`Transactions & Reward Distribution (${b.transactions.length})`}>
                  <div className="stack">
                    {b.transactions.map((t) => <TransactionView key={t.tx_id} tx={t} />)}
                  </div>
                </Card>
              )}
            </>
          );
        }}
      </AsyncBoundary>
    </div>
  );
}

// One finalized proof, fully expanded: target app + UUID, consensus, validator
// votes, and a collapsible source view. Loads the app source and the vote set
// on demand so the block list stays light.
function SubmissionInBlock({ proof }: { proof: CrashProof }) {
  const source = useAppSource(proof.app_id);
  const votes = useVerifications(proof.proof_id);
  const ai = useAiVerifications(proof.proof_id);

  return (
    <Card>
      <div className="row-between wrap" style={{ marginBottom: 16, gap: 12 }}>
        <div className="stack-sm">
          <h3 className="row gap-sm"><FileCode style={{ width: 18, height: 18, color: 'var(--cyan-400)' }} /> {source.data?.name ?? 'Application'}</h3>
          <Uuid value={proof.app_id} label="App UUID" />
        </div>
        <div className="stack-sm" style={{ alignItems: 'flex-end' }}>
          <Badge variant={statusVariant(proof.status) as never} dot>{proof.status}</Badge>
          <Link to={`/apps/${proof.app_id}`} className="text-sm mono cyan">Open application →</Link>
        </div>
      </div>

      <div className="grid grid-3" style={{ gap: 12, marginBottom: 16 }}>
        <Field label="Proof ID" value={<Link to={`/proofs/${proof.proof_id}`}><Hash value={proof.proof_id} copyable={false} /></Link>} />
        <Field label="Tester" value={<Hash value={proof.tester_address} copyable={false} />} />
        <Field label="Reward score" value={<span className="cyan mono">{proof.reward_score != null ? formatAmount(proof.reward_score) : '—'}</span>} />
      </div>

      {/* Consensus information + validator votes */}
      <AsyncBoundary loading={votes.loading} error={votes.error} data={votes.data} onRetry={votes.reload}>
        {(v) => (
          <div className="stack-sm" style={{ marginBottom: 16 }}>
            <div className="row-between text-sm">
              <span className="row gap-sm"><Shield style={{ width: 16, height: 16, color: 'var(--cyan-400)' }} /> <span className="muted">Community consensus</span></span>
              {v.consensus_reached
                ? <Badge variant="green" dot icon={<CheckCircle style={{ width: 13, height: 13 }} />}>Reached · median {v.current_median != null ? formatAmount(v.current_median) : '—'}</Badge>
                : <Badge variant="warn" dot>{v.agreeing_count}/{v.vote_count} agree</Badge>}
            </div>
            <div className="row-between text-xs faint mono">
              <span><Users style={{ width: 12, height: 12, display: 'inline', verticalAlign: '-2px' }} /> {v.vote_count} validator vote{v.vote_count === 1 ? '' : 's'}</span>
              <span>{v.agreeing_count} agree · {v.dissenting_count} dissent · quorum {v.min_verifications}</span>
            </div>
            {v.data.length > 0 && (
              <div className="table-wrap" style={{ marginTop: 4 }}>
                <table className="table">
                  <thead><tr><th>Validator</th><th>Score</th><th>Crashed</th><th>Signed</th></tr></thead>
                  <tbody>
                    {v.data.map((row) => (
                      <tr key={row.verification_id}>
                        <td><Hash value={row.verifier_address} copyable={false} /></td>
                        <td className="mono cyan">{formatAmount(row.score)}</td>
                        <td>
                          {row.crashed == null ? '—' : row.crashed
                            ? <Badge variant="green" icon={<CheckCircle />}>Yes</Badge>
                            : <Badge variant="danger" icon={<XCircle />}>No</Badge>}
                        </td>
                        <td className="muted text-sm nowrap">{formatDate(row.signed_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </AsyncBoundary>

      {/* Advisory AI model review — ChatGPT / Gemini / DeepSeek verdicts. */}
      {ai.data && ai.data.data.length > 0 && (
        <div className="row-between wrap gap-sm" style={{ marginBottom: 16 }}>
          <span className="row gap-sm text-sm">
            <Sparkles style={{ width: 16, height: 16, color: 'var(--cyan-400)' }} />
            <span className="muted">AI model review</span>
            {ai.data.ai_verified && <Badge variant="accent">AI Verified · {ai.data.approved_count}/{ai.data.required}</Badge>}
          </span>
          <AiVerdictChips data={ai.data.data} />
        </div>
      )}

      {/* Application source code (collapsed by default) */}
      <details className="disclosure">
        <summary><Code style={{ width: 14, height: 14 }} /> View application source code</summary>
        <AsyncBoundary loading={source.loading} error={source.error} data={source.data} onRetry={source.reload}>
          {(s) => (
            <div className="stack-sm">
              <p className="faint text-xs mono">{s.size_bytes.toLocaleString()} bytes · {s.language} · content hash <Hash value={s.content_hash} copyable={false} /></p>
              <pre className="source-view">{s.source_code}</pre>
            </div>
          )}
        </AsyncBoundary>
      </details>
    </Card>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="faint text-xs" style={{ marginBottom: 4 }}>{label}</p>
      <div className="mono text-sm">{value}</div>
    </div>
  );
}

// One transaction, fully itemised. For a coinbase the reward split is shown
// explicitly: the bug finder's fixed 70% and every validator's share of the
// 30% pool (weighted by closeness to the median).
function TransactionView({ tx }: { tx: BlockTransaction }) {
  const total = tx.outputs.reduce((s, o) => s + o.amount, 0);
  const share = (a: number) => (total > 0 ? `${((a / total) * 100).toFixed(1)}%` : '—');

  if (tx.tx_type === 'coinbase') {
    const finder = tx.outputs.filter((o) => o.reason === 'bug_bounty');
    const voters = tx.outputs.filter((o) => o.reason === 'verification_reward');
    const others = tx.outputs.filter((o) => o.reason !== 'bug_bounty' && o.reason !== 'verification_reward');
    return (
      <div className="tx-block">
        <div className="row-between wrap" style={{ marginBottom: 12 }}>
          <span className="row gap-sm"><Coins style={{ width: 16, height: 16, color: 'var(--purple, #c084fc)' }} /><Badge variant="purple">coinbase</Badge><span className="muted text-sm">reward distribution</span></span>
          <span className="mono cyan" style={{ fontWeight: 700 }}>{formatAmount(total)} POC minted</span>
        </div>
        <div className="faint text-xs mono" style={{ marginBottom: 12 }}>tx <Hash value={tx.tx_id} copyable={false} /></div>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Recipient</th><th>Role</th><th className="right">Reward</th><th className="right">Share</th></tr></thead>
            <tbody>
              {finder.map((o, i) => (
                <tr key={`f${i}`}>
                  <td><Hash value={o.address} copyable={false} /></td>
                  <td><Badge variant="green" icon={<Bug style={{ width: 12, height: 12 }} />}>Bug finder</Badge></td>
                  <td className="right emerald mono">{formatAmount(o.amount)}</td>
                  <td className="right mono cyan">{share(o.amount)}</td>
                </tr>
              ))}
              {voters.map((o, i) => (
                <tr key={`v${i}`}>
                  <td><Hash value={o.address} copyable={false} /></td>
                  <td><Badge variant="info" icon={<Users style={{ width: 12, height: 12 }} />}>Verifier</Badge></td>
                  <td className="right emerald mono">{formatAmount(o.amount)}</td>
                  <td className="right mono cyan">{share(o.amount)}</td>
                </tr>
              ))}
              {others.map((o, i) => (
                <tr key={`o${i}`}>
                  <td><Hash value={o.address} copyable={false} /></td>
                  <td><Badge variant="neutral">{o.reason ?? 'reward'}</Badge></td>
                  <td className="right emerald mono">{formatAmount(o.amount)}</td>
                  <td className="right mono cyan">{share(o.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="faint text-xs" style={{ marginTop: 10 }}>
          Each finalized proof mints a fixed 1000 POC. The finder always earns 70% (700 POC); the validator
          pool (30%, 300 POC) is split among validators by how close each vote was to the median — closer
          votes earn more. The split always sums to the full block reward, so “Share” is each recipient's
          portion of this block's minted total.
        </p>
      </div>
    );
  }

  // Transfer
  return (
    <div className="tx-block">
      <div className="row-between wrap" style={{ marginBottom: 12 }}>
        <span className="row gap-sm"><ArrowRightLeft style={{ width: 16, height: 16, color: 'var(--cyan-400)' }} /><Badge variant="neutral">transfer</Badge></span>
        <span className="mono cyan" style={{ fontWeight: 700 }}>{formatAmount(total)} POC</span>
      </div>
      <div className="faint text-xs mono" style={{ marginBottom: 12 }}>tx <Hash value={tx.tx_id} copyable={false} /> · {tx.inputs?.length ?? 0} input{(tx.inputs?.length ?? 0) === 1 ? '' : 's'}</div>
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>Recipient</th><th className="right">Amount</th></tr></thead>
          <tbody>
            {tx.outputs.map((o, i) => (
              <tr key={i}>
                <td><Hash value={o.address} copyable={false} /></td>
                <td className="right emerald mono">{formatAmount(o.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
