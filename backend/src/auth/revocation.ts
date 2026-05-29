import type { Pool } from 'pg';
import { revokeRefreshTokensForAddress } from './refreshTokens';

// Access-token revocation works at two granularities:
//   1. Single token  → denylist its jti in `revoked_jtis`.
//   2. All tokens for an address → bump `user_addresses.tokens_valid_after`
//      to now, so every token issued before that instant is rejected.
// Both are checked by the auth middleware. Address-level `is_revoked`
// (key compromise / rotation) remains a separate, stronger control.

/** Denylist a single access token by its jti until its natural expiry. */
export async function revokeJti(
  pool: Pool,
  jti: string,
  address: string,
  tokenExp: number,
  reason: string,
): Promise<void> {
  await pool.query(
    `INSERT INTO revoked_jtis (jti, address, revoked_at, expires_at, reason)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (jti) DO NOTHING`,
    [jti, address, Math.floor(Date.now() / 1000), tokenExp, reason],
  );
}

/** True if the given jti has been individually revoked. */
export async function isJtiRevoked(pool: Pool, jti: string): Promise<boolean> {
  const res = await pool.query(`SELECT 1 FROM revoked_jtis WHERE jti = $1`, [jti]);
  return res.rows.length > 0;
}

/**
 * Revoke every access token for an address (sets the validity cutoff) and
 * revoke all of its refresh tokens. Returns the cutoff timestamp.
 */
export async function revokeAllForAddress(pool: Pool, address: string): Promise<number> {
  const now = Math.floor(Date.now() / 1000);
  // tokens_valid_after must be strictly greater than the iat of any already
  // issued token. Tokens carry second-resolution iat, so use now + 1 to also
  // invalidate tokens minted in this same second.
  const cutoff = now + 1;
  await pool.query(
    `UPDATE user_addresses SET tokens_valid_after = $1 WHERE address = $2`,
    [cutoff, address],
  );
  await revokeRefreshTokensForAddress(pool, address);
  return cutoff;
}

/** Drop jti denylist rows whose tokens have already expired. */
export async function purgeExpiredRevokedJtis(pool: Pool): Promise<number> {
  const now = Math.floor(Date.now() / 1000);
  const res = await pool.query(`DELETE FROM revoked_jtis WHERE expires_at < $1`, [now]);
  return res.rowCount ?? 0;
}
