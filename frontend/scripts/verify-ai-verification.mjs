// End-to-end proof of the advisory AI model review + "AI Verified" badge.
//
// Flow (two phases so the two proofs land in different blocks):
//   Phase 1 — a BUGGY app (reads stdin + strcpy) → proof → consensus → block.
//     assert: all 3 models approved, proof ai_verified, its block ai_verified.
//   Phase 2 — a CLEAN app (ignores input) → proof → consensus → block.
//     assert: 0 models approved, proof NOT ai_verified, its block NOT ai_verified,
//     BUT the proof still finalized — AI review is ADVISORY and never gates the
//     ledger (human consensus does).
//
// The quorum is dynamic, so the script reads the live required quorum and casts
// a few agreeing votes beyond it. It bypasses the auth rate limiter with the
// seed token (real clients never have it).
//
// Point BASE at a running stack with a short miner cadence, e.g.:
//   BLOCK_INTERVAL_MS=4000 AUTH_RATE_MAX=100000 AUTH_CHALLENGE_RATE_MAX=100000 \
//     docker compose up --build -d
//   BASE=http://localhost:3011 node scripts/verify-ai-verification.mjs
import { webcrypto } from 'node:crypto';
if (!globalThis.crypto) globalThis.crypto = webcrypto;

import * as ed from '@noble/ed25519';
import { sha256 } from '@noble/hashes/sha256';
import { sha512 } from '@noble/hashes/sha512';
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils';
import { solvePow } from './poc-pow.mjs';
ed.etc.sha512Sync = (...m) => sha512(ed.etc.concatBytes(...m));

const BASE = process.env.BASE ?? 'http://localhost:3011';
const SEED_TOKEN = process.env.SEED_TOKEN ?? 'poc-seed-secret-2026';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function req(method, path, body, token) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'x-seed-token': SEED_TOKEN, // skip auth rate limits (dev-only)
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}
function makeWallet() {
  const priv = ed.utils.randomPrivateKey();
  const publicKey = bytesToHex(ed.getPublicKey(priv));
  return { priv, publicKey, address: bytesToHex(sha256(hexToBytes(publicKey))) };
}
async function register(w) {
  const { data: c } = await req('POST', '/api/auth/challenge', { address: w.address });
  const sig = bytesToHex(ed.sign(utf8ToBytes(['poc-register-v1', c.challenge, w.address, w.publicKey].join(':')), w.priv));
  const r = await req('POST', '/api/auth/register', { public_key: w.publicKey, address: w.address, challenge: c.challenge, signature: sig, pow_nonce: solvePow(c.challenge, c.pow_difficulty) });
  w.token = r.data.token;
  return r.status === 201;
}
async function vote(v, proofId, score) {
  const signedAt = Math.floor(Date.now() / 1000);
  const digest = bytesToHex(sha256(utf8ToBytes(`poc-vote-v1:${proofId}:${score}:${signedAt}`)));
  const signature = bytesToHex(ed.sign(hexToBytes(digest), v.priv));
  return req('POST', '/api/verifications', { proof_id: proofId, score, signature, signed_at: signedAt, crashed: true }, v.token);
}
async function findBlockWithProof(proofId) {
  const list = (await req('GET', '/api/ledger?page=1&page_size=60')).data.data ?? [];
  for (const b of list) {
    const full = (await req('GET', `/api/ledger/${b.block_hash}`)).data;
    if ((full.proofs ?? []).some((p) => p.proof_id === proofId)) return full;
  }
  return null;
}
async function waitFinalized(proofId, tries = 40) {
  for (let i = 0; i < tries; i++) {
    const p = (await req('GET', `/api/proofs/${proofId}`)).data;
    if (p.status === 'finalized') return p;
    process.stdout.write('.');
    await sleep(3000);
  }
  return (await req('GET', `/api/proofs/${proofId}`)).data;
}

let failed = false;
const check = (label, ok, extra = '') => { console.log(`  ${ok ? '✓' : '✗'} ${label}${extra ? ' — ' + extra : ''}`); if (!ok) failed = true; };

const BUGGY_SRC = '#include <stdio.h>\n#include <string.h>\nint main(){char b[16];char s[256];fgets(s,sizeof s,stdin);strcpy(b,s);/* overflow */return b[0];}';
const CLEAN_SRC = '#include <stdio.h>\nint main(){/* ignores all input, does nothing risky */return 0;}';

console.log('1. Register developer, researcher, and a validator pool…');
const dev = makeWallet();
const researcher = makeWallet();
const validators = Array.from({ length: 12 }, makeWallet);
await register(dev); await register(researcher);
for (const v of validators) await register(v);
check('all wallets registered', [dev, researcher, ...validators].every((w) => w.token));

async function driveToConsensus(proofId) {
  const quorum = (await req('GET', `/api/verifications/${proofId}`)).data.min_verifications;
  const n = Math.min(validators.length, quorum + 2); // a couple beyond quorum for safety
  let last = null;
  for (let i = 0; i < n; i++) last = await vote(validators[i], proofId, 7.0 + (i % 3) * 0.1);
  return { quorum, consensus: last?.data.consensus_reached === true };
}

// ── Phase 1: buggy app → AI Verified ──────────────────────────────────────
console.log('\n2. BUGGY app → proof → consensus…');
const appB = await req('POST', '/api/apps', { name: 'ai-buggy', language: 'c', source_code: BUGGY_SRC }, dev.token);
const proofB = await req('POST', '/api/proofs', { app_id: appB.data.app_id, crash_input: '4141414141414141414141414141414141414141', input_format: 'stdin' }, researcher.token);
check('buggy app + proof created', appB.status === 201 && proofB.status === 201, `${appB.status}/${proofB.status}`);
const idB = proofB.data.proof_id;
const c1 = await driveToConsensus(idB);
check('buggy proof reached consensus', c1.consensus, `quorum=${c1.quorum}`);

console.log('3. Wait for the miner to finalize the buggy proof…');
process.stdout.write('   ');
await waitFinalized(idB);
process.stdout.write('\n');

const aiB = (await req('GET', `/api/proofs/${idB}/ai-verifications`)).data;
check('buggy proof reviewed by 3 models', (aiB.data?.length ?? 0) === 3, `models=${aiB.data?.map((v) => v.model).join(',')}`);
check('all 3 models approved the buggy proof', aiB.approved_count === aiB.required && aiB.ai_verified === true,
  `approved=${aiB.approved_count}/${aiB.required} verified=${aiB.ai_verified}`);
const blockB = await findBlockWithProof(idB);
check('buggy proof’s block is AI Verified', !!blockB && blockB.ai_verified === true, blockB ? `block #${blockB.block_number} ai_verified=${blockB.ai_verified}` : 'block not found');

// ── Phase 2: clean app → NOT verified, but still finalized (advisory) ──────
console.log('\n4. CLEAN app → proof → consensus…');
const appC = await req('POST', '/api/apps', { name: 'ai-clean', language: 'c', source_code: CLEAN_SRC }, dev.token);
const proofC = await req('POST', '/api/proofs', { app_id: appC.data.app_id, crash_input: '00', input_format: 'stdin' }, researcher.token);
check('clean app + proof created', appC.status === 201 && proofC.status === 201, `${appC.status}/${proofC.status}`);
const idC = proofC.data.proof_id;
const c2 = await driveToConsensus(idC);
check('clean proof reached human consensus', c2.consensus, `quorum=${c2.quorum}`);

console.log('5. Wait for the miner to finalize the clean proof…');
process.stdout.write('   ');
const finalC = await waitFinalized(idC);
process.stdout.write('\n');

check('clean proof still finalized (AI is advisory, never a gate)', finalC.status === 'finalized', `status=${finalC.status}`);
const aiC = (await req('GET', `/api/proofs/${idC}/ai-verifications`)).data;
check('clean proof reviewed by 3 models', (aiC.data?.length ?? 0) === 3, `models=${aiC.data?.map((v) => v.model).join(',')}`);
check('clean proof did NOT reach AI approval', aiC.ai_verified === false && aiC.approved_count < aiC.required,
  `approved=${aiC.approved_count}/${aiC.required} verified=${aiC.ai_verified}`);
const blockC = await findBlockWithProof(idC);
check('clean proof’s block is NOT AI Verified', !!blockC && blockC.ai_verified === false, blockC ? `block #${blockC.block_number} ai_verified=${blockC.ai_verified}` : 'block not found');

console.log(failed ? '\nAI-VERIFICATION CHECK FAILED' : '\nALL AI-VERIFICATION CHECKS PASSED');
process.exit(failed ? 1 : 0);
