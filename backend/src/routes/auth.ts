import { Router, Request, Response } from 'express';
import { pool } from '../config/database';
import {
  issueChallenge,
  registerAddress,
  loginAddress,
  attachAddress,
  signAccessToken,
  requireAuth,
  issueRefreshToken,
  rotateRefreshToken,
  revokeRefreshToken,
  revokeJti,
  revokeAllForAddress,
  recordAudit,
  setAuthCookies,
  clearAuthCookies,
  readRefreshToken,
  challengeRateLimiter,
  authWriteRateLimiter,
  webauthnRegisterOptions,
  webauthnRegisterVerify,
  webauthnAuthOptions,
  webauthnAuthVerify,
} from '../auth';
import type { RegistrationResponseJSON, AuthenticationResponseJSON } from '@simplewebauthn/types';
import type { ApiError } from '../types';

export const authRouter = Router();

const HEX_64 = /^[0-9a-f]{64}$/;

const challengeLimiter = challengeRateLimiter();
const writeLimiter = authWriteRateLimiter();

/** Best-effort extraction of a claimed address from a request body, for audit. */
function bodyAddress(req: Request): string | null {
  const a = (req.body as { address?: unknown } | undefined)?.address;
  return typeof a === 'string' ? a : null;
}

// ─── Session issuance helper ───────────────────────────────────────────────

/**
 * Mint an access token + refresh token for an identity, set HttpOnly cookies,
 * and return the JSON body. The access token (Bearer) and token fields are
 * preserved for backward compatibility; refresh_token is additive.
 */
async function issueSession(
  res: Response,
  identity: { primary_address: string; address: string },
): Promise<{
  token: string;
  expires_at: number;
  refresh_token: string;
  refresh_expires_at: number;
}> {
  const access = signAccessToken({ sub: identity.primary_address, addr: identity.address });
  const refresh = await issueRefreshToken(pool, identity.address, identity.primary_address);
  const nowSec = Math.floor(Date.now() / 1000);

  setAuthCookies(
    res,
    access.token,
    Math.max(1, access.expires_at - nowSec),
    refresh.token,
    Math.max(1, refresh.expires_at - nowSec),
  );

  return {
    token: access.token,
    expires_at: access.expires_at,
    refresh_token: refresh.token,
    refresh_expires_at: refresh.expires_at,
  };
}

// ─── Challenge ──────────────────────────────────────────────────────────────

// POST /api/auth/challenge — issue a one-shot nonce for an address.
// Rate-limited per IP to prevent flooding the auth_challenges table.
authRouter.post('/challenge', challengeLimiter, async (req: Request, res: Response) => {
  const { address } = req.body as { address?: unknown };
  const addr = typeof address === 'string' ? address.toLowerCase() : '';
  if (!HEX_64.test(addr)) {
    res.status(400).json({ error: 'address must be 64 hex chars', code: 'INVALID_ADDRESS' } satisfies ApiError);
    return;
  }

  try {
    // Returns { challenge, expires_at, pow_difficulty }. The client must solve
    // the proof-of-work and include pow_nonce in the register/login request.
    const issued = await issueChallenge(pool, addr);
    res.status(201).json(issued);
  } catch (err) {
    console.error('POST /api/auth/challenge error:', err);
    res.status(500).json({ error: 'Internal server error', code: 'INTERNAL_ERROR' } satisfies ApiError);
  }
});

// ─── Register ─────────────────────────────────────────────────────────────

// POST /api/auth/register — first-time registration of a (public_key, address).
authRouter.post('/register', writeLimiter, async (req: Request, res: Response) => {
  try {
    const result = await registerAddress(pool, req.body ?? {});
    if ('kind' in result) {
      await recordAudit(pool, req, {
        action: 'auth.login_failed',
        address: bodyAddress(req),
        details: { stage: 'register', reason: result.kind },
      });
      respondToServiceError(res, result);
      return;
    }

    const session = await issueSession(res, result);
    await recordAudit(pool, req, {
      action: 'auth.register',
      address: result.address,
      entityId: result.primary_address,
    });

    res.status(201).json({
      primary_address: result.primary_address,
      address: result.address,
      registered_at: result.registered_at,
      ...session,
    });
  } catch (err) {
    console.error('POST /api/auth/register error:', err);
    res.status(500).json({ error: 'Internal server error', code: 'INTERNAL_ERROR' } satisfies ApiError);
  }
});

// ─── Login ────────────────────────────────────────────────────────────────

// POST /api/auth/login — challenge-response login.
authRouter.post('/login', writeLimiter, async (req: Request, res: Response) => {
  try {
    const result = await loginAddress(pool, req.body ?? {});
    if ('kind' in result) {
      await recordAudit(pool, req, {
        action: 'auth.login_failed',
        address: bodyAddress(req),
        details: { reason: result.kind },   // granular for server-side audit only
      });
      // Anti-enumeration: never tell the client whether the address exists.
      // Unknown address and bad signature collapse to one generic failure.
      // (Validation/challenge/revoked errors stay specific — they aren't
      // existence oracles and the user needs them to recover.)
      if (result.kind === 'unknown_address' || result.kind === 'bad_signature') {
        res.status(401).json({ error: 'Authentication failed', code: 'AUTH_FAILED' } satisfies ApiError);
        return;
      }
      respondToServiceError(res, result);
      return;
    }

    const session = await issueSession(res, result);
    await recordAudit(pool, req, {
      action: 'auth.login',
      address: result.address,
      entityId: result.primary_address,
    });

    res.json({
      primary_address: result.primary_address,
      address: result.address,
      ...session,
    });
  } catch (err) {
    console.error('POST /api/auth/login error:', err);
    res.status(500).json({ error: 'Internal server error', code: 'INTERNAL_ERROR' } satisfies ApiError);
  }
});

// ─── Refresh ──────────────────────────────────────────────────────────────

// POST /api/auth/refresh — exchange a refresh token for a new access token.
// Rotates the refresh token (single-use); reuse triggers family revocation.
authRouter.post('/refresh', writeLimiter, async (req: Request, res: Response) => {
  const presented = readRefreshToken(req);
  if (!presented) {
    res.status(400).json({ error: 'refresh_token is required (body or cookie)', code: 'MISSING_REFRESH_TOKEN' } satisfies ApiError);
    return;
  }

  try {
    const result = await rotateRefreshToken(pool, presented);
    if (!result.ok) {
      await recordAudit(pool, req, {
        action: 'auth.token_refresh_failed',
        address: result.address ?? null,
        details: { reason: result.reason },
      });
      if (result.reason === 'reused') {
        // Defence in depth: a reused refresh token means leakage. The whole
        // family is already revoked inside rotateRefreshToken; also clear cookies.
        clearAuthCookies(res);
        res.status(401).json({ error: 'Refresh token reuse detected; all sessions revoked', code: 'TOKEN_REUSE' } satisfies ApiError);
        return;
      }
      res.status(401).json({ error: 'Invalid or expired refresh token', code: 'INVALID_REFRESH_TOKEN' } satisfies ApiError);
      return;
    }

    const access = signAccessToken({ sub: result.primary_address, addr: result.address });
    const nowSec = Math.floor(Date.now() / 1000);
    setAuthCookies(
      res,
      access.token,
      Math.max(1, access.expires_at - nowSec),
      result.token,
      Math.max(1, result.expires_at - nowSec),
    );

    await recordAudit(pool, req, {
      action: 'auth.token_refresh',
      address: result.address,
      entityId: result.primary_address,
    });

    res.json({
      primary_address: result.primary_address,
      address: result.address,
      token: access.token,
      expires_at: access.expires_at,
      refresh_token: result.token,
      refresh_expires_at: result.expires_at,
    });
  } catch (err) {
    console.error('POST /api/auth/refresh error:', err);
    res.status(500).json({ error: 'Internal server error', code: 'INTERNAL_ERROR' } satisfies ApiError);
  }
});

// ─── Revoke (logout) ──────────────────────────────────────────────────────

// POST /api/auth/revoke — revoke the current session ('current', default) or
// every session for the address ('all'). Authenticated.
authRouter.post('/revoke', writeLimiter, requireAuth, async (req: Request, res: Response) => {
  const user = req.user!;
  const { scope } = req.body as { scope?: unknown };
  const mode = scope === 'all' ? 'all' : 'current';

  try {
    if (mode === 'all') {
      await revokeAllForAddress(pool, user.address);
    } else {
      await revokeJti(pool, user.jti, user.address, user.token_exp, 'logout');
      const refresh = readRefreshToken(req);
      if (refresh) await revokeRefreshToken(pool, refresh);
    }

    clearAuthCookies(res);
    await recordAudit(pool, req, {
      action: 'auth.token_revoke',
      address: user.address,
      entityId: user.jti,
      details: { scope: mode },
    });

    res.json({ revoked: true, scope: mode });
  } catch (err) {
    console.error('POST /api/auth/revoke error:', err);
    res.status(500).json({ error: 'Internal server error', code: 'INTERNAL_ERROR' } satisfies ApiError);
  }
});

// ─── Multi-address ──────────────────────────────────────────────────────────

// POST /api/auth/addresses — attach an additional address to the current user.
// Authenticated; the new key must sign the register-style challenge to prove
// ownership. Existing addresses keep working; enables key rotation.
authRouter.post('/addresses', writeLimiter, requireAuth, async (req: Request, res: Response) => {
  const user = req.user!;
  try {
    const result = await attachAddress(
      pool,
      { primaryAddress: user.primary_address, existingAddress: user.address },
      req.body ?? {},
    );
    if ('kind' in result) {
      respondToServiceError(res, result);
      return;
    }

    await recordAudit(pool, req, {
      action: 'auth.address_attach',
      address: result.address,
      entityId: user.primary_address,
    });

    res.status(201).json({
      primary_address: result.primary_address,
      address: result.address,
      registered_at: result.registered_at,
    });
  } catch (err) {
    console.error('POST /api/auth/addresses error:', err);
    res.status(500).json({ error: 'Internal server error', code: 'INTERNAL_ERROR' } satisfies ApiError);
  }
});

// ─── Me ──────────────────────────────────────────────────────────────────

// GET /api/auth/me — return the authenticated user record + their addresses.
authRouter.get('/me', requireAuth, async (req: Request, res: Response) => {
  const user = req.user!;
  try {
    const userRow = await pool.query<{ user_id: string; primary_address: string; reputation: string; created_at: string }>(
      `SELECT user_id, primary_address, reputation, created_at FROM users WHERE primary_address = $1`,
      [user.primary_address],
    );
    const addrRows = await pool.query<{ address: string; registered_at: string; is_revoked: boolean }>(
      `SELECT address, registered_at, is_revoked FROM user_addresses
       WHERE user_primary_address = $1 ORDER BY registered_at ASC`,
      [user.primary_address],
    );
    const current = addrRows.rows.find(r => r.address === user.address);

    // How many passkeys this account has, so the UI can show "already added"
    // instead of always prompting to register one.
    const uid = userRow.rows[0]?.user_id ?? null;
    let passkeyCount = 0;
    if (uid) {
      const pk = await pool.query<{ count: string }>(
        `SELECT COUNT(*) AS count FROM webauthn_credentials WHERE user_id = $1`,
        [uid],
      );
      passkeyCount = parseInt(pk.rows[0]?.count ?? '0', 10);
    }

    res.json({
      user_id: userRow.rows[0]?.user_id ?? null,
      primary_address: user.primary_address,
      address: user.address,
      reputation: userRow.rows[0] ? parseFloat(userRow.rows[0].reputation) : 0,
      created_at: userRow.rows[0] ? parseInt(userRow.rows[0].created_at) : null,
      passkey_count: passkeyCount,
      // Preserved for backward compatibility (describe the current address).
      registered_at: current ? parseInt(current.registered_at) : null,
      is_revoked: current?.is_revoked ?? false,
      // New: all addresses linked to this user (key rotation / multi-device).
      addresses: addrRows.rows.map(r => ({
        address: r.address,
        registered_at: parseInt(r.registered_at),
        is_revoked: r.is_revoked,
      })),
    });
  } catch (err) {
    console.error('GET /api/auth/me error:', err);
    res.status(500).json({ error: 'Internal server error', code: 'INTERNAL_ERROR' } satisfies ApiError);
  }
});

// ─── WebAuthn / passkeys (session-only) ────────────────────────────────────
//
// Passkeys log a user into an EXISTING account (which has >=1 Ed25519 key) and
// authenticate sessions only — they never sign on-chain actions. Registration
// is authenticated (add a passkey to your account); authentication is public and
// usernameless (discoverable credential). The ceremony spans two requests
// correlated by an opaque flow_id; the browser enforces origin/RP binding, so
// this path is phishing-resistant.

async function userIdFor(primaryAddress: string): Promise<string | null> {
  const r = await pool.query<{ user_id: string }>(
    `SELECT user_id FROM users WHERE primary_address = $1`,
    [primaryAddress],
  );
  return r.rows[0]?.user_id ?? null;
}

// POST /api/auth/webauthn/register/options — begin adding a passkey (authed).
authRouter.post('/webauthn/register/options', writeLimiter, requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = await userIdFor(req.user!.primary_address);
    if (!userId) {
      res.status(404).json({ error: 'Account not found', code: 'UNKNOWN_ADDRESS' } satisfies ApiError);
      return;
    }
    const { username } = req.body as { username?: unknown };
    const label = typeof username === 'string' && username.trim() ? username.trim().slice(0, 64) : undefined;
    const { flow_id, options } = await webauthnRegisterOptions(pool, userId, label);
    res.json({ flow_id, options });
  } catch (err) {
    console.error('POST /api/auth/webauthn/register/options error:', err);
    res.status(500).json({ error: 'Internal server error', code: 'INTERNAL_ERROR' } satisfies ApiError);
  }
});

// POST /api/auth/webauthn/register/verify — finish adding a passkey (authed).
authRouter.post('/webauthn/register/verify', writeLimiter, requireAuth, async (req: Request, res: Response) => {
  const { flow_id, response, label } = req.body as { flow_id?: string; response?: RegistrationResponseJSON; label?: string };
  if (!flow_id || !response) {
    res.status(400).json({ error: 'flow_id and response are required', code: 'INVALID_INPUT' } satisfies ApiError);
    return;
  }
  try {
    const userId = await userIdFor(req.user!.primary_address);
    if (!userId) {
      res.status(404).json({ error: 'Account not found', code: 'UNKNOWN_ADDRESS' } satisfies ApiError);
      return;
    }
    const result = await webauthnRegisterVerify(pool, userId, { flow_id, response, ...(label ? { label } : {}) });
    if ('kind' in result) {
      res.status(400).json({ error: 'Passkey registration failed', code: 'WEBAUTHN_FAILED' } satisfies ApiError);
      return;
    }
    await recordAudit(pool, req, { action: 'auth.address_attach', address: req.user!.address, entityId: result.credential_id });
    res.status(201).json({ registered: true, credential_id: result.credential_id });
  } catch (err) {
    console.error('POST /api/auth/webauthn/register/verify error:', err);
    res.status(500).json({ error: 'Internal server error', code: 'INTERNAL_ERROR' } satisfies ApiError);
  }
});

// POST /api/auth/webauthn/authenticate/options — begin passkey login (public).
authRouter.post('/webauthn/authenticate/options', challengeLimiter, async (_req: Request, res: Response) => {
  try {
    const { flow_id, options } = await webauthnAuthOptions(pool);
    res.json({ flow_id, options });
  } catch (err) {
    console.error('POST /api/auth/webauthn/authenticate/options error:', err);
    res.status(500).json({ error: 'Internal server error', code: 'INTERNAL_ERROR' } satisfies ApiError);
  }
});

// POST /api/auth/webauthn/authenticate/verify — finish passkey login (public).
authRouter.post('/webauthn/authenticate/verify', writeLimiter, async (req: Request, res: Response) => {
  const { flow_id, response } = req.body as { flow_id?: string; response?: AuthenticationResponseJSON };
  if (!flow_id || !response) {
    res.status(400).json({ error: 'flow_id and response are required', code: 'INVALID_INPUT' } satisfies ApiError);
    return;
  }
  try {
    const result = await webauthnAuthVerify(pool, { flow_id, response });
    if ('kind' in result) {
      await recordAudit(pool, req, { action: 'auth.login_failed', address: null, details: { method: 'webauthn', reason: result.kind } });
      res.status(401).json({ error: 'Authentication failed', code: 'AUTH_FAILED' } satisfies ApiError);
      return;
    }
    // Session "acts as" the account's primary signing key.
    const session = await issueSession(res, { primary_address: result.primary_address, address: result.primary_address });
    await recordAudit(pool, req, { action: 'auth.login', address: result.primary_address, entityId: result.user_id, details: { method: 'webauthn' } });
    res.json({ primary_address: result.primary_address, address: result.primary_address, ...session });
  } catch (err) {
    console.error('POST /api/auth/webauthn/authenticate/verify error:', err);
    res.status(500).json({ error: 'Internal server error', code: 'INTERNAL_ERROR' } satisfies ApiError);
  }
});

// ─── helpers ─────────────────────────────────────────────────────────────

function respondToServiceError(
  res: Response,
  err: { kind: string; message?: string },
): void {
  switch (err.kind) {
    case 'validation':
      res.status(400).json({ error: err.message ?? 'Invalid input', code: 'INVALID_INPUT' } satisfies ApiError);
      return;
    case 'address_mismatch':
      res.status(400).json({ error: 'address does not match SHA256(public_key)', code: 'ADDRESS_MISMATCH' } satisfies ApiError);
      return;
    case 'bad_signature':
      res.status(401).json({ error: 'Signature verification failed', code: 'BAD_SIGNATURE' } satisfies ApiError);
      return;
    case 'pow':
      res.status(400).json({ error: 'Proof-of-work missing or invalid', code: 'POW_INVALID' } satisfies ApiError);
      return;
    case 'challenge':
      res.status(401).json({ error: 'Challenge invalid, expired, or already used', code: 'BAD_CHALLENGE' } satisfies ApiError);
      return;
    case 'already_registered':
      res.status(409).json({ error: 'Address or public key already registered', code: 'ALREADY_REGISTERED' } satisfies ApiError);
      return;
    case 'unknown_address':
      res.status(404).json({ error: 'Address not registered', code: 'UNKNOWN_ADDRESS' } satisfies ApiError);
      return;
    case 'address_revoked':
      res.status(403).json({ error: 'Address has been revoked', code: 'ADDRESS_REVOKED' } satisfies ApiError);
      return;
    default:
      res.status(500).json({ error: 'Internal server error', code: 'INTERNAL_ERROR' } satisfies ApiError);
  }
}
