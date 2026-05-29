import { Router, Request, Response } from 'express';
import { pool } from '../config/database';
import { getEngine } from '../blockchain/instance';
import { requireAuth } from '../auth';
import type { Verification, ApiError } from '../types';

export const verificationsRouter = Router();

// Request-validation bounds (input validation is a backend concern). The
// consensus rules themselves (median, outlier threshold, quorum) live in the
// C++ engine and are returned by consensus_status.
const MIN_SCORE = 0.10;
const MAX_SCORE = 10.00;

// POST /api/verifications — submit a verification vote with CVSS-like score.
// verifier_address comes from the authenticated session.
verificationsRouter.post('/', requireAuth, async (req: Request, res: Response) => {
  const { proof_id, score, signature, signed_at,
          exit_code, signal_number, stdout_preview, stderr_preview,
          duration_ms, crashed } = req.body as {
    proof_id?: string;
    score?: number;
    signature?: string;
    signed_at?: number;
    exit_code?: number | null;
    signal_number?: number | null;
    stdout_preview?: string | null;
    stderr_preview?: string | null;
    duration_ms?: number | null;
    crashed?: boolean | null;
  };
  const verifier_address = req.user!.address;

  if (!proof_id || score === undefined || !signature || !signed_at) {
    const err: ApiError = { error: 'Missing required fields: proof_id, score, signature, signed_at', code: 'MISSING_FIELDS' };
    res.status(400).json(err);
    return;
  }

  if (typeof score !== 'number' || score < MIN_SCORE || score > MAX_SCORE) {
    const err: ApiError = { error: `Score must be a number between ${MIN_SCORE} and ${MAX_SCORE}`, code: 'INVALID_SCORE' };
    res.status(400).json(err);
    return;
  }

  const client = await pool.connect();
  try {
    // Verify the proof exists and is in voting state
    const proofResult = await client.query<{ status: string; voting_deadline: number | null; tester_address: string }>(
      'SELECT status, voting_deadline, tester_address FROM crash_proofs WHERE proof_id = $1',
      [proof_id]
    );

    if (proofResult.rows.length === 0) {
      res.status(404).json({ error: 'Proof not found', code: 'NOT_FOUND' } satisfies ApiError);
      return;
    }

    const proof = proofResult.rows[0];

    if (!proof || proof.status !== 'voting') {
      res.status(409).json({ error: `Proof is not accepting votes (status: ${proof?.status ?? 'unknown'})`, code: 'NOT_IN_VOTING' } satisfies ApiError);
      return;
    }

    // The submitter cannot rate their own proof. Allowing self-verification
    // would let a single key trivially seed the consensus toward any score.
    if (proof.tester_address === verifier_address) {
      res.status(403).json({ error: 'Cannot verify your own proof', code: 'SELF_VERIFICATION' } satisfies ApiError);
      return;
    }

    const now = Math.floor(Date.now() / 1000);
    if (proof.voting_deadline !== null && now > proof.voting_deadline) {
      res.status(409).json({ error: 'Voting deadline has passed', code: 'DEADLINE_PASSED' } satisfies ApiError);
      return;
    }

    await client.query(
      `INSERT INTO verifications
         (proof_id, verifier_address, score, exit_code, signal_number,
          stdout_preview, stderr_preview, duration_ms, crashed, signature, signed_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        proof_id, verifier_address, score,
        exit_code ?? null, signal_number ?? null,
        stdout_preview ? stdout_preview.slice(0, 1024) : null,
        stderr_preview ? stderr_preview.slice(0, 1024) : null,
        duration_ms ?? null, crashed ?? null,
        signature, signed_at,
      ]
    );

    // Recompute consensus status over the full vote set. The C++ engine is the
    // single source of truth for median + outlier rules, so this is guaranteed
    // consistent with reward distribution and with the GET endpoint.
    const votesResult = await client.query<{ verifier_address: string; score: string }>(
      'SELECT verifier_address, score::text AS score FROM verifications WHERE proof_id = $1',
      [proof_id]
    );
    const votes = votesResult.rows.map(v => ({
      address: v.verifier_address,
      score: parseFloat(v.score),
    }));
    const status = await getEngine().consensusStatus(votes);

    res.status(201).json({
      accepted: true,
      vote_count: status.vote_count,
      current_median: status.median,
      agreeing_count: status.agreeing_count,
      dissenting_count: status.dissenting_count,
      consensus_reached: status.consensus_reached,
    });
  } catch (err: unknown) {
    if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === '23505') {
      res.status(409).json({ error: 'You have already voted on this proof', code: 'DUPLICATE_VOTE' } satisfies ApiError);
      return;
    }
    console.error('POST /api/verifications error:', err);
    res.status(500).json({ error: 'Internal server error', code: 'DB_ERROR' } satisfies ApiError);
  } finally {
    client.release();
  }
});

// GET /api/verifications/:proofId — get all votes for a proof
verificationsRouter.get('/:proofId', async (req: Request, res: Response) => {
  const { proofId } = req.params as { proofId: string };

  try {
    const rows = await pool.query<Verification>(
      `SELECT verification_id, proof_id, verifier_address, score,
              exit_code, signal_number, stdout_preview, stderr_preview,
              duration_ms, crashed, signature, signed_at
       FROM verifications
       WHERE proof_id = $1
       ORDER BY signed_at ASC`,
      [proofId]
    );

    // Consensus status (median, agreement, quorum) comes from the C++ engine,
    // the same source used at vote-submission and reward time.
    const votes = rows.rows.map((v) => ({ address: v.verifier_address, score: v.score }));
    const status = await getEngine().consensusStatus(votes);

    res.json({
      data: rows.rows,
      proof_id: proofId,
      vote_count: status.vote_count,
      current_median: status.median,
      agreeing_count: status.agreeing_count,
      dissenting_count: status.dissenting_count,
      consensus_reached: status.consensus_reached,
      outlier_threshold: status.outlier_threshold,
      min_verifications: status.min_verifications,
    });
  } catch (err) {
    console.error('GET /api/verifications/:proofId error:', err);
    res.status(500).json({ error: 'Internal server error', code: 'DB_ERROR' } satisfies ApiError);
  }
});
