import { randomBytes } from 'crypto';
import type { Pool, PoolClient } from 'pg';
import { getEngine } from '../blockchain/instance';

// Long-lived refresh tokens with rotation + reuse detection.
//
// Storage: only SHA-256(token) is persisted (hashed via the C++ engine to keep
// the "no hashing primitives in TypeScript" invariant), so a DB leak does not
// yield usable tokens. Each refresh rotates the token: the old one is marked
// `used` and linked to its successor. Presenting an already-used token is a
// reuse signal — we revoke the whole family for that address.

function getRefreshTtlSeconds(): number {
  return parseInt(process.env['REFRESH_TOKEN_TTL_SECONDS'] ?? '2592000'); // 30 days
}

async function hashToken(token: string): Promise<string> {
  // Token is hex; hash its raw bytes (consistent with how addresses are hashed).
  return getEngine().sha256(Buffer.from(token, 'hex'));
}

export interface IssuedRefreshToken {
  token: string;       // opaque hex string returned to the client (never stored)
  expires_at: number;  // Unix seconds
}

/** Issue a fresh refresh token for an address and persist its hash. */
export async function issueRefreshToken(
  pool: Pool,
  address: string,
  primaryAddress: string,
): Promise<IssuedRefreshToken> {
  const token = randomBytes(32).toString('hex');
  const tokenHash = await hashToken(token);
  const now = Math.floor(Date.now() / 1000);
  const expires_at = now + getRefreshTtlSeconds();

  await pool.query(
    `INSERT INTO refresh_tokens
       (token_hash, address, primary_address, issued_at, expires_at, used, revoked, created_at)
     VALUES ($1, $2, $3, $4, $5, FALSE, FALSE, $4)`,
    [tokenHash, address, primaryAddress, now, expires_at],
  );

  return { token, expires_at };
}

export type RefreshResult =
  | { ok: true; address: string; primary_address: string; token: string; expires_at: number }
  | { ok: false; reason: 'invalid' | 'expired' | 'revoked' | 'reused'; address?: string };

/**
 * Validate a presented refresh token and rotate it. Runs in a transaction with
 * row-level locking so two concurrent refreshes can't both succeed on the same
 * token.
 */
export async function rotateRefreshToken(pool: Pool, presentedToken: string): Promise<RefreshResult> {
  if (typeof presentedToken !== 'string' || !/^[0-9a-f]{64}$/.test(presentedToken.toLowerCase())) {
    return { ok: false, reason: 'invalid' };
  }
  const tokenHash = await hashToken(presentedToken.toLowerCase());

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const lookup = await client.query<{
      address: string;
      primary_address: string;
      expires_at: string;
      used: boolean;
      revoked: boolean;
    }>(
      `SELECT address, primary_address, expires_at, used, revoked
         FROM refresh_tokens WHERE token_hash = $1 FOR UPDATE`,
      [tokenHash],
    );

    const row = lookup.rows[0];
    if (!row) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'invalid' };
    }

    if (row.revoked) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'revoked', address: row.address };
    }

    // Reuse detection: an already-used token presented again means it (or its
    // successor) leaked. Revoke the entire family for the address.
    if (row.used) {
      await revokeAllForAddressTx(client, row.address);
      await client.query('COMMIT');
      return { ok: false, reason: 'reused', address: row.address };
    }

    const now = Math.floor(Date.now() / 1000);
    if (parseInt(row.expires_at) < now) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'expired', address: row.address };
    }

    // Issue the successor token.
    const newToken = randomBytes(32).toString('hex');
    const newHash = await hashToken(newToken);
    const expires_at = now + getRefreshTtlSeconds();

    await client.query(
      `INSERT INTO refresh_tokens
         (token_hash, address, primary_address, issued_at, expires_at, used, revoked, created_at)
       VALUES ($1, $2, $3, $4, $5, FALSE, FALSE, $4)`,
      [newHash, row.address, row.primary_address, now, expires_at],
    );

    await client.query(
      `UPDATE refresh_tokens SET used = TRUE, rotated_to = $1 WHERE token_hash = $2`,
      [newHash, tokenHash],
    );

    await client.query('COMMIT');
    return {
      ok: true,
      address: row.address,
      primary_address: row.primary_address,
      token: newToken,
      expires_at,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function revokeAllForAddressTx(client: PoolClient, address: string): Promise<number> {
  const res = await client.query(
    `UPDATE refresh_tokens SET revoked = TRUE WHERE address = $1 AND revoked = FALSE`,
    [address],
  );
  return res.rowCount ?? 0;
}

/** Revoke every refresh token for an address (used by logout-all + reuse). */
export async function revokeRefreshTokensForAddress(pool: Pool, address: string): Promise<number> {
  const res = await pool.query(
    `UPDATE refresh_tokens SET revoked = TRUE WHERE address = $1 AND revoked = FALSE`,
    [address],
  );
  return res.rowCount ?? 0;
}

/** Revoke a single refresh token by its plaintext value (used by logout). */
export async function revokeRefreshToken(pool: Pool, token: string): Promise<void> {
  if (typeof token !== 'string' || !/^[0-9a-f]{64}$/.test(token.toLowerCase())) return;
  const tokenHash = await hashToken(token.toLowerCase());
  await pool.query(`UPDATE refresh_tokens SET revoked = TRUE WHERE token_hash = $1`, [tokenHash]);
}

/** Drop refresh tokens that have already expired. */
export async function purgeExpiredRefreshTokens(pool: Pool): Promise<number> {
  const now = Math.floor(Date.now() / 1000);
  const res = await pool.query(`DELETE FROM refresh_tokens WHERE expires_at < $1`, [now]);
  return res.rowCount ?? 0;
}
