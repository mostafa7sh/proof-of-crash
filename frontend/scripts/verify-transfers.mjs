// End-to-end multi-user transaction test. Point BASE at the nginx proxy of a
// running stack (e.g. http://localhost:3012). Runs much faster with a short
// miner cadence: BLOCK_INTERVAL_MS=4000 docker compose up …
//
// Exercises: PoC reward earning (submission → consensus → coinbase), token
// TRANSFERS between users, ledger recording of those transfers, and a
// back-and-forth transaction graph across multiple users — with conservation
// of total supply throughout.
import { webcrypto } from 'node:crypto';
if (!globalThis.crypto) globalThis.crypto = webcrypto;

import * as ed from '@noble/ed25519';
import { sha256 } from '@noble/hashes/sha256';
import { sha512 } from '@noble/hashes/sha512';
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils';
import { solvePow } from './poc-pow.mjs';
ed.etc.sha512Sync = (...m) => sha512(ed.etc.concatBytes(...m));

const BASE = process.env.BASE ?? 'http://localhost:3012';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
const balance = async (addr) => (await req('GET', `/api/ledger/balance/${addr}`)).data.balance ?? 0;
const supply = async () => (await req('GET', '/api/ledger/supply')).data.total_supply ?? 0;
const round8 = (n) => Math.round(n * 1e8) / 1e8;

// ── Transfer construction (must byte-match backend utils/transaction.ts) ──────
const u16 = (n) => new Uint8Array([(n >> 8) & 0xff, n & 0xff]);
function sstr(s) { const b = utf8ToBytes(s); return concat([u16(b.length), b]); }
function samt(a) { let u = BigInt(Math.round(a * 1e8)); const b = new Uint8Array(8); for (let i = 7; i >= 0; i--) { b[i] = Number(u & 0xffn); u >>= 8n; } return b; }
function concat(parts) { const t = parts.reduce((n, p) => n + p.length, 0); const o = new Uint8Array(t); let off = 0; for (const p of parts) { o.set(p, off); off += p.length; } return o; }
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
  if (total < amount) throw new Error(`insufficient: have ${total}, need ${amount}`);
  const outputs = [{ address: toAddr, amount }];
  const change = round8(total - amount);
  if (change > 0) outputs.push({ address: from.address, amount: change });
  const inputRefs = chosen.map((u) => ({ prev_tx_id: u.tx_id, output_index: u.output_index }));
  const id = txId(inputRefs, outputs);
  const signature = bytesToHex(ed.sign(hexToBytes(id), from.priv));
  const inputs = inputRefs.map((r) => ({ ...r, signature }));
  return req('POST', '/api/ledger/transfer', { inputs, outputs }, from.token);
}

// Wait until `addr` balance reaches/exceeds `min` (a transfer/coinbase mined).
async function waitBalance(addr, min, label) {
  for (let i = 0; i < 30; i++) { if ((await balance(addr)) >= min) return true; process.stdout.write('.'); await sleep(2000); }
  console.log(` (timed out waiting for ${label})`);
  return false;
}

let failed = false;
const check = (label, ok, extra = '') => { console.log(`  ${ok ? '✓' : '✗'} ${label}${extra ? ' — ' + extra : ''}`); if (!ok) failed = true; };

console.log('1. Register a developer, a researcher, and 3 validators…');
const dev = makeWallet(), researcher = makeWallet();
const validators = [makeWallet(), makeWallet(), makeWallet()];
for (const w of [dev, researcher, ...validators]) await register(w);
check('all users registered', [dev, researcher, ...validators].every((w) => w.token));

console.log('2. Researcher earns PoC: submit a proof on the dev’s app, validators reach consensus…');
const app = await req('POST', '/api/apps', { name: 'xfer-test', language: 'c', source_code: 'int main(){return 0;}' }, dev.token);
const proof = await req('POST', '/api/proofs', { app_id: app.data.app_id, crash_input: '41414141', input_format: 'stdin' }, researcher.token);
check('proof submitted by researcher', proof.status === 201, `status=${proof.status}`);
await vote(validators[0], proof.data.proof_id, 7.0);
await vote(validators[1], proof.data.proof_id, 7.2);
await vote(validators[2], proof.data.proof_id, 6.8);
process.stdout.write('   mining reward block');
const earned = await waitBalance(researcher.address, 0.000001, 'reward');
process.stdout.write('\n');
const supply0 = await supply();
const rBal = await balance(researcher.address);
const vBals = await Promise.all(validators.map((v) => balance(v.address)));
check('researcher received finder reward (70%)', earned && rBal > 0, `balance=${rBal}`);
check('validators received verifier rewards (30% split)', vBals.every((b) => b > 0), `balances=${vBals.map(round8).join(',')}`);
check('total supply > 0 after minting', supply0 > 0, `supply=${round8(supply0)}`);

console.log('3. Transfer: researcher → validator[0]…');
const v0Before = await balance(validators[0].address);
const sendAmt = round8(rBal / 2);
const t1 = await transfer(researcher, validators[0].address, sendAmt);
check('transfer accepted into mempool', t1.status === 202, `status=${t1.status} ${t1.data.error ?? ''}`);
const memPending = (await req('GET', '/api/ledger/mempool')).data;
check('transfer visible in transfer mempool', (memPending.pending_count ?? 0) >= 1, `pending=${memPending.pending_count}`);
process.stdout.write('   mining transfer block');
await waitBalance(validators[0].address, round8(v0Before + sendAmt), 'transfer in');
process.stdout.write('\n');
const v0After = await balance(validators[0].address);
const rAfter = await balance(researcher.address);
check('recipient balance increased by amount', round8(v0After - v0Before) === sendAmt, `${round8(v0Before)} → ${round8(v0After)}`);
check('sender balance decreased by amount', round8(rBal - rAfter) === sendAmt, `${round8(rBal)} → ${round8(rAfter)}`);
check('transfers conserve total supply (no mint/burn)', round8(await supply()) === round8(supply0), `supply=${round8(await supply())}`);

console.log('4. Ledger records the transfer (block tx with correct output)…');
const ledger = (await req('GET', '/api/ledger')).data;
let foundTransferOutput = false;
for (const b of ledger.data) {
  const bd = (await req('GET', `/api/ledger/${b.block_hash}`)).data;
  for (const tx of bd.transactions ?? []) {
    if (tx.tx_type === 'transfer' && tx.outputs?.some((o) => o.address === validators[0].address && round8(o.amount) === sendAmt)) foundTransferOutput = true;
  }
}
check('a ledger block contains the transfer output to the recipient', foundTransferOutput);

console.log('5. Back-and-forth: validator[0] → researcher (spending what it just received)…');
const backAmt = round8(sendAmt / 2);
const rBefore2 = await balance(researcher.address);
const t2 = await transfer(validators[0], researcher.address, backAmt);
check('return transfer accepted', t2.status === 202, `status=${t2.status} ${t2.data.error ?? ''}`);
process.stdout.write('   mining return block');
await waitBalance(researcher.address, round8(rBefore2 + backAmt), 'return transfer');
process.stdout.write('\n');
check('researcher got the returned funds', round8(await balance(researcher.address) - rBefore2) === backAmt, `+${backAmt}`);

console.log('6. Multi-user hop: researcher → validator[1] → validator[2]…');
const hop = round8((await balance(researcher.address)) / 3);
await transfer(researcher, validators[1].address, hop);
process.stdout.write('   mining hop 1');
await waitBalance(validators[1].address, round8(vBals[1] + hop), 'hop1');
process.stdout.write('\n');
const v2Before = await balance(validators[2].address);
const t3 = await transfer(validators[1], validators[2].address, hop);
check('second hop accepted', t3.status === 202, `status=${t3.status} ${t3.data.error ?? ''}`);
process.stdout.write('   mining hop 2');
await waitBalance(validators[2].address, round8(v2Before + hop), 'hop2');
process.stdout.write('\n');
check('funds propagated across the multi-user graph', round8(await balance(validators[2].address) - v2Before) === hop);

console.log('7. Final consistency: chain valid + supply conserved across all transfers…');
const validate = (await req('GET', '/api/ledger/validate')).data;
check('chain is valid', validate.valid === true, JSON.stringify(validate));
check('total supply unchanged by all transfers', round8(await supply()) === round8(supply0), `${round8(supply0)} → ${round8(await supply())}`);

console.log(failed ? '\nTRANSFER CHECK FAILED' : '\nALL TRANSFER CHECKS PASSED');
process.exit(failed ? 1 : 0);
