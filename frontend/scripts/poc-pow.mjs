// Shared auth proof-of-work solver for the e2e scripts. Mirrors
// backend/src/auth/pow.ts: SHA-256("poc-pow-v1:<challenge>:<nonce>") with at
// least `bits` leading zero bits.
import { sha256 } from '@noble/hashes/sha256';
import { utf8ToBytes } from '@noble/hashes/utils';

function leadingZeroBits(d) {
  let bits = 0;
  for (const byte of d) {
    if (byte === 0) { bits += 8; continue; }
    bits += Math.clz32(byte) - 24;
    break;
  }
  return bits;
}

export function solvePow(challenge, bits) {
  if (!bits || bits <= 0) return '0';
  for (let n = 0; ; n++) {
    if (leadingZeroBits(sha256(utf8ToBytes(`poc-pow-v1:${challenge}:${n}`))) >= bits) return String(n);
  }
}
