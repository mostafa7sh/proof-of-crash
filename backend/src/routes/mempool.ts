import { Router, Request, Response } from 'express';
import { pool } from '../config/database';
import { getEngine } from '../blockchain/instance';
import { computeQuorum } from '../blockchain/quorum';
import type { ApiError } from '../types';

// ─── Submission pipeline ("mempool") ────────────────────────────────────────
//
// This is the *submission* mempool — the staging area every crash proof passes
// through BEFORE it can be written to the blockchain. It is distinct from the
// C++ engine's transfer mempool (GET /api/ledger/mempool), which holds pending
// token-transfer transactions.
//
// The pipeline mirrors the platform flow:
//   Upload Code → [Pending] → Bug Reports/Validation → [Under Review]
//                → Consensus → [Ready] → Block Creation → Ledger
//
// Nothing here is ever on-chain. Only proofs that reach consensus are minted
// into a block by the miner (see blockchain/mining.ts:finalizeProofs).

export const mempoolRouter = Router();

interface PendingApp {
  app_id: string;
  name: string;
  developer_address: string;
  language: string;
  uploaded_at: number;
}

interface VotingProofRow {
  proof_id: string;
  app_id: string;
  app_name: string;
  tester_address: string;
  content_hash: string;
  submitted_at: string;
  voting_deadline: string;
  vote_count: string;
}

// GET /api/mempool — the full submission pipeline, bucketed into the three
// stages. Public, so the validation pipeline is transparent to everyone.
mempoolRouter.get('/', async (_req: Request, res: Response) => {
  try {
    // The mempool only shows ACTIVE, relevant items. Things leave it once a
    // proof is finalized/archived/rejected (no longer 'voting'), and also when
    // their submission window expires:
    //   • a voting proof past its voting_deadline is expired (pending rejection)
    //   • a code block with no proof older than the submission TTL is stale
    const now = Math.floor(Date.now() / 1000);
    const pendingTtl = parseInt(process.env['PENDING_SUBMISSION_TTL_SECONDS'] ?? String(30 * 24 * 60 * 60));
    const pendingCutoff = now - pendingTtl;

    // ── A. Pending Submissions: uploaded apps with no crash proof yet ───────
    const pendingResult = await pool.query<PendingApp>(
      `SELECT a.app_id, a.name, a.developer_address, a.language, a.uploaded_at
         FROM apps a
        WHERE NOT EXISTS (SELECT 1 FROM crash_proofs cp WHERE cp.app_id = a.app_id)
          AND a.uploaded_at > $1
        ORDER BY a.uploaded_at DESC`,
      [pendingCutoff],
    );

    // ── B/C. Every proof currently in the voting stage (window still open) ──
    const votingResult = await pool.query<VotingProofRow>(
      `SELECT cp.proof_id, cp.app_id, a.name AS app_name, cp.tester_address,
              cp.content_hash, cp.submitted_at, cp.voting_deadline,
              COUNT(v.verification_id)::text AS vote_count
         FROM crash_proofs cp
         JOIN apps a ON a.app_id = cp.app_id
         LEFT JOIN verifications v ON v.proof_id = cp.proof_id
        WHERE cp.status = 'voting' AND cp.voting_deadline > $1
        GROUP BY cp.proof_id, a.name
        ORDER BY cp.submitted_at DESC`,
      [now],
    );

    // Pull every vote for the voting proofs in one query, then group in memory
    // so consensus is evaluated by the engine per proof (the single authority).
    const proofIds = votingResult.rows.map(r => r.proof_id);
    const votesByProof = new Map<string, Array<{ address: string; score: number }>>();
    if (proofIds.length > 0) {
      const votesResult = await pool.query<{ proof_id: string; verifier_address: string; score: string }>(
        `SELECT proof_id, verifier_address, score::text AS score
           FROM verifications WHERE proof_id = ANY($1)`,
        [proofIds],
      );
      for (const v of votesResult.rows) {
        const list = votesByProof.get(v.proof_id) ?? [];
        list.push({ address: v.verifier_address, score: parseFloat(v.score) });
        votesByProof.set(v.proof_id, list);
      }
    }

    const engine = getEngine();
    const quorum = await computeQuorum(pool, now);  // same threshold the miner enforces
    const underReview = [];
    const readyForBlock = [];

    for (const row of votingResult.rows) {
      const votes = votesByProof.get(row.proof_id) ?? [];
      const status = await engine.consensusStatus(votes, quorum);

      const entry = {
        proof_id: row.proof_id,
        app_id: row.app_id,
        app_name: row.app_name,
        tester_address: row.tester_address,
        content_hash: row.content_hash,
        submitted_at: parseInt(row.submitted_at),
        voting_deadline: parseInt(row.voting_deadline),
        vote_count: status.vote_count,
        // Median stays sealed until finalization (blind review); everything in
        // the mempool is by definition pre-ledger, so it is never exposed here.
        current_median: null,
        agreeing_count: status.agreeing_count,
        dissenting_count: status.dissenting_count,
        min_verifications: status.min_verifications,
        consensus_reached: status.consensus_reached,
      };

      // Reaching consensus is the gate for block inclusion (mining.ts).
      if (status.consensus_reached) readyForBlock.push(entry);
      else underReview.push(entry);
    }

    res.json({
      pending_submissions: pendingResult.rows,
      under_review: underReview,
      ready_for_block: readyForBlock,
      counts: {
        pending: pendingResult.rows.length,
        under_review: underReview.length,
        ready: readyForBlock.length,
      },
    });
  } catch (err) {
    console.error('GET /api/mempool error:', err);
    res.status(500).json({ error: 'Internal server error', code: 'DB_ERROR' } satisfies ApiError);
  }
});
