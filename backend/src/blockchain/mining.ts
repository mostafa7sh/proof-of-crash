import { Pool } from 'pg';
import { CppEngine, type CoinbaseTxSpec, type EngineBlockData } from './CppEngine';
import { persistBlockFromEngine } from './persistence';
import { computeQuorum } from './quorum';
import { judgeProof, type AiVerdict } from './aiJudge';
import { AI_VERIFICATION_ENABLED } from '../config/ai';

// ─── DB Row Shapes ───────────────────────────────────────────────────────────

interface PendingProofRow {
  proof_id: string;
  app_id: string;
  tester_address: string;
  voting_deadline: string;
  vote_count: string;
}

interface VoteRow {
  verifier_address: string;
  score: string;
}

// ─── Mining ──────────────────────────────────────────────────────────────────

// Serialize mining. The background timer and the admin `/finalize` endpoint
// both call mineBlock; running them concurrently could double-finalize proofs
// or clash on block numbers/timestamps. Chain every call after the previous one.
let miningChain: Promise<unknown> = Promise.resolve();

/**
 * Mine a new block. Orchestrates:
 * 1. Finalize eligible proofs by asking the C++ engine to compute rewards
 *    and produce coinbase tx specs.
 * 2. Send add_block to the C++ engine (it drains its own mempool).
 * 3. Persist the returned block to PostgreSQL.
 *
 * No consensus or crypto logic lives in this file — it is pure orchestration.
 * Calls are serialized (see miningChain) so mining is never re-entrant.
 */
export function mineBlock(engine: CppEngine, dbPool: Pool): Promise<EngineBlockData | null> {
  const result = miningChain.then(() => doMineBlock(engine, dbPool));
  miningChain = result.then(() => undefined, () => undefined); // keep the chain alive past errors
  return result;
}

async function doMineBlock(
  engine: CppEngine,
  dbPool: Pool,
): Promise<EngineBlockData | null> {
  const { coinbaseTxs, proofIds } = await finalizeProofs(engine, dbPool);

  // Prevent empty ledger entries: a block is only worth mining if it carries an
  // approved (consensus-finalized) proof or at least one pending token transfer.
  // Without this guard a block with no content could be appended on an idle tick.
  const pending = await engine.mempoolGetPending();
  if (coinbaseTxs.length === 0 && pending.pending_count === 0) {
    return null;
  }

  const result = await engine.addBlock(coinbaseTxs);
  if (!result) {
    return null;
  }

  await persistBlockFromEngine(dbPool, result.block, proofIds);

  const coinbaseCount = result.block.transactions.filter(t => t.type === 'coinbase').length;
  const transferCount = result.block.transactions.filter(t => t.type === 'transfer').length;

  console.log(
    `Block #${result.block.block_number} mined: ${result.block.block_hash.slice(0, 16)}… ` +
    `(${coinbaseCount} coinbase, ${transferCount} transfer, ${result.block.total_minted.toFixed(2)} PoC minted)`
  );

  return result.block;
}

/**
 * Resolve every proof still in the voting stage and produce coinbase tx specs
 * for the ones that have earned a place on the chain.
 *
 * Consensus is the gate (NOT elapsed time): a proof is finalized as soon as the
 * community reaches consensus — a quorum of verifiers agreeing within the
 * outlier threshold (engine.consensusStatus → consensus_reached). This is what
 * makes "Consensus Reached → Block Creation" real instead of waiting out the
 * full voting window.
 *
 *   - consensus reached            → finalize, mint rewards, include in block
 *   - voting window closed, no
 *     consensus (too few votes, or
 *     persistent disagreement)     → reject; the proof NEVER enters a block
 *   - otherwise                    → leave in voting, keep collecting votes
 *
 * The C++ engine remains the single source of truth for the consensus decision
 * and reward math; this function only orchestrates DB I/O.
 */
async function finalizeProofs(
  engine: CppEngine,
  dbPool: Pool,
): Promise<{ coinbaseTxs: CoinbaseTxSpec[]; proofIds: string[] }> {
  const now = Math.floor(Date.now() / 1000);

  // Every proof currently in the voting stage (no deadline filter — consensus
  // can finalize a proof early, before its window closes).
  const voting = await dbPool.query<PendingProofRow>(
    `SELECT
       cp.proof_id,
       cp.app_id,
       cp.tester_address,
       cp.voting_deadline,
       COUNT(v.verification_id)::text AS vote_count
     FROM crash_proofs cp
     LEFT JOIN verifications v ON v.proof_id = cp.proof_id
     WHERE cp.status = 'voting'
     GROUP BY cp.proof_id, cp.app_id, cp.tester_address, cp.voting_deadline
     ORDER BY cp.submitted_at ASC`,
  );

  if (voting.rows.length === 0) {
    return { coinbaseTxs: [], proofIds: [] };
  }

  // Quorum scales with the active community and is the single source of truth
  // shared with the verification routes and the mempool, so a proof finalizes
  // here against exactly the threshold the UI advertises.
  const quorum = await computeQuorum(dbPool, now);

  // ── Phase A: decide (read-only). Pick at most one winning proof per app
  // (the earliest that reached consensus) and mark the rest for rejection when
  // their voting window has closed. This mirrors the previous logic exactly;
  // it just runs before the write transaction so the AI review below (which may
  // make network calls) never happens inside an open transaction.
  const winners: Winner[] = [];
  const toReject: string[] = [];
  const wonApps = new Set<string>();

  for (const row of voting.rows) {
    if (wonApps.has(row.app_id)) continue; // a sibling already won this app

    const voteCount = parseInt(row.vote_count);
    const deadlinePassed = parseInt(row.voting_deadline) <= now;

    // A proof needs at least a quorum before consensus can even be assessed.
    if (voteCount >= quorum) {
      const votesResult = await dbPool.query<VoteRow>(
        'SELECT verifier_address, score::text AS score FROM verifications WHERE proof_id = $1',
        [row.proof_id],
      );
      const votes = votesResult.rows.map(v => ({
        address: v.verifier_address,
        score: parseFloat(v.score),
      }));

      // Consensus decision is the engine's — single source of truth.
      const status = await engine.consensusStatus(votes, quorum);
      if (status.consensus_reached) {
        winners.push({ row, votes, verdicts: [] });
        wonApps.add(row.app_id);
        continue;
      }
    }

    // No consensus yet. If the voting window has closed, the proof can never
    // reach consensus — reject it so it is excluded from the chain for good.
    if (deadlinePassed) {
      toReject.push(row.proof_id);
    }
    // Otherwise leave it in 'voting' to keep accumulating verifications.
  }

  // ── Phase A2: advisory AI review (outside any transaction). Each winner is
  // shown to the three AI models; their verdicts only decorate the block with an
  // "AI Verified" badge and never change whether the proof finalizes.
  if (AI_VERIFICATION_ENABLED) {
    for (const winner of winners) {
      winner.verdicts = await reviewWithAi(dbPool, winner.row.proof_id);
    }
  }

  // ── Phase B: commit (write transaction). Build coinbases, finalize winners,
  // archive their siblings, persist AI verdicts, and reject the timed-out proofs.
  const coinbaseTxs: CoinbaseTxSpec[] = [];
  const proofIds: string[] = [];

  const client = await dbPool.connect();
  try {
    await client.query('BEGIN');

    for (const { row, votes, verdicts } of winners) {
      const built = await engine.buildCoinbase(row.proof_id, row.tester_address, votes);
      coinbaseTxs.push(built.coinbase_tx);
      proofIds.push(row.proof_id);

      await client.query(
        `UPDATE crash_proofs
         SET status = 'finalized', reward_score = $1, finalized_at = $2
         WHERE proof_id = $3`,
        [built.median_score, now, row.proof_id],
      );

      // Archive every competing proof for the same app: once a winner is
      // accepted into the ledger, only the accepted proof remains active.
      await client.query(
        `UPDATE crash_proofs
         SET status = 'archived', finalized_at = $1
         WHERE app_id = $2 AND proof_id <> $3 AND status IN ('voting', 'pending')`,
        [now, row.app_id, row.proof_id],
      );

      for (const v of verdicts) {
        await client.query(
          `INSERT INTO ai_verifications
             (proof_id, model, approved, confidence_score, reasoning, request_hash, queried_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (proof_id, model) DO NOTHING`,
          [row.proof_id, v.model, v.approved, Number(v.confidence.toFixed(3)), v.reasoning, v.requestHash, now],
        );
      }
    }

    for (const proofId of toReject) {
      await client.query(
        `UPDATE crash_proofs SET status = 'rejected', finalized_at = $1 WHERE proof_id = $2`,
        [now, proofId],
      );
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  return { coinbaseTxs, proofIds };
}

// A consensus-reached proof that will be minted this tick, plus its captured
// votes and (advisory) AI verdicts.
interface Winner {
  row: PendingProofRow;
  votes: { address: string; score: number }[];
  verdicts: AiVerdict[];
}

/**
 * Run the advisory AI review for one winning proof: load the target source and
 * the crash input, then ask the three models. Failures degrade gracefully to no
 * verdicts (the block simply won't earn the "AI Verified" badge) — AI review
 * must never block mining.
 */
async function reviewWithAi(dbPool: Pool, proofId: string): Promise<AiVerdict[]> {
  try {
    const res = await dbPool.query<{
      name: string;
      language: string;
      source_code: string;
      input_format: string;
      crash_input: Buffer;
    }>(
      `SELECT a.name, a.language, ac.source_code, pc.input_format, pc.crash_input
         FROM crash_proofs cp
         JOIN apps a           ON a.app_id = cp.app_id
         JOIN app_contents ac  ON ac.content_hash = a.content_hash
         JOIN proof_contents pc ON pc.content_hash = cp.content_hash
        WHERE cp.proof_id = $1`,
      [proofId],
    );
    const r = res.rows[0];
    if (!r) return [];

    return await judgeProof({
      appName: r.name,
      language: r.language,
      sourceCode: r.source_code,
      inputFormat: r.input_format,
      crashInputHex: r.crash_input.toString('hex'),
    });
  } catch (err) {
    console.error(`AI review for proof ${proofId.slice(0, 12)}… failed:`, err instanceof Error ? err.message : err);
    return [];
  }
}
