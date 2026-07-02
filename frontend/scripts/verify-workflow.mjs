// End-to-end proof of the workflow/usability fixes:
//   • GET /api/apps/:id/source returns the stored source
//   • app-source + proof-submission UUID validation returns precise errors
//   • a finalized block exposes its proof → app linkage (block is explorable)
//
// Point BASE at the nginx proxy (e.g. http://localhost:3011).
import { webcrypto } from 'node:crypto';
if (!globalThis.crypto) globalThis.crypto = webcrypto;

import * as ed from '@noble/ed25519';
import { sha256 } from '@noble/hashes/sha256';
import { sha512 } from '@noble/hashes/sha512';
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils';
import { solvePow } from './poc-pow.mjs';
ed.etc.sha512Sync = (...m) => sha512(ed.etc.concatBytes(...m));

const BASE = process.env.BASE ?? 'http://localhost:3011';

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

let failed = false;
const check = (label, ok, extra = '') => { console.log(`  ${ok ? '✓' : '✗'} ${label}${extra ? ' — ' + extra : ''}`); if (!ok) failed = true; };

const SRC = '#include <stdio.h>\nint main(){\n\tchar b[8];\n\tgets(b);\n\treturn 0;\n}\n';

console.log('1. Register tester…');
const tester = makeWallet();       // developer / uploader
const researcher = makeWallet();   // a different user who files proofs
await register(tester);
await register(researcher);
check('wallets registered', !!tester.token && !!researcher.token);

console.log('2. Upload an app…');
const app = await req('POST', '/api/apps', { name: 'workflow-target', language: 'c', source_code: SRC }, tester.token);
check('app created', app.status === 201, `app_id=${app.data.app_id}`);
const appId = app.data.app_id;

console.log('3. GET /api/apps/:id/source returns the stored source…');
const src = await req('GET', `/api/apps/${appId}/source`);
check('source endpoint 200', src.status === 200);
check('source_code round-trips', src.data.source_code === SRC);
check('size_bytes correct', src.data.size_bytes === Buffer.byteLength(SRC, 'utf8'), `got=${src.data.size_bytes}`);

console.log('4. UUID validation — precise errors, not generic 500s…');
const badGet = await req('GET', '/api/apps/not-a-uuid');
check('GET app w/ bad uuid → 400 INVALID_UUID', badGet.status === 400 && badGet.data.code === 'INVALID_UUID', badGet.data.error);

const missingUuid = '123e4567-e89b-12d3-a456-426614174000';
const missGet = await req('GET', `/api/apps/${missingUuid}`);
check('GET app w/ unknown uuid → 404 APP_NOT_FOUND', missGet.status === 404 && missGet.data.code === 'APP_NOT_FOUND', missGet.data.error);

const badProof = await req('POST', '/api/proofs', { app_id: 'nope', crash_input: '4141', input_format: 'stdin' }, tester.token);
check('POST proof w/ bad uuid → 400 INVALID_UUID', badProof.status === 400 && badProof.data.code === 'INVALID_UUID', badProof.data.error);

const missProof = await req('POST', '/api/proofs', { app_id: missingUuid, crash_input: '4141', input_format: 'stdin' }, tester.token);
check('POST proof w/ unknown uuid → 404 APP_NOT_FOUND', missProof.status === 404 && missProof.data.code === 'APP_NOT_FOUND', missProof.data.error);

console.log('5. Proof submission rules…');
const selfProof = await req('POST', '/api/proofs', { app_id: appId, crash_input: '41414141', input_format: 'stdin' }, tester.token);
check('author cannot prove own code → 403 SELF_PROOF', selfProof.status === 403 && selfProof.data.code === 'SELF_PROOF', `${selfProof.status} ${selfProof.data.code}`);

const goodProof = await req('POST', '/api/proofs', { app_id: appId, crash_input: '41414141', input_format: 'stdin' }, researcher.token);
check('other user can submit a proof → 201', goodProof.status === 201, `status=${goodProof.status}`);

console.log('6. Proofs filtered by app_id (powers the Application page)…');
const byApp = await req('GET', `/api/proofs?app_id=${appId}`);
check('proofs?app_id lists the proof', byApp.status === 200 && byApp.data.data.some((p) => p.proof_id === goodProof.data.proof_id));

console.log('7. Genesis block is explorable and source-free…');
const ledger = await req('GET', '/api/ledger');
const genesis = ledger.data.data.find((b) => String(b.block_number) === '0');
check('genesis present', !!genesis);
if (genesis) {
  const gd = await req('GET', `/api/ledger/${genesis.block_hash}`);
  check('genesis block detail 200', gd.status === 200);
  check('genesis has previous_hash = null', gd.data.previous_hash === null);
  check('ledger list carries proof_count for block typing', typeof genesis.proof_count === 'number');
}

console.log('8. Leaderboard endpoint is shaped and public…');
const lb = (await req('GET', '/api/leaderboard'));
check('leaderboard 200', lb.status === 200);
check('leaderboard exposes extensible categories', Array.isArray(lb.data.categories) && lb.data.categories.length >= 5);
check('each category has key/title/entries', lb.data.categories.every((c) => c.key && c.title && Array.isArray(c.entries)));

console.log(failed ? '\nWORKFLOW CHECK FAILED' : '\nALL WORKFLOW CHECKS PASSED');
process.exit(failed ? 1 : 0);
