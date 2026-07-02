import { Link } from 'react-router-dom';
import { FileCode, Hourglass, Users, PackageCheck, ArrowRight, Clock, Lock } from 'lucide-react';
import { useMempool } from '../hooks/useData';
import { Card, StatCard } from '../components/Card';
import { Badge } from '../components/Badge';
import { CodeBlockBadge } from '../components/BlockType';
import { Hash } from '../components/Hash';
import { Uuid } from '../components/Uuid';
import { AsyncBoundary, EmptyState } from '../components/states';
import { formatDate, relativeTime } from '../utils/format';
import type { PendingSubmission, PipelineProof } from '../types';

// The submission pipeline ("mempool") — everything staged BEFORE the blockchain.
// Mirrors the flow: Upload → Pending → Under Review → Ready → Block.
export function Mempool() {
  const pipeline = useMempool();

  return (
    <div className="page stack gap-lg">
      <div className="page-header">
        <h1>Mempool</h1>
        <p className="muted">
          The submission pipeline — pending uploads, proofs under community validation, and
          consensus-approved proofs awaiting block inclusion. Nothing here is on-chain yet.
        </p>
      </div>

      <AsyncBoundary loading={pipeline.loading} error={pipeline.error} data={pipeline.data} onRetry={pipeline.reload}>
        {(d) => (
          <>
            {/* Pipeline overview */}
            <div className="grid grid-3">
              <StatCard icon={<FileCode />} accent="cyan" label="Pending Submissions" value={d.counts.pending} sub="awaiting bug reports" />
              <StatCard icon={<Users />} accent="yellow" label="Under Review" value={d.counts.under_review} sub="being validated" />
              <StatCard icon={<PackageCheck />} accent="emerald" label="Ready for Block" value={d.counts.ready} sub="consensus reached" />
            </div>

            {/* Flow legend */}
            <div className="mempool-flow">
              <FlowTag icon={<FileCode />}>Upload</FlowTag>
              <ArrowRight className="mf-arrow" />
              <FlowTag icon={<Hourglass />}>Pending</FlowTag>
              <ArrowRight className="mf-arrow" />
              <FlowTag icon={<Users />}>Under Review</FlowTag>
              <ArrowRight className="mf-arrow" />
              <FlowTag icon={<PackageCheck />}>Ready</FlowTag>
              <ArrowRight className="mf-arrow" />
              <FlowTag icon={<Clock />} muted>Block</FlowTag>
            </div>

            {/* A. Pending Submissions */}
            <section className="stack">
              <SectionHead icon={<FileCode />} accent="accent-cyan" title="Pending Submissions" count={d.counts.pending}
                desc="Uploaded applications that have not yet received any crash proof." />
              {d.pending_submissions.length === 0 ? (
                <Card><EmptyState>No pending submissions — every uploaded app already has a proof.</EmptyState></Card>
              ) : (
                <div className="grid grid-3">
                  {d.pending_submissions.map((a) => <PendingCard key={a.app_id} app={a} />)}
                </div>
              )}
            </section>

            {/* B. Under Review */}
            <section className="stack">
              <SectionHead icon={<Users />} accent="accent-yellow" title="Under Review" count={d.counts.under_review}
                desc="Proofs with at least one bug report, being reproduced and scored by verifiers." />
              {d.under_review.length === 0 ? (
                <Card><EmptyState>Nothing under review right now.</EmptyState></Card>
              ) : (
                <div className="grid grid-2">
                  {d.under_review.map((p) => <ProofPipelineCard key={p.proof_id} proof={p} stage="review" />)}
                </div>
              )}
            </section>

            {/* C. Ready for Block Inclusion */}
            <section className="stack">
              <SectionHead icon={<PackageCheck />} accent="accent-emerald" title="Ready for Block Inclusion" count={d.counts.ready}
                desc="Consensus reached. These are minted into the next block by the validator." />
              {d.ready_for_block.length === 0 ? (
                <Card><EmptyState>No proofs awaiting block inclusion.</EmptyState></Card>
              ) : (
                <div className="grid grid-2">
                  {d.ready_for_block.map((p) => <ProofPipelineCard key={p.proof_id} proof={p} stage="ready" />)}
                </div>
              )}
            </section>
          </>
        )}
      </AsyncBoundary>
    </div>
  );
}

function SectionHead({ icon, accent, title, count, desc }: { icon: React.ReactNode; accent: string; title: string; count: number; desc: string }) {
  return (
    <div className="stack-sm">
      <div className="row gap-sm">
        <span className={accent} style={{ display: 'inline-flex' }}>{icon}</span>
        <h2>{title}</h2>
        <Badge variant="neutral">{count}</Badge>
      </div>
      <p className="muted text-sm">{desc}</p>
    </div>
  );
}

function FlowTag({ icon, children, muted }: { icon: React.ReactNode; children: React.ReactNode; muted?: boolean }) {
  return (
    <span className={`mf-tag ${muted ? 'mf-muted' : ''}`}>
      {icon}{children}
    </span>
  );
}

function PendingCard({ app }: { app: PendingSubmission }) {
  return (
    <div className="card stack-sm">
      <div className="row-between">
        <h3 className="truncate">{app.name}</h3>
        <Badge variant="warn" dot>pending</Badge>
      </div>
      <div className="row gap-sm wrap">
        <CodeBlockBadge />
        <Badge variant="neutral">{app.language}</Badge>
      </div>
      {/* The App UUID is what a tester needs to file a proof — surface it here. */}
      <Uuid value={app.app_id} label="App UUID" truncate />
      <div className="dl" style={{ gridTemplateColumns: '90px 1fr', gap: '6px 12px', marginTop: 4 }}>
        <dt>Author</dt><dd><Hash value={app.developer_address} copyable={false} /></dd>
        <dt>Uploaded</dt><dd className="text-sm">{formatDate(app.uploaded_at)}</dd>
      </div>
      <div className="row wrap" style={{ marginTop: 4, columnGap: 16 }}>
        <Link to={`/apps/${app.app_id}`} className="text-sm mono muted">View app</Link>
        <Link to={`/submit?app=${app.app_id}`} className="text-sm mono cyan row gap-sm">
          Submit a proof <ArrowRight style={{ width: 14, height: 14 }} />
        </Link>
      </div>
    </div>
  );
}

function ProofPipelineCard({ proof, stage }: { proof: PipelineProof; stage: 'review' | 'ready' }) {
  const progress = Math.min(100, (proof.vote_count / Math.max(1, proof.min_verifications)) * 100);
  return (
    <div className="card card-hover stack-sm">
      <div className="row-between">
        <h3 className="truncate">{proof.app_name}</h3>
        {stage === 'ready'
          ? <Badge variant="accent" dot pulse>consensus</Badge>
          : <Badge variant="info" dot pulse>voting</Badge>}
      </div>
      {/* App UUID stays visible even once a proof exists, so anyone can file another. */}
      <Uuid value={proof.app_id} label="App UUID" truncate />
      <div className="text-xs faint mono">proof <Hash value={proof.proof_id} copyable={false} head={10} tail={6} /></div>

      {/* Validation progress */}
      <div className="stack-sm" style={{ gap: 6, marginTop: 4 }}>
        <div className="row-between text-xs muted mono">
          <span>{stage === 'ready' ? 'Quorum met' : `Validations ${proof.vote_count}/${proof.min_verifications}`}</span>
          <span>{proof.agreeing_count} agree · {proof.dissenting_count} dissent</span>
        </div>
        <div className={`progress ${stage === 'ready' ? '' : 'warn'}`}><span style={{ width: `${progress}%` }} /></div>
      </div>

      <div className="row-between text-sm" style={{ marginTop: 4 }}>
        <span className="muted">Reward median</span>
        <span className="faint mono row gap-sm"><Lock style={{ width: 12, height: 12 }} /> sealed</span>
      </div>
      <div className="row-between text-xs faint mono">
        <span>by <Hash value={proof.tester_address} copyable={false} /></span>
        <span>{stage === 'ready' ? 'next block' : `closes ${relativeTime(proof.voting_deadline)}`}</span>
      </div>

      <div className="row wrap" style={{ marginTop: 4, columnGap: 16 }}>
        <Link to={`/proofs/${proof.proof_id}`} className="text-sm mono cyan row gap-sm">
          View validation <ArrowRight style={{ width: 14, height: 14 }} />
        </Link>
        <Link to={`/apps/${proof.app_id}`} className="text-sm mono muted">View app</Link>
      </div>
    </div>
  );
}
