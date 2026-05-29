import { randomBytes } from 'crypto';
import type { Pool, PoolClient } from 'pg';

// Server-issued nonce lifetime. Short enough to limit replay window if a
// signature is exfiltrated; long enough for a human-driven sign-and-submit flow.
const CHALLENGE_TTL_SECONDS = 120;

export interface IssuedChallenge {
  challenge: string;   // 64 hex chars (32 random bytes)
  expires_at: number;  // Unix seconds
}

export async function issueChallenge(pool: Pool, address: string): Promise<IssuedChallenge> {
  const challenge = randomBytes(32).toString('hex');
  const now = Math.floor(Date.now() / 1000);
  const expires_at = now + CHALLENGE_TTL_SECONDS;

  await pool.query(
    `INSERT INTO auth_challenges (challenge, address, expires_at, used, created_at)
     VALUES ($1, $2, $3, FALSE, $4)`,
    [challenge, address, expires_at, now],
  );

  return { challenge, expires_at };
}

export interface ConsumedChallenge {
  ok: true;
}
export interface ChallengeRejection {
  ok: false;
  reason: 'not_found' | 'already_used' | 'expired' | 'wrong_address';
}

/**
 * Atomically validate and consume a challenge. The combination of `used = FALSE`
 * in the WHERE clause and `RETURNING` makes this safe against concurrent
 * double-submit: only one transaction can flip the row.
 */
export async function consumeChallenge(
  client: PoolClient,
  challenge: string,
  address: string,
): Promise<ConsumedChallenge | ChallengeRejection> {
  const lookup = await client.query<{ address: string; expires_at: string; used: boolean }>(
    `SELECT address, expires_at, used FROM auth_challenges WHERE challenge = $1`,
    [challenge],
  );

  const row = lookup.rows[0];
  if (!row) return { ok: false, reason: 'not_found' };
  if (row.used) return { ok: false, reason: 'already_used' };
  if (row.address !== address) return { ok: false, reason: 'wrong_address' };

  const now = Math.floor(Date.now() / 1000);
  if (parseInt(row.expires_at) < now) return { ok: false, reason: 'expired' };

  const claim = await client.query(
    `UPDATE auth_challenges
       SET used = TRUE
     WHERE challenge = $1 AND used = FALSE
     RETURNING challenge`,
    [challenge],
  );
  if (claim.rows.length === 0) return { ok: false, reason: 'already_used' };

  return { ok: true };
}

/**
 * Periodic cleanup of expired challenges. Safe to call repeatedly; idempotent.
 */
export async function purgeExpiredChallenges(pool: Pool): Promise<number> {
  const now = Math.floor(Date.now() / 1000);
  const res = await pool.query(
    `DELETE FROM auth_challenges WHERE expires_at < $1`,
    [now],
  );
  return res.rowCount ?? 0;
}
