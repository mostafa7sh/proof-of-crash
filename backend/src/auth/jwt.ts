import jwt from 'jsonwebtoken';
import { randomBytes } from 'crypto';

// Lazy-load secrets so dotenv has a chance to populate process.env before the
// first sign/verify call. Reading at module-load time fires before
// dotenv.config() in some import orders.
function getSecret(): string {
  const s = process.env['JWT_SECRET'];
  if (!s || s.length < 32) {
    throw new Error('JWT_SECRET must be set and at least 32 characters');
  }
  return s;
}

// Access tokens are intentionally short-lived; longevity comes from refresh
// tokens. Default 15 minutes (was 24h before the refresh-token system).
function getAccessTtlSeconds(): number {
  return parseInt(process.env['JWT_TTL_SECONDS'] ?? '900');
}

const ISSUER = 'proof-of-crash';

export interface SessionClaims {
  sub: string;   // primary_address
  addr: string;  // logged-in address (may differ from primary if key rotation)
}

export interface VerifiedSession extends SessionClaims {
  jti: string;
  iat: number;
  exp: number;
}

export interface SignedAccessToken {
  token: string;
  jti: string;
  issued_at: number;
  expires_at: number;
}

/**
 * Sign a short-lived access token with a unique jti so individual tokens can
 * be revoked. `signSession` is kept as a backward-compatible alias.
 */
export function signAccessToken(claims: SessionClaims): SignedAccessToken {
  const ttl = getAccessTtlSeconds();
  const jti = randomBytes(16).toString('hex');
  const issued_at = Math.floor(Date.now() / 1000);
  const token = jwt.sign(claims, getSecret(), {
    algorithm: 'HS256',
    expiresIn: ttl,
    issuer: ISSUER,
    jwtid: jti,
  });
  return { token, jti, issued_at, expires_at: issued_at + ttl };
}

/** Backward-compatible alias retained for existing call sites. */
export function signSession(claims: SessionClaims): { token: string; jti: string; expires_at: number } {
  const { token, jti, expires_at } = signAccessToken(claims);
  return { token, jti, expires_at };
}

export function verifySession(token: string): VerifiedSession | null {
  try {
    const payload = jwt.verify(token, getSecret(), {
      algorithms: ['HS256'],
      issuer: ISSUER,
    });
    if (typeof payload === 'string') return null;
    const { sub, addr, jti, iat, exp } = payload as jwt.JwtPayload & Partial<SessionClaims>;
    if (typeof sub !== 'string' || typeof addr !== 'string') return null;
    if (typeof jti !== 'string') return null;
    if (typeof iat !== 'number' || typeof exp !== 'number') return null;
    return { sub, addr, jti, iat, exp };
  } catch {
    return null;
  }
}
