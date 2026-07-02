import { createHash } from 'crypto';

// ─── Lightweight proof-of-work (anti-spam) ───────────────────────────────────
//
// Before an Ed25519 register/login is processed, the client must find a nonce
// such that SHA-256("poc-pow-v1:<challenge>:<nonce>") has at least POW_BITS
// leading zero bits. This is trivial for a human (a few ms at the default
// difficulty) but multiplies the cost of automated abuse / brute-force account
// creation, since each attempt needs a fresh, rate-limited challenge first.
//
// The difficulty is a server constant returned with the challenge; it is NOT a
// consensus primitive, so a plain Node SHA-256 (not the C++ engine) is used.

function intEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  const n = raw !== undefined ? parseInt(raw) : NaN;
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

// Default 16 bits ≈ 65k hashes average (~tens of ms in a browser). 0 disables.
export const POW_BITS = intEnv('AUTH_POW_BITS', 16);

function leadingZeroBits(digest: Buffer): number {
  let bits = 0;
  for (const byte of digest) {
    if (byte === 0) { bits += 8; continue; }
    bits += Math.clz32(byte) - 24; // leading zeros within this byte (0..7)
    break;
  }
  return bits;
}

export function powDifficultyFor(_challenge: string): number {
  return POW_BITS;
}

/** Verify a PoW solution. `bits <= 0` means PoW is disabled (always valid). */
export function verifyPow(challenge: string, nonce: unknown, bits: number = POW_BITS): boolean {
  if (bits <= 0) return true;
  if (typeof nonce !== 'string' && typeof nonce !== 'number') return false;
  const digest = createHash('sha256').update(`poc-pow-v1:${challenge}:${nonce}`).digest();
  return leadingZeroBits(digest) >= bits;
}
