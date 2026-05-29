import type { Pool } from 'pg';
import { getEngine } from '../blockchain/instance';
import { consumeChallenge } from './challenges';
import { buildSignedMessage } from './messages';

const HEX_64 = /^[0-9a-f]{64}$/;
const HEX_128 = /^[0-9a-f]{128}$/;

export type ServiceError =
  | { kind: 'validation'; message: string }
  | { kind: 'challenge'; reason: 'not_found' | 'already_used' | 'expired' | 'wrong_address' }
  | { kind: 'address_mismatch' }
  | { kind: 'bad_signature' }
  | { kind: 'already_registered' }
  | { kind: 'unknown_address' }
  | { kind: 'address_revoked' };

export interface RegisteredIdentity {
  primary_address: string;
  address: string;
  registered_at: number;
}

export interface AuthenticatedIdentity {
  primary_address: string;
  address: string;
}

export interface AttachedAddress {
  primary_address: string;
  address: string;
  registered_at: number;
}

function lowerHex(s: unknown): string | null {
  if (typeof s !== 'string') return null;
  return s.toLowerCase();
}

/**
 * Register a new (public_key, address) pair.
 *
 * - address must equal hex(SHA256(public_key_bytes)).
 * - signature must be a valid Ed25519 signature over
 *   `poc-register-v1:<challenge>:<address>:<public_key>` by `public_key`.
 *
 * Both the SHA-256 derivation and the Ed25519 verification are delegated to
 * the C++ engine.
 */
export async function registerAddress(
  pool: Pool,
  input: {
    public_key: unknown;
    address: unknown;
    challenge: unknown;
    signature: unknown;
  },
): Promise<RegisteredIdentity | ServiceError> {
  const public_key = lowerHex(input.public_key);
  const address = lowerHex(input.address);
  const challenge = lowerHex(input.challenge);
  const signature = lowerHex(input.signature);

  if (!public_key || !HEX_64.test(public_key)) {
    return { kind: 'validation', message: 'public_key must be 64 hex chars (32-byte Ed25519 key)' };
  }
  if (!address || !HEX_64.test(address)) {
    return { kind: 'validation', message: 'address must be 64 hex chars' };
  }
  if (!challenge || !HEX_64.test(challenge)) {
    return { kind: 'validation', message: 'challenge must be 64 hex chars' };
  }
  if (!signature || !HEX_128.test(signature)) {
    return { kind: 'validation', message: 'signature must be 128 hex chars (64-byte Ed25519 sig)' };
  }

  const engine = getEngine();
  const derivedAddress = await engine.sha256(Buffer.from(public_key, 'hex'));
  if (derivedAddress !== address) {
    return { kind: 'address_mismatch' };
  }

  const message = buildSignedMessage('register', challenge, address, public_key);
  const sigOk = await engine.verifyEd25519(message.toString('hex'), signature, public_key);
  if (!sigOk) {
    return { kind: 'bad_signature' };
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const consumed = await consumeChallenge(client, challenge, address);
    if (!consumed.ok) {
      await client.query('ROLLBACK');
      return { kind: 'challenge', reason: consumed.reason };
    }

    const exists = await client.query(
      `SELECT 1 FROM user_addresses WHERE address = $1 OR public_key = $2`,
      [address, public_key],
    );
    if (exists.rows.length > 0) {
      await client.query('ROLLBACK');
      return { kind: 'already_registered' };
    }

    const now = Math.floor(Date.now() / 1000);

    await client.query(
      `INSERT INTO users (primary_address, reputation, created_at)
       VALUES ($1, 0.00, $2)
       ON CONFLICT (primary_address) DO NOTHING`,
      [address, now],
    );

    await client.query(
      `INSERT INTO user_addresses
         (address, user_primary_address, public_key, registered_at,
          is_revoked, revoked_at, registration_signature)
       VALUES ($1, $2, $3, $4, FALSE, NULL, $5)`,
      [address, address, public_key, now, signature],
    );

    await client.query('COMMIT');
    return { primary_address: address, address, registered_at: now };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Authenticate an existing address.
 *
 * Looks up the stored public key and asks the C++ engine to verify the
 * Ed25519 signature over `poc-login-v1:<challenge>:<address>`.
 */
export async function loginAddress(
  pool: Pool,
  input: {
    address: unknown;
    challenge: unknown;
    signature: unknown;
  },
): Promise<AuthenticatedIdentity | ServiceError> {
  const address = lowerHex(input.address);
  const challenge = lowerHex(input.challenge);
  const signature = lowerHex(input.signature);

  if (!address || !HEX_64.test(address)) {
    return { kind: 'validation', message: 'address must be 64 hex chars' };
  }
  if (!challenge || !HEX_64.test(challenge)) {
    return { kind: 'validation', message: 'challenge must be 64 hex chars' };
  }
  if (!signature || !HEX_128.test(signature)) {
    return { kind: 'validation', message: 'signature must be 128 hex chars' };
  }

  const lookup = await pool.query<{
    public_key: string;
    user_primary_address: string;
    is_revoked: boolean;
  }>(
    `SELECT public_key, user_primary_address, is_revoked
       FROM user_addresses WHERE address = $1`,
    [address],
  );

  const row = lookup.rows[0];
  if (!row) return { kind: 'unknown_address' };
  if (row.is_revoked) return { kind: 'address_revoked' };

  const engine = getEngine();
  const message = buildSignedMessage('login', challenge, address);
  const sigOk = await engine.verifyEd25519(message.toString('hex'), signature, row.public_key);
  if (!sigOk) {
    return { kind: 'bad_signature' };
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const consumed = await consumeChallenge(client, challenge, address);
    if (!consumed.ok) {
      await client.query('ROLLBACK');
      return { kind: 'challenge', reason: consumed.reason };
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  return { primary_address: row.user_primary_address, address };
}

/**
 * Attach an additional (public_key, address) to an existing user. Same proof
 * mechanics as registration — the new key must prove ownership by signing the
 * `poc-register-v1` challenge message — but the row is linked to the caller's
 * existing `primary_address` instead of creating a new user. Enables key
 * rotation and multi-device access; previously registered addresses keep
 * working unchanged.
 */
export async function attachAddress(
  pool: Pool,
  primaryAddress: string,
  input: {
    public_key: unknown;
    address: unknown;
    challenge: unknown;
    signature: unknown;
  },
): Promise<AttachedAddress | ServiceError> {
  const public_key = lowerHex(input.public_key);
  const address = lowerHex(input.address);
  const challenge = lowerHex(input.challenge);
  const signature = lowerHex(input.signature);

  if (!public_key || !HEX_64.test(public_key)) {
    return { kind: 'validation', message: 'public_key must be 64 hex chars (32-byte Ed25519 key)' };
  }
  if (!address || !HEX_64.test(address)) {
    return { kind: 'validation', message: 'address must be 64 hex chars' };
  }
  if (!challenge || !HEX_64.test(challenge)) {
    return { kind: 'validation', message: 'challenge must be 64 hex chars' };
  }
  if (!signature || !HEX_128.test(signature)) {
    return { kind: 'validation', message: 'signature must be 128 hex chars (64-byte Ed25519 sig)' };
  }

  const engine = getEngine();
  const derivedAddress = await engine.sha256(Buffer.from(public_key, 'hex'));
  if (derivedAddress !== address) {
    return { kind: 'address_mismatch' };
  }

  const message = buildSignedMessage('register', challenge, address, public_key);
  const sigOk = await engine.verifyEd25519(message.toString('hex'), signature, public_key);
  if (!sigOk) {
    return { kind: 'bad_signature' };
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // The parent user must still exist (it does — caller is authenticated).
    const userExists = await client.query(
      `SELECT 1 FROM users WHERE primary_address = $1`,
      [primaryAddress],
    );
    if (userExists.rows.length === 0) {
      await client.query('ROLLBACK');
      return { kind: 'unknown_address' };
    }

    const consumed = await consumeChallenge(client, challenge, address);
    if (!consumed.ok) {
      await client.query('ROLLBACK');
      return { kind: 'challenge', reason: consumed.reason };
    }

    const exists = await client.query(
      `SELECT 1 FROM user_addresses WHERE address = $1 OR public_key = $2`,
      [address, public_key],
    );
    if (exists.rows.length > 0) {
      await client.query('ROLLBACK');
      return { kind: 'already_registered' };
    }

    const now = Math.floor(Date.now() / 1000);
    await client.query(
      `INSERT INTO user_addresses
         (address, user_primary_address, public_key, registered_at,
          is_revoked, revoked_at, registration_signature)
       VALUES ($1, $2, $3, $4, FALSE, NULL, $5)`,
      [address, primaryAddress, public_key, now, signature],
    );

    await client.query('COMMIT');
    return { primary_address: primaryAddress, address, registered_at: now };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
