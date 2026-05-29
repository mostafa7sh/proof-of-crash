// Domain-separated message construction for auth signatures.
//
// Why domain separation? A signature is only meaningful relative to what was
// signed. If the registration message and login message had the same shape,
// a captured login signature could be replayed as a registration on a fresh
// account, and vice versa. The "poc-register-v1" / "poc-login-v1" prefixes
// bind each signature to a specific protocol step. The version suffix lets us
// rotate the format in the future without ambiguity.
//
// The challenge (server-issued 32-byte random nonce) provides freshness;
// the prefix provides domain separation; together they pin the signature to
// (this server, this purpose, this session).

const HEX_64 = /^[0-9a-f]{64}$/;

export type Purpose = 'register' | 'login';

export function buildSignedMessage(
  purpose: Purpose,
  challenge: string,
  address: string,
  publicKey?: string,
): Buffer {
  if (!HEX_64.test(challenge)) {
    throw new Error('challenge must be 64 hex chars');
  }
  if (!HEX_64.test(address)) {
    throw new Error('address must be 64 hex chars');
  }

  const parts =
    purpose === 'register'
      ? [
          'poc-register-v1',
          challenge,
          address,
          (() => {
            if (!publicKey || !HEX_64.test(publicKey)) {
              throw new Error('public_key must be 64 hex chars for registration');
            }
            return publicKey;
          })(),
        ]
      : ['poc-login-v1', challenge, address];

  return Buffer.from(parts.join(':'), 'utf8');
}
