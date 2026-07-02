import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  ArrowLeft, AlertTriangle, Shield, Users, CheckCircle, XCircle, Clock, Lock, FileCode, Bug, Archive, Sparkles,
} from 'lucide-react';
import { useProof, useVerifications, useAppSource, useProofContent, useAiVerifications } from '../hooks/useData';
import { useAuth, errorMessage } from '../context/AuthContext';
import { verificationsApi } from '../api';
import { Card } from '../components/Card';
import { Badge } from '../components/Badge';
import { AiReviewSummary, AiReviewList } from '../components/AiReview';
import { Hash } from '../components/Hash';
import { Button } from '../components/Button';
import { Modal } from '../components/Modal';
import { Input } from '../components/Input';
import { Loading, ErrorState, AsyncBoundary } from '../components/states';
import { signBytes } from '../utils/wallet';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils';
import { formatAmount, formatDate, relativeTime, statusVariant } from '../utils/format';
import { inRange, isHex, validate } from '../utils/validation';

// Render crash-input hex as a printable ASCII preview (non-printables as '.').
function hexToAsciiPreview(hex: string): string {
  let out = '';
  for (let i = 0; i + 1 < hex.length; i += 2) {
    const code = parseInt(hex.slice(i, i + 2), 16);
    out += code >= 32 && code < 127 ? String.fromCharCode(code) : '.';
  }
  return out || '—';
}

export function ProofDetail() {
  const { proofId = '' } = useParams();
  const { user, wallet, importWallet } = useAuth();
  const proof = useProof(proofId);
  const verifications = useVerifications(proofId);
  const appId = proof.data?.app_id ?? '';
  const source = useAppSource(appId);
  const content = useProofContent(proofId);
  const ai = useAiVerifications(proofId);

  const [voteOpen, setVoteOpen] = useState(false);
  const [score, setScore] = useState('5.0');
  const [scoreErr, setScoreErr] = useState<string | null>(null);
  const [crashed, setCrashed] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [voteError, setVoteError] = useState<string | null>(null);
  // The signing key is memory-only (never saved). If it isn't loaded this
  // session, the voter can paste it here to sign — it stays in memory only.
  const [voteKey, setVoteKey] = useState('');

  const isOwnProof = proof.data?.tester_address === user?.address;
  const canVote = proof.data?.status === 'voting' && !isOwnProof;

  const submitVote = async () => {
    const err = validate(score, [inRange(0.1, 10, 'Score')]);
    setScoreErr(err);
    if (err) return;

    // Sign with the in-memory key. It's never persisted, so if it isn't loaded
    // this session, accept a pasted key here (kept in memory only) to sign.
    let signingKey = wallet?.privateKey;
    if (!signingKey) {
      const keyErr = validate(voteKey, [isHex('Private key', 64)]);
      if (keyErr) { setVoteError(keyErr); return; }
      try {
        signingKey = importWallet(voteKey.trim().toLowerCase()).privateKey;
        setVoteKey('');
      } catch (e) {
        setVoteError(errorMessage(e));
        return;
      }
    }

    setSubmitting(true);
    setVoteError(null);
    try {
      const signedAt = Math.floor(Date.now() / 1000);
      const msg = `poc-vote-v1:${proofId}:${score}:${signedAt}`;
      const digest = bytesToHex(sha256(utf8ToBytes(msg)));
      const signature = signBytes(digest, signingKey);

      await verificationsApi.submit({
        proof_id: proofId,
        score: Number(score),
        signature,
        signed_at: signedAt,
        crashed,
      });
      setVoteOpen(false);
      verifications.reload();
      proof.reload();
    } catch (e) {
      setVoteError(errorMessage(e));
    } finally {
      setSubmitting(false);
    }
  };

  if (proof.loading) return <div className="page"><Loading /></div>;
  if (proof.error) return <div className="page"><ErrorState message={proof.error} onRetry={proof.reload} /></div>;
  if (!proof.data) return null;

  const p = proof.data;
  const v = verifications.data;
  const progress = v ? Math.min(100, (v.vote_count / v.min_verifications) * 100) : 0;

  return (
    <div className="page stack gap-lg">
      <div className="stack-sm">
        <Link to="/proofs" className="row gap-sm muted text-sm"><ArrowLeft style={{ width: 16, height: 16 }} /> Back to Bug Proofs</Link>
        <div className="row-between wrap">
          <div>
            <h1>Crash Validation</h1>
            <p className="muted mono text-sm">Proof ID: {p.proof_id.slice(0, 24)}…</p>
          </div>
          <Badge variant={statusVariant(p.status) as never} dot pulse={p.status === 'voting'}>{p.status}</Badge>
        </div>
      </div>

      <div className="split">
        {/* Main column */}
        <div className="stack gap-lg">
          <Card>
            <h3 className="row gap-sm" style={{ marginBottom: 20 }}>
              <AlertTriangle style={{ width: 22, height: 22, color: 'var(--yellow)' }} />
              Crash Proof Details
            </h3>
            <div className="grid grid-2" style={{ gap: 16, marginBottom: 20 }}>
              <div className="info-tile"><Users /><div><div className="lbl">Tester</div><div className="val"><Hash value={p.tester_address} /></div></div></div>
              <div className="info-tile"><Clock /><div><div className="lbl">Submitted</div><div className="val">{formatDate(p.submitted_at)}</div></div></div>
              <div className="info-tile"><Shield /><div><div className="lbl">Target App</div><div className="val row gap-sm wrap"><Hash value={p.app_id} head={8} tail={6} /><Link to={`/apps/${p.app_id}`} className="text-xs mono cyan">view →</Link></div></div></div>
              <div className="info-tile"><CheckCircle /><div><div className="lbl">Reward Score</div><div className="val cyan">{p.reward_score != null ? formatAmount(p.reward_score) : '—'}</div></div></div>
            </div>
            <div>
              <p className="mono text-xs muted" style={{ marginBottom: 8 }}>Crash Input Content Hash</p>
              <div className="code-block">{p.content_hash}</div>
            </div>
            <div className="dl" style={{ marginTop: 20 }}>
              <dt>Voting deadline</dt>
              <dd>{p.voting_deadline ? `${formatDate(p.voting_deadline)} (${relativeTime(p.voting_deadline)})` : '—'}</dd>
              <dt>Finalized</dt>
              <dd>{p.finalized_at ? formatDate(p.finalized_at) : '—'}</dd>
            </div>
          </Card>

          {/* Target source — validators must see the code to find the bug. */}
          <Card title={<span className="row gap-sm"><FileCode style={{ width: 18, height: 18, color: 'var(--cyan-400)' }} /> Target Application Source</span>}>
            <AsyncBoundary loading={source.loading} error={source.error} data={source.data} onRetry={source.reload}>
              {(s) => (
                <div className="stack-sm">
                  <div className="row-between wrap">
                    <span className="muted text-sm mono">{s.name} · {s.language} · {s.size_bytes.toLocaleString()} bytes</span>
                    <Link to={`/apps/${p.app_id}`} className="text-sm mono cyan">Open application →</Link>
                  </div>
                  <pre className="source-view">{s.source_code}</pre>
                </div>
              )}
            </AsyncBoundary>
          </Card>

          {/* The proof itself — the actual crash input under review. */}
          <Card title={<span className="row gap-sm"><Bug style={{ width: 18, height: 18, color: 'var(--yellow)' }} /> Crash Proof Contents</span>}>
            <AsyncBoundary loading={content.loading} error={content.error} data={content.data} onRetry={content.reload}>
              {(c) => (
                <div className="stack-sm">
                  <div className="dl" style={{ gridTemplateColumns: '120px 1fr', gap: '6px 12px' }}>
                    <dt>Input format</dt><dd><Badge variant="neutral">{c.input_format}</Badge></dd>
                    <dt>Input size</dt><dd className="mono">{c.input_size.toLocaleString()} bytes</dd>
                  </div>
                  <p className="muted text-xs mono" style={{ marginTop: 4 }}>Raw crash input (hex)</p>
                  <pre className="source-view">{c.crash_input_hex || '—'}</pre>
                  <p className="muted text-xs mono">ASCII preview</p>
                  <pre className="source-view">{hexToAsciiPreview(c.crash_input_hex)}</pre>
                </div>
              )}
            </AsyncBoundary>
          </Card>

          <Card title={`Verifier Votes (${v?.data.length ?? 0})`} noPad>
            {verifications.loading ? (
              <div style={{ padding: 24 }}><Loading /></div>
            ) : v && v.data.length > 0 ? (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr><th>Verifier</th><th>Score</th><th>Crashed</th><th>Exit</th><th>Signed</th></tr>
                  </thead>
                  <tbody>
                    {v.data.map((row) => (
                      <tr key={row.verification_id}>
                        <td><Hash value={row.verifier_address} copyable={false} /></td>
                        <td>
                          {row.score == null
                            ? <span className="muted row gap-sm" title="Hidden until finalized"><Lock style={{ width: 13, height: 13 }} /> sealed</span>
                            : <span className="mono cyan">{formatAmount(row.score)}</span>}
                        </td>
                        <td>
                          {row.crashed == null ? '—' : row.crashed
                            ? <Badge variant="green" icon={<CheckCircle />}>Yes</Badge>
                            : <Badge variant="danger" icon={<XCircle />}>No</Badge>}
                        </td>
                        <td className="mono">{row.exit_code ?? '—'}</td>
                        <td className="muted text-sm nowrap">{formatDate(row.signed_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div style={{ padding: 24 }} className="muted text-sm">No verifications yet. Be the first to reproduce this crash.</div>
            )}
          </Card>
        </div>

        {/* Sidebar */}
        <div className="stack">
          <Card>
            <h3 className="row gap-sm" style={{ marginBottom: 20 }}>
              <Shield style={{ width: 20, height: 20, color: 'var(--cyan-400)' }} /> Consensus Status
            </h3>
            {verifications.loading ? (
              <Loading />
            ) : v ? (
              <div className="stack">
                <div>
                  <div className="row-between text-sm" style={{ marginBottom: 8 }}>
                    <span className="muted">Quorum progress</span>
                    <span className="cyan mono">{v.vote_count}/{v.min_verifications}</span>
                  </div>
                  <div className={`progress ${v.consensus_reached ? '' : 'warn'}`}><span style={{ width: `${progress}%` }} /></div>
                  <div className="row-between text-xs faint mono" style={{ marginTop: 8 }}>
                    <span>{v.scores_sealed
                      ? <span className="row gap-sm"><Lock style={{ width: 12, height: 12 }} /> median sealed</span>
                      : `median ${v.current_median != null ? formatAmount(v.current_median) : '—'}`}</span>
                    <span>{v.agreeing_count} agree · {v.dissenting_count} dissent</span>
                  </div>
                </div>

                {v.scores_sealed && (
                  <div className="alert alert-info">
                    <div className="row gap-sm" style={{ marginBottom: 4 }}><Lock style={{ width: 16, height: 16 }} /><strong>Scores sealed</strong></div>
                    Severity scores and the median reward stay hidden until this proof is finalized, so each validator scores independently.
                  </div>
                )}

                {p.status === 'archived' && (
                  <div className="alert alert-warn">
                    <div className="row gap-sm" style={{ marginBottom: 4 }}><Archive style={{ width: 16, height: 16 }} /><strong>Archived</strong></div>
                    Another proof for this application was accepted into the ledger, so this one was archived.
                  </div>
                )}

                {v.consensus_reached ? (
                  <div className="alert alert-success">
                    <div className="row gap-sm" style={{ marginBottom: 4 }}><CheckCircle style={{ width: 18, height: 18 }} /><strong>Consensus Reached</strong></div>
                    A majority agree within the outlier threshold — this proof can be finalized on-chain.
                  </div>
                ) : (
                  <div className="alert alert-warn">
                    <div className="row gap-sm" style={{ marginBottom: 4 }}><AlertTriangle style={{ width: 18, height: 18 }} /><strong>Awaiting Consensus</strong></div>
                    Needs {Math.max(0, v.min_verifications - v.vote_count)} more verification(s) to reach the required quorum of {v.min_verifications} validators.
                  </div>
                )}

                {isOwnProof && <div className="alert alert-info">You submitted this proof; you can't vote on it.</div>}
                {canVote && <Button block onClick={() => setVoteOpen(true)}><Shield /> Verify &amp; Vote</Button>}
              </div>
            ) : (
              <ErrorState message={verifications.error ?? 'Failed to load'} onRetry={verifications.reload} />
            )}
          </Card>

          <Card>
            <h3 className="row gap-sm" style={{ marginBottom: 16 }}>
              <Sparkles style={{ width: 20, height: 20, color: 'var(--cyan-400)' }} /> AI Model Review
            </h3>
            {ai.loading ? (
              <Loading />
            ) : ai.data && ai.data.data.length > 0 ? (
              <div className="stack">
                <AiReviewSummary summary={ai.data} />
                <AiReviewList data={ai.data.data} />
                <p className="faint text-xs" style={{ marginTop: 4 }}>
                  Advisory only — three models (ChatGPT, Gemini, DeepSeek) review the code and the crash proof.
                  Human consensus, not the AI, decides what enters the ledger.
                </p>
              </div>
            ) : (
              <p className="muted text-sm">
                Not yet reviewed. The three models (ChatGPT, Gemini, DeepSeek) review each proof when it is
                finalized into a block.
              </p>
            )}
          </Card>

          <Card className="card-emerald">
            <h3 style={{ marginBottom: 16 }}>How Rewards Work</h3>
            <div className="stack-sm text-sm">
              <div className="row-between"><span className="muted">Block reward</span><span className="emerald mono">1000 POC</span></div>
              <div className="row-between"><span className="muted">Finder share</span><span className="emerald mono">70% · 700 POC</span></div>
              <div className="row-between"><span className="muted">Validator pool</span><span className="emerald mono">30% · 300 POC</span></div>
              <div className="row-between"><span className="muted">Required validators</span><span className="emerald mono">{v?.min_verifications ?? '—'}</span></div>
              <p className="faint text-xs" style={{ marginTop: 8 }}>
                Each finalized proof mints a fixed 1000 POC. The finder always earns 70%; the validator pool (30%) is split
                among validators by how close each vote was to the median. The required number of validators scales with the active community.
              </p>
            </div>
          </Card>
        </div>
      </div>

      <Modal
        open={voteOpen}
        title="Verify & Vote"
        onClose={() => setVoteOpen(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setVoteOpen(false)}>Cancel</Button>
            <Button loading={submitting} onClick={submitVote}>Submit Vote</Button>
          </>
        }
      >
        <div className="stack">
          <p className="muted text-sm">
            Reproduce the crash, then rate its severity (CVSS-like, 0.10–10.00). Your score is signed
            with your Ed25519 key and contributes to the median consensus.
          </p>
          {voteError && <div className="alert alert-danger">{voteError}</div>}
          {!wallet?.privateKey && (
            <div className="stack-sm">
              <div className="alert alert-warn text-sm">
                Your signing key isn’t loaded (we never save it). Paste your Ed25519 private key to sign this
                vote — it’s kept in memory only for this session.
              </div>
              <Input
                label="Private key (64 hex chars)"
                value={voteKey}
                onChange={(e) => setVoteKey(e.target.value)}
                placeholder="64 hex characters"
              />
            </div>
          )}
          <Input
            label="Severity score (0.10 – 10.00)"
            type="number"
            min={0.1}
            max={10}
            step={0.1}
            value={score}
            onChange={(e) => setScore(e.target.value)}
            error={scoreErr}
          />
          <label className="row gap-sm" style={{ cursor: 'pointer' }}>
            <input type="checkbox" checked={crashed} onChange={(e) => setCrashed(e.target.checked)} />
            <span>The target crashed when I reproduced the input</span>
          </label>
        </div>
      </Modal>
    </div>
  );
}
