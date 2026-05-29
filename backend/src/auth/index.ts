export { issueChallenge, purgeExpiredChallenges } from './challenges';
export { signSession, signAccessToken, verifySession } from './jwt';
export type { SignedAccessToken, VerifiedSession, SessionClaims } from './jwt';
export { requireAuth, requireAdmin } from './middleware';
export type { AuthenticatedUser } from './middleware';
export { registerAddress, loginAddress, attachAddress } from './service';
export { buildSignedMessage } from './messages';

export {
  issueRefreshToken,
  rotateRefreshToken,
  revokeRefreshToken,
  revokeRefreshTokensForAddress,
  purgeExpiredRefreshTokens,
} from './refreshTokens';
export {
  revokeJti,
  isJtiRevoked,
  revokeAllForAddress,
  purgeExpiredRevokedJtis,
} from './revocation';
export { recordAudit } from './audit';
export type { AuthAction } from './audit';
export {
  setAuthCookies,
  clearAuthCookies,
  readAccessToken,
  readRefreshToken,
  cookiesEnabled,
} from './cookies';
export { challengeRateLimiter, authWriteRateLimiter } from './rateLimit';
