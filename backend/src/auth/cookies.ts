import type { Request, Response } from 'express';

// Optional HttpOnly cookie auth, complementary to Bearer tokens. When enabled,
// successful auth responses also set cookies; the middleware accepts either
// transport. Browsers get XSS-resistant HttpOnly storage; non-browser clients
// keep using the Authorization header and the JSON token fields.

export const ACCESS_COOKIE = 'poc_access';
export const REFRESH_COOKIE = 'poc_refresh';

// Refresh cookie is scoped to the refresh + revoke endpoints so it isn't sent
// on every request.
const REFRESH_COOKIE_PATH = '/api/auth';

export function cookiesEnabled(): boolean {
  return (process.env['AUTH_COOKIE_ENABLED'] ?? 'true').toLowerCase() !== 'false';
}

function cookieSecure(): boolean {
  const explicit = process.env['AUTH_COOKIE_SECURE'];
  if (explicit !== undefined) return explicit.toLowerCase() === 'true';
  // Secure by default in production; relaxed in dev so http://localhost works.
  return process.env['NODE_ENV'] === 'production';
}

function baseOptions() {
  const opts: {
    httpOnly: true;
    secure: boolean;
    sameSite: 'strict';
    domain?: string;
  } = {
    httpOnly: true,
    secure: cookieSecure(),
    sameSite: 'strict',
  };
  const domain = process.env['AUTH_COOKIE_DOMAIN'];
  if (domain) opts.domain = domain;
  return opts;
}

/**
 * Set access + refresh cookies. `accessMaxAgeSec` / `refreshMaxAgeSec` are
 * derived from each token's own expiry so the cookie and token expire together.
 */
export function setAuthCookies(
  res: Response,
  accessToken: string,
  accessMaxAgeSec: number,
  refreshToken: string,
  refreshMaxAgeSec: number,
): void {
  if (!cookiesEnabled()) return;
  const base = baseOptions();
  res.cookie(ACCESS_COOKIE, accessToken, { ...base, maxAge: accessMaxAgeSec * 1000 });
  res.cookie(REFRESH_COOKIE, refreshToken, {
    ...base,
    path: REFRESH_COOKIE_PATH,
    maxAge: refreshMaxAgeSec * 1000,
  });
}

export function clearAuthCookies(res: Response): void {
  const base = baseOptions();
  res.clearCookie(ACCESS_COOKIE, base);
  res.clearCookie(REFRESH_COOKIE, { ...base, path: REFRESH_COOKIE_PATH });
}

/** Read the access token from the Authorization header or the access cookie. */
export function readAccessToken(req: Request): string | null {
  const header = req.header('authorization');
  if (header && header.toLowerCase().startsWith('bearer ')) {
    return header.slice(7).trim();
  }
  const cookies = (req as Request & { cookies?: Record<string, string> }).cookies;
  if (cookies && typeof cookies[ACCESS_COOKIE] === 'string') {
    return cookies[ACCESS_COOKIE];
  }
  return null;
}

/** Read the refresh token from the request body or the refresh cookie. */
export function readRefreshToken(req: Request): string | null {
  const body = req.body as { refresh_token?: unknown } | undefined;
  if (body && typeof body.refresh_token === 'string') return body.refresh_token;
  const cookies = (req as Request & { cookies?: Record<string, string> }).cookies;
  if (cookies && typeof cookies[REFRESH_COOKIE] === 'string') return cookies[REFRESH_COOKIE];
  return null;
}
