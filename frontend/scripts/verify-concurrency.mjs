// Concurrent multi-user system test. Point BASE at the nginx proxy of a running
// stack; run with a short miner cadence + raised auth limits, e.g.:
//   BLOCK_INTERVAL_MS=4000 AUTH_RATE_MAX=100000 AUTH_CHALLENGE_RATE_MAX=100000 \
//     docker compose up --build -d
//   BASE=http://localhost:3012 node scripts/verify-concurrency.mjs
//
// Simulates N users interacting CONCURRENTLY (parallel registration, proof
// submission, voting, and transfers) and then validates ledger consistency:
// chain validity, per-user balance == sum(unspent UTXOs), and global supply
// conservation (sum of all balances == total minted).
import { webcrypto } from 'node:crypto';
if (!globalThis.crypto) globalThis.crypto = webcrypto;

import * as ed from '@noble/ed25519';
import { sha256 } from '@noble/hashes/sha256';
import { sha512 } from '@noble/hashes/sha512';
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils';
import { solvePow } from './poc-pow.mjs';
ed.etc.sha512Sync = (...m) => sha512(ed.etc.concatBytes(...m));

const BASE = process.env.BASE ?? 'http://localhost:3012';
const N = parseInt(process.env.USERS ?? '5');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const round8 = (n) => Math.round(n * 1e8) / 1e8;

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
const balance = async (a) => (await req('GET', `/api/ledger/balance/${a}`)).data.balance ?? 0;
const utxoSum = async (a) => ((await req('GET', `/api/ledger/utxos/${a}`)).data.utxos ?? []).reduce((s, u) => s + u.amount, 0);
const supply = async () => (await req('GET', '/api/ledger/supply')).data.total_supply ?? 0;

const u16 = (n) => new Uint8Array([(n >> 8) & 0xff, n & 0xff]);
const concat = (ps) => { const t = ps.reduce((n, p) => n + p.length, 0); const o = new Uint8Array(t); let off = 0; for (const p of ps) { o.set(p, off); off += p.length; } return o; };
const sstr = (s) => { const b = utf8ToBytes(s); return concat([u16(b.length), b]); };
const samt = (a) => { let u = BigInt(Math.round(a * 1e8)); const b = new Uint8Array(8); for (let i = 7; i >= 0; i--) { b[i] = Number(u & 0xffn); u >>= 8n; } return b; };
function txId(inputs, outputs) {
  const parts = [sstr('transfer'), u16(inputs.length)];
  for (const i of inputs) { parts.push(sstr(i.prev_tx_id)); parts.push(u16(i.output_index)); }
  parts.push(u16(outputs.length));
  for (const o of outputs) { parts.push(sstr(o.address)); parts.push(samt(o.amount)); }
  return bytesToHex(sha256(concat(parts)));
}
async function transfer(from, toAddr, amount) {
  const { data } = await req('GET', `/api/ledger/utxos/${from.address}`);
  const utxos = [...(data.utxos ?? [])].sort((a, b) => b.amount - a.amount);
  const chosen = []; let total = 0;
  for (const u of utxos) { chosen.push(u); total += u.amount; if (total >= amount) break; }
  if (total < amount) return { status: 0, data: { error: 'insufficient' } };
  const outputs = [{ address: toAddr, amount }];
  const change = round8(total - amount);
  if (change > 0) outputs.push({ address: from.address, amount: change });
  const refs = chosen.map((u) => ({ prev_tx_id: u.tx_id, output_index: u.output_index }));
  const signature = bytesToHex(ed.sign(hexToBytes(txId(refs, outputs)), from.priv));
  return req('POST', '/api/ledger/transfer', { inputs: refs.map((r) => ({ ...r, signature })), outputs }, from.token);
}
async function waitForTip(targetHeight, label, maxMs = 90000) {
  const end = Date.now() + maxMs;
  while (Date.now() < end) {
    const h = (await req('GET', '/api/ledger/supply')).data?.tip?.height ?? 0;
    if (h >= targetHeight) return h;
    process.stdout.write('.');
    await sleep(2000);
  }
  console.log(` (timed out waiting for ${label})`);
  return -1;
}

let failed = false;
const check = (label, ok, extra = '') => { console.log(`  ${ok ? '✓' : '✗'} ${label}${extra ? ' — ' + extra : ''}`); if (!ok) failed = true; };

console.log(`1. Concurrently register ${N} users…`);
const users = Array.from({ length: N }, makeWallet);
const regResults = await Promise.all(users.map(register));   // parallel
check('all concurrent registrations succeeded', regResults.every(Boolean), regResults.filter(Boolean).length + '/' + N);
// Ledger may already hold supply from earlier runs — measure THIS run's delta.
const supplyBefore = await supply();

console.log('2. Concurrently upload one app per user…');
const apps = await Promise.all(users.map((u) => req('POST', '/api/apps', { name: `c-${u.address.slice(0, 6)}`, language: 'c', source_code: `int main(){return ${Math.floor(Math.random() * 9)};}` }, u.token)));
check('all apps created', apps.every((a) => a.status === 201));

console.log('3. Concurrently submit proofs (user i → app of user i+1)…');
const proofs = await Promise.all(users.map((u, i) =>
  req('POST', '/api/proofs', { app_id: apps[(i + 1) % N].data.app_id, crash_input: bytesToHex(utf8ToBytes(`crash-${i}`)), input_format: 'stdin' }, u.token)));
check('all proofs submitted', proofs.every((p) => p.status === 201), proofs.map((p) => p.status).join(','));

console.log('4. Concurrently vote (each proof: everyone except its submitter and the app dev)…');
const startHeight = (await req('GET', '/api/ledger/supply')).data?.tip?.height ?? 0;
const voteJobs = [];
proofs.forEach((p, i) => {
  const submitter = i, dev = (i + 1) % N;
  users.forEach((voter, j) => {
    if (j === submitter || j === dev) return;
    voteJobs.push(vote(voter, p.data.proof_id, 7.0 + (j % 3) * 0.1)); // 7.0–7.2 → consensus
  });
});
const voteResults = await Promise.all(voteJobs);              // parallel burst
check('all concurrent votes accepted (201)', voteResults.every((v) => v.status === 201), `${voteResults.filter((v) => v.status === 201).length}/${voteResults.length}`);

console.log('5. Wait for the miner to finalize the consensus proofs…');
process.stdout.write('   ');
await waitForTip(startHeight + 1, 'reward block');
process.stdout.write('\n');
const supplyAfterRewards = await supply();
const balances = await Promise.all(users.map((u) => balance(u.address)));
const minted = round8(supplyAfterRewards - supplyBefore); // coins minted THIS run
check('rewards minted (supply increased)', minted > 0, `+${minted}`);
check('every user earned some PoC (finder or verifier)', balances.every((b) => b > 0), balances.map(round8).join(','));

console.log('6. Per-user consistency: balance == sum(unspent UTXOs)…');
const sums = await Promise.all(users.map((u) => utxoSum(u.address)));
check('balance matches UTXO sum for every user', users.every((_, i) => round8(balances[i]) === round8(sums[i])));
const totalHeld = round8(sums.reduce((s, x) => s + x, 0));
check('sum of participant balances == coins minted this run (conservation)', totalHeld === minted, `held=${totalHeld} minted=${minted}`);

console.log('7. Concurrent transfer burst (each user → next user)…');
const tipBefore = (await req('GET', '/api/ledger/supply')).data?.tip?.height ?? 0;
const amounts = balances.map((b) => round8(b / 4));
const transferResults = await Promise.all(users.map((u, i) => transfer(u, users[(i + 1) % N].address, amounts[i])));
check('all concurrent transfers accepted', transferResults.every((t) => t.status === 202), transferResults.map((t) => t.status).join(','));
process.stdout.write('   mining transfers');
await waitForTip(tipBefore + 1, 'transfer block');
process.stdout.write('\n');

console.log('8. Post-burst consistency + conservation…');
const balances2 = await Promise.all(users.map((u) => balance(u.address)));
const sums2 = await Promise.all(users.map((u) => utxoSum(u.address)));
check('balance == UTXO sum for every user (post-transfer)', users.every((_, i) => round8(balances2[i]) === round8(sums2[i])));
check('total supply unchanged by transfers', round8(await supply()) === round8(supplyAfterRewards), `${round8(supplyAfterRewards)} → ${round8(await supply())}`);
check('participants still hold exactly what was minted (transfers conserve)', round8(sums2.reduce((s, x) => s + x, 0)) === minted, `held=${round8(sums2.reduce((s, x) => s + x, 0))} minted=${minted}`);

console.log('9. Concurrent reads are consistent + chain is valid…');
const reads = await Promise.all(Array.from({ length: 12 }, () => req('GET', '/api/ledger/supply')));
const heights = new Set(reads.map((r) => r.data?.tip?.height));
const supplies = new Set(reads.map((r) => round8(r.data?.total_supply ?? -1)));
check('12 concurrent supply reads agree on height', heights.size === 1, `heights=${[...heights].join(',')}`);
check('12 concurrent supply reads agree on total', supplies.size === 1, `supplies=${[...supplies].join(',')}`);
const validate = (await req('GET', '/api/ledger/validate')).data;
check('chain validates end to end', validate.valid === true, JSON.stringify(validate));

console.log(failed ? '\nCONCURRENCY CHECK FAILED' : '\nALL CONCURRENCY CHECKS PASSED');
process.exit(failed ? 1 : 0);
