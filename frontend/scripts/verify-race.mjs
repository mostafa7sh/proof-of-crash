// End-to-end proof that bug hunting is a RACE and that the coinbase reward is a
// fixed 1000 PoC split 70/30.
//
// Flow:
//   register dev + 2 researchers + a validator pool
//   ONE app, TWO competing proofs (researcher1 and researcher2)
//   both proofs reach consensus (quorum agreeing votes each)
//   → exactly ONE proof finalizes into a block; the other is archived
//   → the app is closed to new proofs (APP_FINALIZED)
//   → the finalized block mints exactly 1000 PoC: finder 700 + validators 300
//
// The quorum is dynamic (scales with the active community), so this script
// reads the live required quorum from the API and casts exactly that many
// agreeing votes — it never assumes the number is 3.
//
// Point BASE at the nginx proxy of a running stack with a short miner cadence
// and raised auth limits, e.g.:
//   BLOCK_INTERVAL_MS=4000 AUTH_RATE_MAX=100000 AUTH_CHALLENGE_RATE_MAX=100000 \
//     docker compose up --build -d
//   BASE=http://localhost:3011 node scripts/verify-race.mjs
import { webcrypto } from 'node:crypto';
if (!globalThis.crypto) globalThis.crypto = webcrypto;

import * as ed from '@noble/ed25519';
import { sha256 } from '@noble/hashes/sha256';
import { sha512 } from '@noble/hashes/sha512';
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils';
import { solvePow } from './poc-pow.mjs';
ed.etc.sha512Sync = (...m) => sha512(ed.etc.concatBytes(...m));

const BASE = process.env.BASE ?? 'http://localhost:3011';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const round2 = (n) => Math.round(n * 100) / 100;

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

let failed = false;
const check = (label, ok, extra = '') => { console.log(`  ${ok ? '✓' : '✗'} ${label}${extra ? ' — ' + extra : ''}`); if (!ok) failed = true; };

console.log('1. Register developer + 2 researchers + validator pool…');
const dev = makeWallet();
const r1 = makeWallet();
const r2 = makeWallet();
const validators = Array.from({ length: 8 }, makeWallet);
await register(dev); await register(r1); await register(r2);
for (const v of validators) await register(v);
check('all wallets registered', [dev, r1, r2, ...validators].every((w) => w.token));

console.log('2. Upload ONE app; two researchers file competing proofs…');
const app = await req('POST', '/api/apps', { name: 'race-app', language: 'c', source_code: 'int main(){return *(int*)0;}' }, dev.token);
const proofA = await req('POST', '/api/proofs', { app_id: app.data.app_id, crash_input: '41414141', input_format: 'stdin' }, r1.token);
const proofB = await req('POST', '/api/proofs', { app_id: app.data.app_id, crash_input: '42424242', input_format: 'stdin' }, r2.token);
check('app + two competing proofs created', app.status === 201 && proofA.status === 201 && proofB.status === 201);
const idA = proofA.data.proof_id, idB = proofB.data.proof_id;

console.log('3. Discover the live (dynamic) quorum…');
const quorum = (await req('GET', `/api/verifications/${idA}`)).data.min_verifications;
check('quorum reported by the API', Number.isInteger(quorum) && quorum >= 3, `min_verifications=${quorum}`);
check('validator pool covers the quorum', validators.length >= quorum, `pool=${validators.length} quorum=${quorum}`);

console.log(`4. Both proofs reach consensus (${quorum} agreeing votes each)…`);
for (let i = 0; i < quorum; i++) await vote(validators[i], idA, 7.0 + (i % 3) * 0.1);
let last = null;
for (let i = 0; i < quorum; i++) last = await vote(validators[i], idB, 7.0 + (i % 3) * 0.1);
check('competing proofs both reached consensus', last.data.consensus_reached === true, `agree=${last.data.agreeing_count}/${last.data.vote_count}`);

console.log('5. Wait for the miner to settle the race…');
process.stdout.write('   ');
for (let i = 0; i < 20; i++) {
  const a = (await req('GET', `/api/proofs/${idA}`)).data.status;
  const b = (await req('GET', `/api/proofs/${idB}`)).data.status;
  if (a === 'finalized' || b === 'finalized') break;
  process.stdout.write('.');
  await sleep(3000);
}
process.stdout.write('\n');

console.log('6. Exactly one proof wins; the other is archived…');
const aFinal = (await req('GET', `/api/proofs/${idA}`)).data;
const bFinal = (await req('GET', `/api/proofs/${idB}`)).data;
const statuses = [aFinal.status, bFinal.status].sort();
check('one finalized + one archived (race has a single winner)',
  statuses[0] === 'archived' && statuses[1] === 'finalized', `A=${aFinal.status} B=${bFinal.status}`);
check('the loser never entered a block', [aFinal, bFinal].filter((p) => p.status === 'finalized').length === 1);

console.log('7. The application is closed to further proofs…');
const closed = await req('POST', '/api/proofs', { app_id: app.data.app_id, crash_input: '43434343', input_format: 'stdin' }, r1.token);
check('new proof for completed app → 409 APP_FINALIZED', closed.status === 409 && closed.data.code === 'APP_FINALIZED', `${closed.status} ${closed.data.code}`);

console.log('8. The winning block mints a fixed 1000 PoC, split 70/30…');
const winner = aFinal.status === 'finalized' ? aFinal : bFinal;
const winnerId = winner.proof_id;
// Find the block holding the winning proof, then inspect its coinbase outputs.
const blocks = (await req('GET', '/api/ledger?page=1&page_size=25')).data.data ?? [];
let coinbase = null;
for (const b of blocks) {
  const full = (await req('GET', `/api/ledger/${b.block_hash}`)).data;
  const cb = (full.transactions ?? []).find((t) => t.tx_type === 'coinbase' && t.proof_id === winnerId);
  if (cb) { coinbase = cb; break; }
}
check('found the winning proof\'s coinbase on-chain', !!coinbase, coinbase ? `outputs=${coinbase.outputs.length}` : 'not found');
if (coinbase) {
  const finder = coinbase.outputs.filter((o) => o.reason === 'bug_bounty').reduce((s, o) => s + o.amount, 0);
  const validatorsPaid = coinbase.outputs.filter((o) => o.reason === 'verification_reward');
  const valTotal = validatorsPaid.reduce((s, o) => s + o.amount, 0);
  const total = coinbase.outputs.reduce((s, o) => s + o.amount, 0);
  check('finder earns exactly 700 (70%)', round2(finder) === 700, `finder=${round2(finder)}`);
  check('validators collectively earn exactly 300 (30%)', round2(valTotal) === 300, `validators=${round2(valTotal)}`);
  check('total minted is exactly the 1000 block reward', round2(total) === 1000, `total=${round2(total)}`);
  check('every validator received a (non-zero) share', validatorsPaid.length === quorum && validatorsPaid.every((o) => o.amount > 0),
    `paid=${validatorsPaid.length}/${quorum} amounts=${validatorsPaid.map((o) => round2(o.amount)).join(',')}`);
}

console.log(failed ? '\nRACE CHECK FAILED' : '\nALL RACE CHECKS PASSED');
process.exit(failed ? 1 : 0);
