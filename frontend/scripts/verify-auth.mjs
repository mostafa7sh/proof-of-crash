// End-to-end check: exercises the SAME wallet logic the SPA uses (generate
// keypair, derive address, challenge-response register + login) against the
// live backend. Validates that client signing matches backend verification.
import { webcrypto } from 'node:crypto';
// Node 18 doesn't expose globalThis.crypto (browsers do); polyfill for this script only.
if (!globalThis.crypto) globalThis.crypto = webcrypto;

import * as ed from '@noble/ed25519';
import { sha256 } from '@noble/hashes/sha256';
import { sha512 } from '@noble/hashes/sha512';
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils';
import { solvePow } from './poc-pow.mjs';

ed.etc.sha512Sync = (...m) => sha512(ed.etc.concatBytes(...m));

const BASE = process.env.BASE ?? 'http://localhost:3000';

async function post(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

const priv = ed.utils.randomPrivateKey();
const publicKey = bytesToHex(ed.getPublicKey(priv));
const address = bytesToHex(sha256(hexToBytes(publicKey)));
const sign = (msg) => bytesToHex(ed.sign(utf8ToBytes(msg), priv));

console.log('address:', address.slice(0, 16) + '…');

// register
let { data: ch } = await post('/api/auth/challenge', { address });
const regSig = sign(['poc-register-v1', ch.challenge, address, publicKey].join(':'));
const reg = await post('/api/auth/register', { public_key: publicKey, address, challenge: ch.challenge, signature: regSig, pow_nonce: solvePow(ch.challenge, ch.pow_difficulty) });
console.log('register:', reg.status, reg.data.token ? 'token issued ✓' : reg.data);

// login
({ data: ch } = await post('/api/auth/challenge', { address }));
const loginSig = sign(['poc-login-v1', ch.challenge, address].join(':'));
const login = await post('/api/auth/login', { address, challenge: ch.challenge, signature: loginSig, pow_nonce: solvePow(ch.challenge, ch.pow_difficulty) });
console.log('login:', login.status, login.data.token ? 'token issued ✓' : login.data);

// authenticated /me
const me = await fetch(`${BASE}/api/auth/me`, { headers: { Authorization: `Bearer ${login.data.token}` } });
const meData = await me.json();
console.log('me:', me.status, meData.address === address ? 'address matches ✓' : meData);

if (reg.status === 201 && login.status === 200 && meData.address === address) {
  console.log('\nALL AUTH CHECKS PASSED');
} else {
  console.error('\nAUTH CHECK FAILED');
  process.exit(1);
}
