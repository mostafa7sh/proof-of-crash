// End-to-end checks for the hardened auth/account model. Point BASE at the
// nginx proxy of a running stack (e.g. http://localhost:3012).
//
// Covers: user_id anchor, generic AUTH_FAILED (no enumeration), single-use
// challenges (replay), two-signature step-up key attach, ACCOUNT-level
// anti-collusion (self-proof / self-verify across a multi-key account), and
// WebAuthn endpoint wiring.
import { webcrypto } from 'node:crypto';
if (!globalThis.crypto) globalThis.crypto = webcrypto;

import * as ed from '@noble/ed25519';
import { sha256 } from '@noble/hashes/sha256';
import { sha512 } from '@noble/hashes/sha512';
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils';
import { solvePow } from './poc-pow.mjs';
ed.etc.sha512Sync = (...m) => sha512(ed.etc.concatBytes(...m));

const BASE = process.env.BASE ?? 'http://localhost:3012';

async function req(method, path, body, token) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

function makeWallet() {
  const priv = ed.utils.randomPrivateKey();
  const publicKey = bytesToHex(ed.getPublicKey(priv));
  const address = bytesToHex(sha256(hexToBytes(publicKey)));
  return { priv, publicKey, address };
}
const signMsg = (w, msg) => bytesToHex(ed.sign(utf8ToBytes(msg), w.priv));

// Returns the full challenge response: { challenge, expires_at, pow_difficulty }.
async function challenge(address) {
  return (await req('POST', '/api/auth/challenge', { address })).data;
}
async function register(w) {
  const c = await challenge(w.address);
  const signature = signMsg(w, ['poc-register-v1', c.challenge, w.address, w.publicKey].join(':'));
  const r = await req('POST', '/api/auth/register', { public_key: w.publicKey, address: w.address, challenge: c.challenge, signature, pow_nonce: solvePow(c.challenge, c.pow_difficulty) });
  w.token = r.data.token;
  return r;
}
async function login(w) {
  const c = await challenge(w.address);
  const signature = signMsg(w, ['poc-login-v1', c.challenge, w.address].join(':'));
  const r = await req('POST', '/api/auth/login', { address: w.address, challenge: c.challenge, signature, pow_nonce: solvePow(c.challenge, c.pow_difficulty) });
  w.token = r.data.token;
  return r;
}
// Attach newKey to the account whose session is `sessionWallet` (an existing
// active key) and whose account primary is `primaryAddress`.
async function attach(sessionWallet, primaryAddress, newKey, { breakExisting = false } = {}) {
  const c = await challenge(newKey.address);
  const signature = signMsg(newKey, ['poc-register-v1', c.challenge, newKey.address, newKey.publicKey].join(':'));
  const attackerOrSelf = breakExisting ? makeWallet() : sessionWallet; // wrong signer → must fail
  const existing_signature = signMsg(attackerOrSelf, ['poc-attach-v1', c.challenge, primaryAddress, newKey.address].join(':'));
  return req('POST', '/api/auth/addresses',
    { public_key: newKey.publicKey, address: newKey.address, challenge: c.challenge, signature, existing_signature }, sessionWallet.token);
}
async function vote(validator, proofId, score) {
  const signedAt = Math.floor(Date.now() / 1000);
  const digest = bytesToHex(sha256(utf8ToBytes(`poc-vote-v1:${proofId}:${score}:${signedAt}`)));
  const signature = bytesToHex(ed.sign(hexToBytes(digest), validator.priv));
  return req('POST', '/api/verifications', { proof_id: proofId, score, signature, signed_at: signedAt, crashed: true }, validator.token);
}

let failed = false;
const check = (label, ok, extra = '') => { console.log(`  ${ok ? '✓' : '✗'} ${label}${extra ? ' — ' + extra : ''}`); if (!ok) failed = true; };

console.log('1. Register + /me carries a stable user_id…');
const a1 = makeWallet();                     // account 1, primary key A
const r1 = await register(a1);
check('register issues a session', r1.status === 201 && !!a1.token);
const me = await req('GET', '/api/auth/me', null, a1.token);
check('/me returns a user_id', me.status === 200 && typeof me.data.user_id === 'string' && me.data.user_id.length > 0, me.data.user_id);

console.log('2. Proof-of-work is required, and login failures are generic…');
const ghost = makeWallet();
const cg = await challenge(ghost.address);
// Missing PoW is rejected before the signature is even checked.
const noPow = await req('POST', '/api/auth/login', { address: ghost.address, challenge: cg.challenge, signature: '00'.repeat(64) });
check('login without proof-of-work → 400 POW_INVALID', noPow.status === 400 && noPow.data.code === 'POW_INVALID', `${noPow.status} ${noPow.data.code} (difficulty=${cg.pow_difficulty})`);
// With valid PoW: unknown address and bad signature both collapse to AUTH_FAILED.
const cg2 = await challenge(ghost.address);
const unknown = await req('POST', '/api/auth/login', { address: ghost.address, challenge: cg2.challenge, signature: '00'.repeat(64), pow_nonce: solvePow(cg2.challenge, cg2.pow_difficulty) });
check('unknown address (with PoW) → 401 AUTH_FAILED', unknown.status === 401 && unknown.data.code === 'AUTH_FAILED', `${unknown.status} ${unknown.data.code}`);
const cb = await challenge(a1.address);
const badSig = await req('POST', '/api/auth/login', { address: a1.address, challenge: cb.challenge, signature: '11'.repeat(64), pow_nonce: solvePow(cb.challenge, cb.pow_difficulty) });
check('bad signature → same generic AUTH_FAILED', badSig.status === 401 && badSig.data.code === 'AUTH_FAILED', `${badSig.status} ${badSig.data.code}`);

console.log('3. Challenges are single-use (replay rejected)…');
const c2 = await challenge(a1.address);
const sig2 = signMsg(a1, ['poc-login-v1', c2.challenge, a1.address].join(':'));
const pow2 = solvePow(c2.challenge, c2.pow_difficulty);
const first = await req('POST', '/api/auth/login', { address: a1.address, challenge: c2.challenge, signature: sig2, pow_nonce: pow2 });
const replay = await req('POST', '/api/auth/login', { address: a1.address, challenge: c2.challenge, signature: sig2, pow_nonce: pow2 });
check('first use succeeds', first.status === 200);
check('replay of same challenge fails', replay.status !== 200, `status=${replay.status}`);

console.log('4. Key attach needs BOTH signatures (step-up)…');
await login(a1); // refresh token
const keyB = makeWallet();
const badAttach = await attach(a1, a1.address, keyB, { breakExisting: true });
check('attach with wrong existing signature → rejected', badAttach.status !== 201, `status=${badAttach.status}`);
const goodAttach = await attach(a1, a1.address, keyB);
check('attach with both valid signatures → 201', goodAttach.status === 201, `status=${goodAttach.status}`);

console.log('5. ACCOUNT-level self-proof (multi-key) is blocked…');
const app = await req('POST', '/api/apps', { name: 'acct-test', language: 'c', source_code: 'int main(){return 0;}' }, a1.token);
check('account 1 uploaded an app', app.status === 201);
await login(keyB); // session as the SECOND key of account 1
const selfProof = await req('POST', '/api/proofs', { app_id: app.data.app_id, crash_input: '41414141', input_format: 'stdin' }, keyB.token);
check('proof from a sibling key of the author → 403 SELF_PROOF', selfProof.status === 403 && selfProof.data.code === 'SELF_PROOF', `${selfProof.status} ${selfProof.data.code}`);

console.log('6. ACCOUNT-level self-verify (multi-key) is blocked…');
const a2 = makeWallet();                     // account 2, key C
await register(a2);
const keyD = makeWallet();
await attach(a2, a2.address, keyD);          // account 2 second key D
const proof2 = await req('POST', '/api/proofs', { app_id: app.data.app_id, crash_input: '42424242', input_format: 'stdin' }, a2.token);
check('account 2 submitted a proof on account 1 app', proof2.status === 201, `status=${proof2.status}`);
await login(keyD);                            // session as account 2's OTHER key
const selfVote = await vote(keyD, proof2.data.proof_id, 7.0);
check('vote from a sibling key of the submitter → 403 SELF_VERIFICATION', selfVote.status === 403 && selfVote.data.code === 'SELF_VERIFICATION', `${selfVote.status} ${selfVote.data.code}`);
// sanity: a genuinely different account CAN vote
const a3 = makeWallet(); await register(a3);
const okVote = await vote(a3, proof2.data.proof_id, 7.0);
check('vote from an unrelated account → accepted', okVote.status === 201, `status=${okVote.status}`);

console.log('7. WebAuthn endpoints are wired (full ceremony needs a real authenticator)…');
const waOpts = await req('POST', '/api/auth/webauthn/authenticate/options');
check('passkey auth options return a challenge', waOpts.status === 200 && !!waOpts.data.flow_id && !!waOpts.data.options?.challenge);
const waGarbage = await req('POST', '/api/auth/webauthn/authenticate/verify', { flow_id: waOpts.data.flow_id, response: { id: 'nope', rawId: 'nope', type: 'public-key', response: {} } });
check('passkey verify with garbage → 401/400', waGarbage.status === 401 || waGarbage.status === 400, `status=${waGarbage.status}`);
const waRegNoAuth = await req('POST', '/api/auth/webauthn/register/options');
check('passkey register requires auth', waRegNoAuth.status === 401, `status=${waRegNoAuth.status}`);

console.log(failed ? '\nACCOUNT SECURITY CHECK FAILED' : '\nALL ACCOUNT SECURITY CHECKS PASSED');
process.exit(failed ? 1 : 0);
