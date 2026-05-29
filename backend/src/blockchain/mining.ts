import { Pool } from 'pg';
import { CppEngine, type CoinbaseTxSpec, type EngineBlockData } from './CppEngine';
import { persistBlockFromEngine } from './persistence';

// Minimum verifier vote count must match the C++ engine's MIN_VERIFICATIONS.
// Used only to filter the DB query — the actual consensus decision is made by
// the engine when build_coinbase is called.
const MIN_VERIFICATIONS = 3;

// ─── DB Row Shapes ───────────────────────────────────────────────────────────

interface PendingProofRow {
  proof_id: string;
  tester_address: string;
  voting_deadline: string;
  vote_count: string;
}

interface VoteRow {
  verifier_address: string;
  score: string;
}

// ─── Mining ──────────────────────────────────────────────────────────────────

/**
 * Mine a new block. Orchestrates:
 * 1. Finalize eligible proofs by asking the C++ engine to compute rewards
 *    and produce coinbase tx specs.
 * 2. Send add_block to the C++ engine (it drains its own mempool).
 * 3. Persist the returned block to PostgreSQL.
 *
 * No consensus or crypto logic lives in this file — it is pure orchestration.
 */
export async function mineBlock(
  engine: CppEngine,
  dbPool: Pool,
): Promise<EngineBlockData | null> {
  const { coinbaseTxs, proofIds } = await finalizeProofs(engine, dbPool);

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
 * Scan for finalizeable proofs and ask the C++ engine to build coinbase tx
 * specs for each. The engine is the single source of truth for reward math
 * and finalization eligibility — TypeScript only orchestrates DB I/O.
 */
async function finalizeProofs(
  engine: CppEngine,
  dbPool: Pool,
): Promise<{ coinbaseTxs: CoinbaseTxSpec[]; proofIds: string[] }> {
  const now = Math.floor(Date.now() / 1000);

  const pending = await dbPool.query<PendingProofRow>(
    `SELECT
       cp.proof_id,
       cp.tester_address,
       cp.voting_deadline,
       COUNT(v.verification_id)::text AS vote_count
     FROM crash_proofs cp
     LEFT JOIN verifications v ON v.proof_id = cp.proof_id
     WHERE cp.status = 'voting'
       AND cp.voting_deadline <= $1
     GROUP BY cp.proof_id, cp.tester_address, cp.voting_deadline
     HAVING COUNT(v.verification_id) >= $2`,
    [now, MIN_VERIFICATIONS]
  );

  if (pending.rows.length === 0) {
    return { coinbaseTxs: [], proofIds: [] };
  }

  const coinbaseTxs: CoinbaseTxSpec[] = [];
  const proofIds: string[] = [];

  const client = await dbPool.connect();
  try {
    await client.query('BEGIN');

    for (const row of pending.rows) {
      // Ask the engine whether this proof is ready to finalize.
      const finalCheck = await engine.checkFinalization(
        parseInt(row.vote_count),
        parseInt(row.voting_deadline),
        now,
      );
      if (!finalCheck.can_finalize) continue;

      // Fetch votes for this proof.
      const votesResult = await client.query<VoteRow>(
        'SELECT verifier_address, score::text AS score FROM verifications WHERE proof_id = $1',
        [row.proof_id]
      );
      if (votesResult.rows.length < MIN_VERIFICATIONS) continue;

      const votes = votesResult.rows.map(v => ({
        address: v.verifier_address,
        score: parseFloat(v.score),
      }));

      // Engine computes the reward distribution and returns a coinbase tx spec.
      const built = await engine.buildCoinbase(row.proof_id, row.tester_address, votes);

      coinbaseTxs.push(built.coinbase_tx);
      proofIds.push(row.proof_id);

      await client.query(
        `UPDATE crash_proofs
         SET status = 'finalized', reward_score = $1, finalized_at = $2
         WHERE proof_id = $3`,
        [built.median_score, now, row.proof_id]
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
