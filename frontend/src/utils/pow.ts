import { sha256 } from '@noble/hashes/sha256';
import { utf8ToBytes } from '@noble/hashes/utils';

// Client side of the auth anti-spam proof-of-work. Must match the server
// (backend/src/auth/pow.ts): SHA-256("poc-pow-v1:<challenge>:<nonce>") with at
// least `bits` leading zero bits. Trivial at the default difficulty.

function leadingZeroBits(d: Uint8Array): number {
  let bits = 0;
  for (const byte of d) {
    if (byte === 0) { bits += 8; continue; }
    bits += Math.clz32(byte) - 24; // leading zeros within this byte (0..7)
    break;
  }
  return bits;
}

/** Find a nonce whose digest has >= `bits` leading zero bits. Returns it as a string. */
export function solveAuthPow(challenge: string, bits: number): string {
  if (!bits || bits <= 0) return '0';
  for (let n = 0; ; n++) {
    const digest = sha256(utf8ToBytes(`poc-pow-v1:${challenge}:${n}`));
    if (leadingZeroBits(digest) >= bits) return String(n);
  }
}
