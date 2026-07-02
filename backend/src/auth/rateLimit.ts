import rateLimit, { type RateLimitRequestHandler } from 'express-rate-limit';
import type { Request, Response } from 'express';
import type { ApiError } from '../types';

// Per-IP throttling for auth endpoints. The challenge endpoint gets the
// tightest limit since it writes a row to `auth_challenges` on every call and
// is the easiest way to flood the database. Limits are env-configurable.

function intEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  const n = raw !== undefined ? parseInt(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function makeLimiter(windowMs: number, max: number): RateLimitRequestHandler {
  return rateLimit({
    windowMs,
    max,
    standardHeaders: true,   // RateLimit-* headers
    legacyHeaders: false,
    // The internal data seeder presents a shared secret (SEED_TOKEN) so it can
    // register the demo accounts in one burst. Real clients never have the
    // secret, so their per-IP limits are unaffected. Disabled when unset.
    skip: (req: Request) => {
      const token = process.env['SEED_TOKEN'];
      return !!token && req.get('x-seed-token') === token;
    },
    handler: (_req: Request, res: Response) => {
      res.status(429).json({
        error: 'Too many requests, please slow down',
        code: 'RATE_LIMITED',
      } satisfies ApiError);
    },
  });
}

/**
 * Strict limiter for POST /api/auth/challenge — prevents `auth_challenges`
 * flooding. Defaults: 10 requests / 60s per IP.
 */
export function challengeRateLimiter(): RateLimitRequestHandler {
  return makeLimiter(
    intEnv('AUTH_CHALLENGE_RATE_WINDOW_MS', 60_000),
    intEnv('AUTH_CHALLENGE_RATE_MAX', 10),
  );
}

/**
 * General limiter for the other write auth endpoints (register, login, refresh,
 * revoke, addresses). Defaults: 20 requests / 60s per IP.
 */
export function authWriteRateLimiter(): RateLimitRequestHandler {
  return makeLimiter(
    intEnv('AUTH_RATE_WINDOW_MS', 60_000),
    intEnv('AUTH_RATE_MAX', 20),
  );
}
