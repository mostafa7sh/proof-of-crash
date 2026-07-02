import { Pool } from 'pg';

// Hard floor for the verification quorum — must match the C++ engine's
// MIN_VERIFICATIONS. The runtime quorum is never allowed below this.
export const QUORUM_FLOOR = 3;

const WEEK_SECONDS = 7 * 24 * 60 * 60;

/**
 * Dynamic verification quorum. The number of independent validators a proof
 * needs to reach consensus scales with the size of the active community, so a
 * small clique cannot finalize a proof when many people are participating:
 *
 *   quorum = max(3, floor(activeAccountsPastWeek / 5))
 *
 * "Active" = distinct ACCOUNTS that voted, submitted a proof, or uploaded an
 * app in the last 7 days. Activity addresses are resolved to their account via
 * user_addresses (matching the account-level anti-collusion model), so extra
 * keys on one account do not inflate the count.
 *
 * This is the single source of truth for the quorum: the verification routes,
 * the submission mempool, and the miner all call it, so the number the UI shows
 * is exactly the number the chain enforces.
 */
export async function computeQuorum(
  dbPool: Pool,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): Promise<number> {
  const since = nowSeconds - WEEK_SECONDS;

  const result = await dbPool.query<{ active: string }>(
    `SELECT COUNT(DISTINCT ua.user_primary_address) AS active
       FROM (
         SELECT verifier_address AS addr, signed_at  AS ts FROM verifications
         UNION ALL
         SELECT tester_address,           submitted_at      FROM crash_proofs
         UNION ALL
         SELECT developer_address,        uploaded_at       FROM apps
       ) act
       JOIN user_addresses ua ON ua.address = act.addr
      WHERE act.ts >= $1`,
    [since],
  );

  const active = parseInt(result.rows[0]?.active ?? '0', 10);
  return Math.max(QUORUM_FLOOR, Math.floor(active / 5));
}
