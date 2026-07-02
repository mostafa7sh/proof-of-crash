import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Blocks, Shield, Coins, Layers, ExternalLink, Clock } from 'lucide-react';
import { useBlocks, useSupply } from '../hooks/useData';
import { ledgerApi } from '../api';
import { useAsync } from '../hooks/useAsync';
import { StatCard } from '../components/Card';
import { Badge } from '../components/Badge';
import { LedgerBlockBadge } from '../components/BlockType';
import { Hash } from '../components/Hash';
import { Pagination } from '../components/Pagination';
import { AsyncBoundary, EmptyState } from '../components/states';
import { formatAmount, formatDate } from '../utils/format';
import type { Block } from '../types';

const PAGE_SIZE = 15;

export function Explorer() {
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const blocks = useBlocks(page, PAGE_SIZE);
  const supply = useSupply();
  const validation = useAsync(() => ledgerApi.validate(), []);

  return (
    <div className="page stack gap-lg">
      <div className="page-header">
        <h1>Blockchain Ledger</h1>
        <p className="muted">Immutable record of all finalized crash proofs and token transfers.</p>
      </div>

      <div className="grid grid-3">
        <StatCard icon={<Blocks />} accent="cyan" label="Chain Height" value={supply.data?.tip.height ?? '…'} sub="blocks" />
        <StatCard icon={<Coins />} accent="emerald" label="Total Supply" value={formatAmount(supply.data?.total_supply ?? 0)} sub="POC minted" />
        <StatCard
          icon={<Shield />}
          accent={validation.data?.valid === false ? 'red' : 'purple'}
          label="Chain Integrity"
          value={validation.loading ? '…' : validation.data?.valid
            ? <Badge variant="green" dot>Valid</Badge>
            : <Badge variant="danger" dot>Invalid</Badge>}
          sub={validation.data && !validation.data.valid ? validation.data.error : undefined}
        />
      </div>

      <div className="card">
        <div className="row-between wrap" style={{ marginBottom: 24 }}>
          <h2 className="row gap-sm"><Blocks style={{ width: 24, height: 24, color: 'var(--cyan-400)' }} /> Recent Blocks</h2>
          <span className="muted mono text-sm">Live Chain • Height {supply.data?.tip.height ?? 0}</span>
        </div>

        <AsyncBoundary
          loading={blocks.loading}
          error={blocks.error}
          data={blocks.data}
          onRetry={blocks.reload}
          isEmpty={(d) => d.data.length === 0}
          empty={<EmptyState>No blocks yet.</EmptyState>}
        >
          {(d) => (
            <>
              <div className="timeline">
                <div className="timeline-line" />
                {d.data.map((b, i) => <BlockRow key={b.block_hash} block={b} index={i} onOpen={() => navigate(`/explorer/${b.block_hash}`)} />)}
              </div>
              <Pagination page={page} pageSize={PAGE_SIZE} total={d.total} onPage={setPage} />
            </>
          )}
        </AsyncBoundary>
      </div>
    </div>
  );
}

function BlockRow({ block, index, onOpen }: { block: Block; index: number; onOpen: () => void }) {
  const proofCount = block.proof_count ?? block.proofs?.length ?? 0;
  const txCount = block.tx_count ?? block.transactions?.length ?? 0;
  const isGenesis = Number(block.block_number) === 0;

  return (
    <div className="timeline-item rise" style={{ animationDelay: `${index * 0.05}s` }}>
      <div className="timeline-badge">
        <span className="tl-label">Block</span>
        <span className="tl-num">{String(block.block_number)}</span>
      </div>
      <div className="timeline-body" role="button" onClick={onOpen} style={{ cursor: 'pointer' }}>
        <div className="row-between wrap" style={{ marginBottom: 16 }}>
          <div className="row gap-sm">
            <h3 className="row gap-sm">
              {isGenesis ? 'Genesis Block' : `Block #${String(block.block_number)}`}
              <ExternalLink style={{ width: 16, height: 16, color: 'var(--text-faint)' }} />
            </h3>
          </div>
          <div className="right">
            <div className="cyan mono" style={{ fontWeight: 700 }}>{proofCount} proof{proofCount === 1 ? '' : 's'}</div>
            <div className="faint text-xs">{txCount} tx</div>
          </div>
        </div>

        <div style={{ marginBottom: 16 }}>
          <div className="row gap-sm" style={{ marginBottom: 8 }}>
            <Shield style={{ width: 16, height: 16, color: 'var(--cyan-400)' }} />
            <span className="mono text-xs muted">Block Hash</span>
          </div>
          <div className="code-block">{block.block_hash}</div>
        </div>

        <div className="grid grid-3" style={{ gap: 12 }}>
          <Meta icon={<Layers size={16} />} label="Merkle Root" value={<Hash value={block.merkle_root} copyable={false} head={8} tail={6} />} />
          <Meta icon={<Clock size={16} />} label="Timestamp" value={<span className="mono text-xs">{formatDate(block.timestamp)}</span>} />
          <Meta icon={<Shield size={16} />} label="Version" value={<span className="mono cyan">{block.version}</span>} />
        </div>

        <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--border-soft)' }}>
          <LedgerBlockBadge block={block} />
        </div>
      </div>
    </div>
  );
}

function Meta({ icon, label, value }: { icon: React.ReactNode; label: string; value: React.ReactNode }) {
  return (
    <div className="row gap-sm" style={{ alignItems: 'flex-start' }}>
      <span style={{ color: 'var(--text-faint)', display: 'inline-flex' }}>{icon}</span>
      <div>
        <p className="faint text-xs" style={{ marginBottom: 2 }}>{label}</p>
        <div>{value}</div>
      </div>
    </div>
  );
}
