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
} from '../auth';
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
    const { challenge, expires_at } = await issueChallenge(pool, addr);
    res.status(201).json({ challenge, expires_at });
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
        details: { reason: result.kind },
      });
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
    const result = await attachAddress(pool, user.primary_address, req.body ?? {});
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
    const userRow = await pool.query<{ primary_address: string; reputation: string; created_at: string }>(
      `SELECT primary_address, reputation, created_at FROM users WHERE primary_address = $1`,
      [user.primary_address],
    );
    const addrRows = await pool.query<{ address: string; registered_at: string; is_revoked: boolean }>(
      `SELECT address, registered_at, is_revoked FROM user_addresses
       WHERE user_primary_address = $1 ORDER BY registered_at ASC`,
      [user.primary_address],
    );
    const current = addrRows.rows.find(r => r.address === user.address);

    res.json({
      primary_address: user.primary_address,
      address: user.address,
      reputation: userRow.rows[0] ? parseFloat(userRow.rows[0].reputation) : 0,
      created_at: userRow.rows[0] ? parseInt(userRow.rows[0].created_at) : null,
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
