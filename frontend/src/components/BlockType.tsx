import { Bug, ShieldCheck, Coins, FileCode, Sparkles } from 'lucide-react';
import { Badge } from './Badge';
import type { Block } from '../types';

// Ledger block taxonomy:
//   • genesis        — block #0, the chain anchor
//   • bug-discovery  — Type B: contains the original code + a finalized proof
//   • transfer       — a token-settlement block (no proof)
export type LedgerBlockKind = 'genesis' | 'bug-discovery' | 'transfer';

export function ledgerBlockKind(block: Pick<Block, 'block_number' | 'proof_count' | 'proofs'>): LedgerBlockKind {
  if (Number(block.block_number) === 0) return 'genesis';
  const proofs = block.proof_count ?? block.proofs?.length ?? 0;
  return proofs > 0 ? 'bug-discovery' : 'transfer';
}

/** Badge that labels a ledger block as Genesis / Bug Discovery / Transfer. */
export function LedgerBlockBadge({ block }: { block: Pick<Block, 'block_number' | 'proof_count' | 'proofs' | 'ai_verified'> }) {
  const kind = ledgerBlockKind(block);
  if (kind === 'genesis') {
    return <Badge variant="purple" dot icon={<ShieldCheck style={{ width: 13, height: 13 }} />}>Genesis Block</Badge>;
  }
  if (kind === 'bug-discovery') {
    return (
      <span style={{ display: 'inline-flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <Badge variant="green" dot icon={<Bug style={{ width: 13, height: 13 }} />}>Bug Discovery Block</Badge>
        {block.ai_verified && <AiVerifiedBadge />}
      </span>
    );
  }
  return <Badge variant="neutral" icon={<Coins style={{ width: 13, height: 13 }} />}>Transfer Block</Badge>;
}

/**
 * Advisory "AI Verified" badge: shown when all three AI models (ChatGPT,
 * Gemini, DeepSeek) agreed the code was buggy and the proof valid. It never
 * gates the ledger — human consensus does — so it only decorates a block.
 */
export function AiVerifiedBadge() {
  return <Badge variant="accent" dot icon={<Sparkles style={{ width: 13, height: 13 }} />}>AI Verified</Badge>;
}

/**
 * Type A label for a code submission that has no accepted bug yet (lives in the
 * mempool / on its application page, not on the ledger). When a bug has been
 * confirmed, it reads as a resolved Bug Discovery instead.
 */
export function CodeBlockBadge({ hasConfirmedBug = false }: { hasConfirmedBug?: boolean }) {
  return hasConfirmedBug
    ? <Badge variant="green" dot icon={<Bug style={{ width: 13, height: 13 }} />}>Bug Discovery Block</Badge>
    : <Badge variant="info" icon={<FileCode style={{ width: 13, height: 13 }} />}>Code Block · no bug yet</Badge>;
}
