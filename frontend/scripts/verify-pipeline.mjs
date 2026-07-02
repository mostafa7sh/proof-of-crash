// End-to-end proof of the submission pipeline + consensus gate.
//
// Flow exercised (the SAME crypto the SPA uses):
//   register wallets → upload app → submit 2 proofs
//   proof A: 3 AGREEING votes      → consensus reached → enters a block
//   proof B: 3 DISAGREEING votes   → no consensus      → never enters a block
//   plus an app with no proof       → stays "Pending" in the mempool
//
// Verifies: /api/mempool buckets, and that mining only finalizes the consensus
// proof. Point BASE at the nginx proxy (e.g. http://localhost:3011).
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
  const { data: ch } = await req('POST', '/api/auth/challenge', { address: w.address });
  const sig = bytesToHex(ed.sign(utf8ToBytes(['poc-register-v1', ch.challenge, w.address, w.publicKey].join(':')), w.priv));
  const r = await req('POST', '/api/auth/register', { public_key: w.publicKey, address: w.address, challenge: ch.challenge, signature: sig, pow_nonce: solvePow(ch.challenge, ch.pow_difficulty) });
  w.token = r.data.token;
  return r.status === 201;
}

// Vote signature matches the SPA: sha256(message) → sign the 32 digest bytes.
async function vote(validator, proofId, score) {
  const signedAt = Math.floor(Date.now() / 1000);
  const digest = bytesToHex(sha256(utf8ToBytes(`poc-vote-v1:${proofId}:${score}:${signedAt}`)));
  const signature = bytesToHex(ed.sign(hexToBytes(digest), validator.priv));
  return req('POST', '/api/verifications', { proof_id: proofId, score, signature, signed_at: signedAt, crashed: true }, validator.token);
}

let failed = false;
const check = (label, ok, extra = '') => { console.log(`  ${ok ? '✓' : '✗'} ${label}${extra ? ' — ' + extra : ''}`); if (!ok) failed = true; };

console.log('1. Register wallets (developer + researcher + 3 validators)…');
const tester = makeWallet();        // the developer who uploads the code
const researcher = makeWallet();    // a different user who files the proofs
const validators = [makeWallet(), makeWallet(), makeWallet()];
await register(tester);
await register(researcher);
for (const v of validators) await register(v);
check('all wallets registered', !!tester.token && !!researcher.token && validators.every((v) => v.token));

console.log('2. Upload app + a second app left with no proof…');
const app = await req('POST', '/api/apps', { name: 'pipeline-test', language: 'c', source_code: 'int main(){return 0;}' }, tester.token);
const lonelyApp = await req('POST', '/api/apps', { name: 'no-proof-app', language: 'c', source_code: 'int main(){return 1;}' }, tester.token);
check('apps created', app.status === 201 && lonelyApp.status === 201);

console.log('3. Submit two crash proofs (by the researcher, not the author)…');
// The author may NOT prove a bug in their own code.
const selfProof = await req('POST', '/api/proofs', { app_id: app.data.app_id, crash_input: '41414141', input_format: 'stdin' }, tester.token);
check('author cannot prove own code → 403 SELF_PROOF', selfProof.status === 403 && selfProof.data.code === 'SELF_PROOF', `${selfProof.status} ${selfProof.data.code}`);

const proofA = await req('POST', '/api/proofs', { app_id: app.data.app_id, crash_input: '41414141', input_format: 'stdin' }, researcher.token);
const proofB = await req('POST', '/api/proofs', { app_id: app.data.app_id, crash_input: '42424242', input_format: 'stdin' }, researcher.token);
check('proofs submitted', proofA.status === 201 && proofB.status === 201);
const idA = proofA.data.proof_id, idB = proofB.data.proof_id;

console.log('4. Proof A: 3 AGREEING votes (7.0, 7.2, 6.8)…');
await vote(validators[0], idA, 7.0);
await vote(validators[1], idA, 7.2);
const lastA = await vote(validators[2], idA, 6.8);
check('A consensus_reached', lastA.data.consensus_reached === true, `agree=${lastA.data.agreeing_count}/${lastA.data.vote_count}`);
check('vote response seals the median', lastA.data.current_median === null && lastA.data.scores_sealed === true);

console.log('   blind review: scores + median sealed while voting…');
const sealed = (await req('GET', `/api/verifications/${idA}`)).data;
check('median sealed pre-finalization', sealed.current_median === null && sealed.scores_sealed === true);
check('individual scores sealed pre-finalization', sealed.data.length > 0 && sealed.data.every((v) => v.score === null), `rows=${sealed.data.length}`);

console.log('5. Proof B: 3 DISAGREEING votes (1.0, 5.0, 9.0)…');
await vote(validators[0], idB, 1.0);
await vote(validators[1], idB, 5.0);
const lastB = await vote(validators[2], idB, 9.0);
check('B consensus NOT reached', lastB.data.consensus_reached === false, `agree=${lastB.data.agreeing_count}/${lastB.data.vote_count}`);

console.log('6. /api/mempool buckets (before mining)…');
const mem1 = (await req('GET', '/api/mempool')).data;
check('A in ready_for_block', mem1.ready_for_block.some((p) => p.proof_id === idA));
check('B in under_review', mem1.under_review.some((p) => p.proof_id === idB));
check('lonely app in pending_submissions', mem1.pending_submissions.some((a) => a.app_id === lonelyApp.data.app_id));
check('mempool never exposes the median', [...mem1.ready_for_block, ...mem1.under_review].every((p) => p.current_median === null));

console.log('   proof contents are visible to reviewers…');
const contentA = (await req('GET', `/api/proofs/${idA}/content`)).data;
check('proof A content readable', contentA.crash_input_hex === '41414141' && contentA.input_format === 'stdin', `hex=${contentA.crash_input_hex}`);

console.log('7. Wait for the miner (block interval ~30s)…');
let finalizedA = null, blockCount0 = (await req('GET', '/api/ledger')).data.total;
for (let i = 0; i < 14; i++) {
  await sleep(5000);
  const a = (await req('GET', `/api/proofs/${idA}`)).data;
  if (a.status === 'finalized') { finalizedA = a; break; }
  process.stdout.write('.');
}
process.stdout.write('\n');

console.log('8. Post-mining assertions…');
const aFinal = (await req('GET', `/api/proofs/${idA}`)).data;
const bFinal = (await req('GET', `/api/proofs/${idB}`)).data;
const blocks = (await req('GET', '/api/ledger')).data;
const mem2 = (await req('GET', '/api/mempool')).data;
check('consensus proof A → finalized (on-chain)', aFinal.status === 'finalized', `status=${aFinal.status}`);
check('competing proof B → archived (a sibling won the app)', bFinal.status === 'archived', `status=${bFinal.status}`);
check('B never entered a block', bFinal.status !== 'finalized', `status=${bFinal.status}`);
check('a new block was created', blocks.total > blockCount0, `${blockCount0} → ${blocks.total}`);
check('genesis still present (block 0)', blocks.data.some((b) => String(b.block_number) === '0'));
check('A left the mempool ready bucket', !mem2.ready_for_block.some((p) => p.proof_id === idA));
check('archived B removed from mempool under_review', !mem2.under_review.some((p) => p.proof_id === idB));

console.log('   median + scores revealed after finalization…');
const revealed = (await req('GET', `/api/verifications/${idA}`)).data;
check('median revealed after finalization', typeof revealed.current_median === 'number' && revealed.scores_sealed === false, `median=${revealed.current_median}`);
check('individual scores revealed after finalization', revealed.data.every((v) => typeof v.score === 'number'));

console.log('   finalized application is closed to new proofs…');
const closed = await req('POST', '/api/proofs', { app_id: app.data.app_id, crash_input: '43434343', input_format: 'stdin' }, researcher.token);
check('new proof for finalized app → 409 APP_FINALIZED', closed.status === 409 && closed.data.code === 'APP_FINALIZED', `${closed.status} ${closed.data.code}`);

console.log('9. Leaderboard shape + the finalized proof is on record…');
const lb = (await req('GET', '/api/leaderboard')).data;
const keys = lb.categories.map((c) => c.key);
check('leaderboard has all categories', ['coins', 'proofs', 'bugs', 'sent', 'received'].every((k) => keys.includes(k)), keys.join(','));
// Leaderboard returns only the top N; on a shared DB the single-proof researcher
// may sit below it. Verify the finalized proof directly via the proofs API.
const finalizedForApp = (await req('GET', `/api/proofs?status=finalized&app_id=${app.data.app_id}`)).data;
check('researcher has a finalized (valid) proof on record', finalizedForApp.data.some((p) => p.proof_id === idA && p.tester_address === researcher.address));
check('author\'s code has a confirmed bug on record', finalizedForApp.data.some((p) => p.proof_id === idA));

console.log('10. Rejected proofs never surface in the default feed…');
const feed = (await req('GET', '/api/proofs')).data;
check('proofs feed excludes rejected', feed.data.every((p) => p.status !== 'rejected'));

console.log(failed ? '\nPIPELINE CHECK FAILED' : '\nALL PIPELINE CHECKS PASSED');
process.exit(failed ? 1 : 0);
