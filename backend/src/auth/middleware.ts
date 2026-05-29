import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { pool } from '../config/database';
import { verifySession } from './jwt';
import { isJtiRevoked } from './revocation';
import { readAccessToken } from './cookies';
import type { ApiError } from '../types';

export interface AuthenticatedUser {
  primary_address: string;
  address: string;
  jti: string;
  token_exp: number;  // access-token expiry (Unix seconds), for jti revocation cleanup
}

declare module 'express-serve-static-core' {
  interface Request {
    user?: AuthenticatedUser;
  }
}

/**
 * Authenticate a request. Token is read from the Authorization header OR the
 * HttpOnly access cookie. Beyond signature/expiry, the token is rejected if:
 *   - its address row is missing or `is_revoked` (key compromise / rotation),
 *   - its `iat` precedes the address's `tokens_valid_after` (revoke-all), or
 *   - its `jti` is individually denylisted (revoke-single).
 */
export const requireAuth: RequestHandler = async (req, res, next) => {
  const token = readAccessToken(req);
  if (!token) {
    res.status(401).json({ error: 'Missing authentication token', code: 'UNAUTHENTICATED' } satisfies ApiError);
    return;
  }

  const claims = verifySession(token);
  if (!claims) {
    res.status(401).json({ error: 'Invalid or expired session', code: 'UNAUTHENTICATED' } satisfies ApiError);
    return;
  }

  const result = await pool.query<{ is_revoked: boolean; tokens_valid_after: string }>(
    `SELECT is_revoked, tokens_valid_after FROM user_addresses WHERE address = $1`,
    [claims.addr],
  );
  const row = result.rows[0];
  if (!row || row.is_revoked) {
    res.status(401).json({ error: 'Address is no longer active', code: 'ADDRESS_REVOKED' } satisfies ApiError);
    return;
  }

  // Revoke-all-for-address: any token issued before the cutoff is rejected.
  if (claims.iat < parseInt(row.tokens_valid_after)) {
    res.status(401).json({ error: 'Session has been revoked', code: 'TOKEN_REVOKED' } satisfies ApiError);
    return;
  }

  // Revoke-single: jti denylist.
  if (await isJtiRevoked(pool, claims.jti)) {
    res.status(401).json({ error: 'Session has been revoked', code: 'TOKEN_REVOKED' } satisfies ApiError);
    return;
  }

  req.user = { primary_address: claims.sub, address: claims.addr, jti: claims.jti, token_exp: claims.exp };
  next();
};

/**
 * Restrict an endpoint to operator-controlled addresses listed in env.
 * Empty list = endpoint is unreachable (fails closed). Must be combined with
 * `requireAuth` first.
 */
export const requireAdmin: RequestHandler = (req: Request, res: Response, next: NextFunction) => {
  const raw = process.env['ADMIN_ADDRESSES'] ?? '';
  const admins = new Set(raw.split(',').map(s => s.trim()).filter(Boolean));
  if (!req.user || admins.size === 0 || !admins.has(req.user.address)) {
    res.status(403).json({ error: 'Admin access required', code: 'FORBIDDEN' } satisfies ApiError);
    return;
  }
  next();
};
