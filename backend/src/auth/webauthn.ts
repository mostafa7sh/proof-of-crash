import type { Pool } from 'pg';
import { randomUUID } from 'crypto';
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from '@simplewebauthn/server';
import type {
  RegistrationResponseJSON,
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
} from '@simplewebauthn/types';

// ─── WebAuthn (passkey) — SESSION-ONLY authentication ────────────────────────
//
// A passkey proves "the same authenticator that registered is present" and logs
// the user into their account. It CANNOT sign blockchain transactions (the key
// is non-exportable and signs only WebAuthn assertions), so on-chain actions
// still require the account's Ed25519 wallet key. Passkeys therefore attach to
// an existing account (which already has >=1 signing key); there are no
// passkey-only accounts. WebAuthn's origin/RP binding (enforced by the browser)
// makes this path phishing-resistant — unlike the raw paste-sign flow.

const RP_ID = process.env['WEBAUTHN_RP_ID'] ?? 'localhost';
const RP_NAME = process.env['WEBAUTHN_RP_NAME'] ?? 'Proof of Crash';
// Browser origin(s) the ceremony may occur on. localhost is allowed over http;
// any real deployment must set WEBAUTHN_ORIGIN (and WEBAUTHN_RP_ID) to its host.
const EXPECTED_ORIGINS = (process.env['WEBAUTHN_ORIGIN'] ??
  'http://localhost:3001,http://localhost:3009,http://localhost:5173')
  .split(',').map((s) => s.trim()).filter(Boolean);

const CHALLENGE_TTL_SECONDS = 120;

export type WebauthnError =
  | { kind: 'flow_not_found' }
  | { kind: 'flow_expired' }
  | { kind: 'verification_failed' }
  | { kind: 'unknown_credential' };

// Note: no `kind` field here — it would collide with WebauthnError's `kind`
// discriminant and break narrowing on the consume result.
interface ChallengeRow { user_id: string | null; challenge: string; expires_at: string; used: boolean }

async function storeChallenge(
  pool: Pool,
  kind: 'register' | 'authenticate',
  challenge: string,
  userId: string | null,
): Promise<string> {
  const flowId = randomUUID();
  const now = Math.floor(Date.now() / 1000);
  await pool.query(
    `INSERT INTO webauthn_challenges (flow_id, user_id, kind, challenge, expires_at, used, created_at)
     VALUES ($1, $2, $3, $4, $5, FALSE, $6)`,
    [flowId, userId, kind, challenge, now + CHALLENGE_TTL_SECONDS, now],
  );
  return flowId;
}

// Atomically claim a ceremony challenge (single-use), returning it if still valid.
async function consumeChallenge(
  pool: Pool,
  flowId: string,
  kind: 'register' | 'authenticate',
): Promise<ChallengeRow | WebauthnError> {
  const claim = await pool.query<ChallengeRow>(
    `UPDATE webauthn_challenges SET used = TRUE
      WHERE flow_id = $1 AND kind = $2 AND used = FALSE
      RETURNING user_id, challenge, expires_at, used`,
    [flowId, kind],
  );
  const row = claim.rows[0];
  if (!row) return { kind: 'flow_not_found' };
  if (parseInt(row.expires_at) < Math.floor(Date.now() / 1000)) return { kind: 'flow_expired' };
  return row;
}

// ─── Registration (authenticated: add a passkey to the current account) ──────

export async function webauthnRegisterOptions(
  pool: Pool,
  userId: string,
  username?: string,
): Promise<{ flow_id: string; options: PublicKeyCredentialCreationOptionsJSON }> {
  const existing = await pool.query<{ credential_id: string; transports: string | null }>(
    `SELECT credential_id, transports FROM webauthn_credentials WHERE user_id = $1`,
    [userId],
  );
  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: RP_ID,
    userID: userId,                 // opaque account id as the WebAuthn userHandle
    // Human-friendly name shown in the authenticator / OS passkey prompt; falls
    // back to an opaque account handle when the user didn't choose a username.
    userName: username && username.trim() ? username.trim() : `poc:${userId.slice(0, 8)}`,
    attestationType: 'none',
    excludeCredentials: existing.rows.map((r) => ({
      id: Buffer.from(r.credential_id, 'base64url'),
      type: 'public-key' as const,
    })),
    authenticatorSelection: { residentKey: 'preferred', userVerification: 'preferred' },
  });
  const flow_id = await storeChallenge(pool, 'register', options.challenge, userId);
  return { flow_id, options };
}

export async function webauthnRegisterVerify(
  pool: Pool,
  userId: string,
  input: { flow_id: string; response: RegistrationResponseJSON; label?: string },
): Promise<{ credential_id: string } | WebauthnError> {
  const flow = await consumeChallenge(pool, input.flow_id, 'register');
  if ('kind' in flow) return flow;
  if (flow.user_id !== userId) return { kind: 'verification_failed' };

  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response: input.response,
      expectedChallenge: flow.challenge,
      expectedOrigin: EXPECTED_ORIGINS,
      expectedRPID: RP_ID,
      requireUserVerification: false,
    });
  } catch {
    return { kind: 'verification_failed' };
  }
  if (!verification.verified || !verification.registrationInfo) return { kind: 'verification_failed' };

  const info = verification.registrationInfo;
  const credentialId = Buffer.from(info.credentialID).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  await pool.query(
    `INSERT INTO webauthn_credentials
       (credential_id, user_id, public_key, counter, device_type, backed_up, transports, label, created_at, last_used_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9)
     ON CONFLICT (credential_id) DO NOTHING`,
    [
      credentialId,
      userId,
      Buffer.from(info.credentialPublicKey),
      info.counter,
      info.credentialDeviceType,
      info.credentialBackedUp,
      JSON.stringify(input.response.response.transports ?? []),
      input.label ?? null,
      now,
    ],
  );
  return { credential_id: credentialId };
}

// ─── Authentication (public: usernameless / discoverable passkey login) ──────

export async function webauthnAuthOptions(
  pool: Pool,
): Promise<{ flow_id: string; options: PublicKeyCredentialRequestOptionsJSON }> {
  // No allowCredentials → discoverable credential; the user picks their passkey.
  const options = await generateAuthenticationOptions({ rpID: RP_ID, userVerification: 'preferred' });
  const flow_id = await storeChallenge(pool, 'authenticate', options.challenge, null);
  return { flow_id, options };
}

export async function webauthnAuthVerify(
  pool: Pool,
  input: { flow_id: string; response: AuthenticationResponseJSON },
): Promise<{ user_id: string; primary_address: string } | WebauthnError> {
  const flow = await consumeChallenge(pool, input.flow_id, 'authenticate');
  if ('kind' in flow) return flow;

  const credId = input.response.id; // base64url credential id
  const cred = await pool.query<{ user_id: string; public_key: Buffer; counter: string }>(
    `SELECT user_id, public_key, counter FROM webauthn_credentials WHERE credential_id = $1`,
    [credId],
  );
  const row = cred.rows[0];
  if (!row) return { kind: 'unknown_credential' };

  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response: input.response,
      expectedChallenge: flow.challenge,
      expectedOrigin: EXPECTED_ORIGINS,
      expectedRPID: RP_ID,
      requireUserVerification: false,
      authenticator: {
        credentialID: Buffer.from(credId, 'base64url'),
        credentialPublicKey: new Uint8Array(row.public_key),
        counter: parseInt(row.counter),
      },
    });
  } catch {
    return { kind: 'verification_failed' };
  }
  if (!verification.verified) return { kind: 'verification_failed' };

  const now = Math.floor(Date.now() / 1000);
  await pool.query(
    `UPDATE webauthn_credentials SET counter = $1, last_used_at = $2 WHERE credential_id = $3`,
    [verification.authenticationInfo.newCounter, now, credId],
  );

  // Map the account to its primary signing key so a normal session can be issued
  // (session "acts as" the primary address; on-chain signing still needs the key).
  const user = await pool.query<{ primary_address: string }>(
    `SELECT primary_address FROM users WHERE user_id = $1`,
    [row.user_id],
  );
  const primary = user.rows[0]?.primary_address;
  if (!primary) return { kind: 'unknown_credential' };
  return { user_id: row.user_id, primary_address: primary };
}

export async function purgeExpiredWebauthnChallenges(pool: Pool): Promise<number> {
  const res = await pool.query(
    `DELETE FROM webauthn_challenges WHERE expires_at < $1`,
    [Math.floor(Date.now() / 1000)],
  );
  return res.rowCount ?? 0;
}
