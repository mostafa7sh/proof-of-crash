// ─────────────────────────────────────────────────────────────────────────
// Proof of Crash — demo data seeder (runs once, on `docker compose up`).
//
// Populates a FRESH chain with realistic data by driving the SAME public API
// the SPA uses — registering users, uploading apps, submitting crash proofs,
// voting to consensus, mining blocks, and moving PoC around. Because every
// action is signed client-side (Ed25519) and validated by the C++ engine, the
// resulting blocks/UTXOs are fully consistent (the chain validates end-to-end).
//
// Idempotent: if the chain already has blocks beyond genesis it exits without
// touching anything, so re-running `up` never duplicates or corrupts data.
//
// The demo accounts are DETERMINISTIC (keys derived from a fixed phrase), so the
// credential list in SEED_USERS.md is stable across builds.
// ─────────────────────────────────────────────────────────────────────────
import { webcrypto } from 'node:crypto';
if (!globalThis.crypto) globalThis.crypto = webcrypto;

import * as ed from '@noble/ed25519';
import { sha256 } from '@noble/hashes/sha256';
import { sha512 } from '@noble/hashes/sha512';
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils';
ed.etc.sha512Sync = (...m) => sha512(ed.etc.concatBytes(...m));

const BASE = process.env.BASE ?? 'http://backend:3000';
const SEED_TOKEN = process.env.SEED_TOKEN ?? '';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const round8 = (n) => Math.round(n * 1e8) / 1e8;

// ─── low-level HTTP (adds the seed token so the rate limiter lets us burst) ──
async function req(method, path, body, token) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(SEED_TOKEN ? { 'X-Seed-Token': SEED_TOKEN } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

// ─── proof-of-work (mirrors backend/src/auth/pow.ts) ─────────────────────────
function leadingZeroBits(d) {
  let bits = 0;
  for (const byte of d) { if (byte === 0) { bits += 8; continue; } bits += Math.clz32(byte) - 24; break; }
  return bits;
}
function solvePow(challenge, bits) {
  if (!bits || bits <= 0) return '0';
  for (let n = 0; ; n++) {
    if (leadingZeroBits(sha256(utf8ToBytes(`poc-pow-v1:${challenge}:${n}`))) >= bits) return String(n);
  }
}

// ─── deterministic demo accounts ─────────────────────────────────────────────
const NAMES = ['alice', 'bob', 'carol', 'dave', 'erin', 'frank', 'grace', 'heidi', 'ivan', 'judy', 'mallory', 'niaj'];
function makeUser(name, i) {
  const priv = sha256(utf8ToBytes(`poc-seed-user-v1:${i}:${name}`)); // 32-byte Ed25519 seed
  const publicKey = bytesToHex(ed.getPublicKey(priv));
  return { name, priv, publicKey, address: bytesToHex(sha256(hexToBytes(publicKey))) };
}
const users = NAMES.map(makeUser);
const U = Object.fromEntries(users.map((u) => [u.name, u]));

// ─── signed actions (identical crypto to the SPA) ────────────────────────────
async function register(u) {
  const { data: c } = await req('POST', '/api/auth/challenge', { address: u.address });
  const sig = bytesToHex(ed.sign(utf8ToBytes(['poc-register-v1', c.challenge, u.address, u.publicKey].join(':')), u.priv));
  const r = await req('POST', '/api/auth/register', {
    public_key: u.publicKey, address: u.address, challenge: c.challenge, signature: sig,
    pow_nonce: solvePow(c.challenge, c.pow_difficulty),
  });
  if (r.status === 201) { u.token = r.data.token; return true; }
  return false;
}
async function uploadApp(owner, app) {
  const r = await req('POST', '/api/apps', { name: app.name, description: app.desc, language: app.lang, source_code: app.src }, owner.token);
  return r.data.app_id;
}
async function submitProof(researcher, appId, crashHex) {
  const r = await req('POST', '/api/proofs', { app_id: appId, crash_input: crashHex, input_format: 'stdin' }, researcher.token);
  return r.status === 201 ? r.data.proof_id : null;
}
async function vote(v, proofId, score) {
  const signedAt = Math.floor(Date.now() / 1000);
  const digest = bytesToHex(sha256(utf8ToBytes(`poc-vote-v1:${proofId}:${score}:${signedAt}`)));
  const signature = bytesToHex(ed.sign(hexToBytes(digest), v.priv));
  return req('POST', '/api/verifications', { proof_id: proofId, score, signature, signed_at: signedAt, crashed: true }, v.token);
}
async function quorumFor(proofId) {
  const r = await req('GET', `/api/verifications/${proofId}`);
  return r.data.min_verifications ?? 3;
}

// ─── transfer building (mirrors the engine's transfer txId serialization) ────
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
const balance = async (a) => (await req('GET', `/api/ledger/balance/${a}`)).data.balance ?? 0;
async function transfer(from, toAddr, amount) {
  const { data } = await req('GET', `/api/ledger/utxos/${from.address}`);
  const utxos = [...(data.utxos ?? [])].sort((a, b) => b.amount - a.amount);
  const chosen = []; let total = 0;
  for (const u of utxos) { chosen.push(u); total += u.amount; if (total >= amount) break; }
  if (total < amount || amount <= 0) return { status: 0, data: { error: 'insufficient' } };
  const outputs = [{ address: toAddr, amount: round8(amount) }];
  const change = round8(total - amount);
  if (change > 0) outputs.push({ address: from.address, amount: change });
  const refs = chosen.map((u) => ({ prev_tx_id: u.tx_id, output_index: u.output_index }));
  const signature = bytesToHex(ed.sign(hexToBytes(txId(refs, outputs)), from.priv));
  return req('POST', '/api/ledger/transfer', { inputs: refs.map((r) => ({ ...r, signature })), outputs }, from.token);
}

// ─── mining (alice is an admin, so she can trigger a block immediately) ───────
async function mine(label) {
  const r = await req('POST', '/api/ledger/finalize', {}, U.alice.token);
  if (r.status === 201) console.log(`   ⛏  block #${r.data.block_number} — ${r.data.transactions} tx, ${r.data.total_minted ?? 0} PoC minted  (${label})`);
  else if (r.data.message) console.log(`   ·  nothing to mine (${label})`);
  else console.log(`   ⚠  mine failed: ${r.status} ${JSON.stringify(r.data)} (${label})`);
  return r;
}

// ─── the target applications (small programs with real, plausible bugs) ──────
const APPS = [
  { lang: 'c',   name: 'strcpy-echo',    desc: 'Echoes stdin into a fixed 16-byte buffer.', src: '#include <stdio.h>\n#include <string.h>\nint main(){char buf[16];char line[512];fgets(line,sizeof line,stdin);strcpy(buf,line);/* stack overflow */printf("%s",buf);return 0;}' },
  { lang: 'c',   name: 'atoi-index',     desc: 'Indexes a table by an attacker-controlled number.', src: '#include <stdio.h>\n#include <stdlib.h>\nint t[8];int main(){char s[64];fgets(s,sizeof s,stdin);int i=atoi(s);return t[i];/* OOB read */}' },
  { lang: 'cpp', name: 'vec-at',         desc: 'Reads vector[n] without bounds checking.', src: '#include <vector>\n#include <iostream>\nint main(){std::vector<int> v{1,2,3};size_t n;std::cin>>n;std::cout<<v[n];/* UB on OOB */return 0;}' },
  { lang: 'c',   name: 'null-parse',     desc: 'Dereferences a pointer that may be null.', src: '#include <stdio.h>\n#include <string.h>\nchar* find(char*s){return strchr(s,\'=\');}\nint main(){char s[128];fgets(s,sizeof s,stdin);char*p=find(s);return p[1];/* null deref */}' },
  { lang: 'c',   name: 'int-malloc',     desc: 'Multiplies a size that can overflow before malloc.', src: '#include <stdlib.h>\n#include <stdio.h>\nint main(){unsigned n;scanf("%u",&n);char*b=malloc(n*16);/* int overflow */b[n]=0;free(b);return 0;}' },
  { lang: 'python', name: 'json-depth',  desc: 'Parses deeply nested JSON with no depth guard.', src: 'import json,sys\n# crashes with RecursionError on deeply nested input\nprint(json.loads(sys.stdin.read()))\n' },
  { lang: 'rust', name: 'slice-panic',   desc: 'Slices a string at a byte index from input.', src: 'use std::io::*;\nfn main(){let mut s=String::new();stdin().read_line(&mut s).unwrap();let n:usize=s.trim().parse().unwrap_or(99);let d="abc";println!("{}",&d[..n]);/* panics */}' },
  { lang: 'go',   name: 'nilmap-write',  desc: 'Writes to a map that was never initialised.', src: 'package main\nimport "fmt"\nfunc main(){var m map[string]int\nvar k string\nfmt.Scan(&k)\nm[k]=1/* panic: nil map */\nfmt.Println(m)}' },
  { lang: 'c',   name: 'fmt-string',     desc: 'Passes user input directly as a printf format.', src: '#include <stdio.h>\nint main(){char s[128];fgets(s,sizeof s,stdin);printf(s);/* format-string bug */return 0;}' },
  { lang: 'c',   name: 'div-zero',       desc: 'Divides by a user-supplied divisor.', src: '#include <stdio.h>\nint main(){int a,b;scanf("%d %d",&a,&b);printf("%d",a/b);/* div by zero */return 0;}' },
  { lang: 'cpp', name: 'huge-alloc',     desc: 'Reserves a vector sized from untrusted input.', src: '#include <vector>\n#include <iostream>\nint main(){unsigned long n;std::cin>>n;std::vector<long> v;v.resize(n);/* bad_alloc */return v.size();}' },
  { lang: 'c',   name: 'off-by-one',     desc: 'Copies n+1 bytes into an n-byte buffer.', src: '#include <stdio.h>\n#include <string.h>\nint main(){char dst[8];char s[64];fgets(s,sizeof s,stdin);memcpy(dst,s,strlen(s));/* off by one+ */return dst[0];}' },
  { lang: 'c',   name: 'race-target',    desc: 'A hot bug two researchers race to prove first.', src: '#include <stdio.h>\nint main(){char b[4];int i=0,c;while((c=getchar())!=EOF)b[i++]=c;/* overflow */return b[0];}' },
  { lang: 'c',   name: 'disputed-bug',   desc: 'A borderline finding validators disagree on.', src: '#include <stdio.h>\nint main(){int x;scanf("%d",&x);if(x<0)return x*-1;/* maybe UB on INT_MIN */return 0;}' },
];

// ─── run ─────────────────────────────────────────────────────────────────────
async function waitForApi() {
  for (let i = 0; i < 60; i++) {
    try { const r = await req('GET', '/api/ledger/supply'); if (r.status === 200) return true; } catch { /* not up yet */ }
    await sleep(2000);
  }
  return false;
}

async function main() {
  console.log('Proof of Crash seeder — waiting for the API…');
  if (!(await waitForApi())) { console.error('API never became ready; aborting.'); process.exit(1); }

  // Idempotency: only genesis (total == 1) means a fresh chain.
  const ledger = (await req('GET', '/api/ledger')).data;
  if ((ledger.total ?? 1) > 1) {
    console.log(`Chain already has ${ledger.total} blocks — data present, skipping seed.`);
    process.exit(0);
  }

  console.log(`1. Registering ${users.length} demo accounts…`);
  for (const u of users) {
    const ok = await register(u);
    if (!ok) { console.error(`   ✗ failed to register ${u.name} (${u.address.slice(0, 10)}…) — aborting.`); process.exit(1); }
  }
  console.log(`   ✓ ${users.length} accounts registered (alice is the admin miner).`);

  console.log('2. Uploading target applications…');
  const appIds = [];
  for (let i = 0; i < APPS.length; i++) {
    const owner = users[i % users.length];
    appIds[i] = await uploadApp(owner, APPS[i]);
    console.log(`   ✓ ${APPS[i].name} (${APPS[i].lang}) by ${owner.name}`);
  }

  // Helper: bring one proof to consensus (owner & researcher excluded from voting).
  async function proveToConsensus(appIdx, researcher, crashHex, scores) {
    const owner = users[appIdx % users.length];
    const pid = await submitProof(researcher, appIds[appIdx], crashHex);
    if (!pid) return null;
    const q = await quorumFor(pid);
    const voters = users.filter((u) => u !== owner && u !== researcher).slice(0, Math.max(q, scores.length));
    for (let i = 0; i < voters.length; i++) await vote(voters[i], pid, scores[i % scores.length]);
    return pid;
  }

  console.log('3. Crash proofs → consensus → blocks (mined in batches)…');
  // Non-race apps 0..11: each gets one winning proof; mine in varied batches so
  // blocks carry different numbers of coinbase rewards.
  const batches = [[0, 1], [2], [3, 4, 5], [6], [7, 8], [9], [10, 11]];
  const agree = [7.5, 7.7, 7.3, 7.6, 7.4];
  for (const batch of batches) {
    for (const idx of batch) {
      const researcher = users[(idx + 1) % users.length];
      const hex = bytesToHex(utf8ToBytes('A'.repeat(24 + idx) + `\n#${idx}`));
      await proveToConsensus(idx, researcher, hex, agree);
    }
    await mine(`proofs ${batch.map((i) => APPS[i].name).join(', ')}`);
  }

  console.log('4. A race: two researchers, one app, first valid proof wins…');
  const raceIdx = 12; // owner: alice
  // Submit BOTH proofs before either reaches consensus, so neither is rejected
  // as "app finalized"; then vote both up and mine — exactly one can win.
  const pA = await submitProof(U.bob, appIds[raceIdx], bytesToHex(utf8ToBytes('4141414141\n')));
  const pB = await submitProof(U.carol, appIds[raceIdx], bytesToHex(utf8ToBytes('4242424242\n')));
  if (pA && pB) {
    const q = await quorumFor(pA);
    const vA = users.filter((u) => u !== U.alice && u !== U.bob).slice(0, Math.max(q, agree.length));
    const vB = users.filter((u) => u !== U.alice && u !== U.carol).slice(0, Math.max(q, agree.length));
    for (let i = 0; i < vA.length; i++) await vote(vA[i], pA, agree[i % agree.length]);
    for (let i = 0; i < vB.length; i++) await vote(vB[i], pB, agree[i % agree.length]);
  }
  await mine('race-target (one winner, one archived)');
  if (pA && pB) {
    const sA = (await req('GET', `/api/proofs/${pA}`)).data.status;
    const sB = (await req('GET', `/api/proofs/${pB}`)).data.status;
    console.log(`   ✓ race settled — bob:${sA}, carol:${sB}`);
  }

  console.log('5. A disputed finding left under review (no consensus)…');
  const dIdx = 13;                       // owner: users[13 % 12] = bob
  const dOwner = users[dIdx % users.length];
  const dPid = await submitProof(U.dave, appIds[dIdx], bytesToHex(utf8ToBytes('-2147483648\n')));
  if (dPid) {
    // Spread scores wide so a majority never agrees within the outlier band.
    const voters = users.filter((u) => u !== dOwner && u !== U.dave).slice(0, 3);
    await vote(voters[0], dPid, 2.0); await vote(voters[1], dPid, 5.5); await vote(voters[2], dPid, 9.0);
    console.log('   ✓ disputed proof stays in the mempool "under review" bucket.');
  }

  console.log('6. Token transfers between users → transfer blocks…');
  const flows = [
    [['alice', 'bob', 180], ['bob', 'carol', 120], ['carol', 'dave', 90]],
    [['erin', 'frank', 160], ['grace', 'heidi', 140], ['ivan', 'judy', 110]],
    [['bob', 'alice', 60], ['dave', 'erin', 75], ['frank', 'grace', 55]],
    [['alice', 'carol', 100], ['alice', 'erin', 100], ['heidi', 'ivan', 80]],
    [['mallory', 'niaj', 130], ['niaj', 'alice', 65], ['judy', 'mallory', 70]],
    [['carol', 'frank', 45], ['erin', 'heidi', 50], ['grace', 'bob', 40]],
  ];
  for (let i = 0; i < flows.length; i++) {
    let sent = 0;
    for (const [from, to, amt] of flows[i]) {
      const r = await transfer(U[from], U[to].address, amt);
      if (r.status === 202) sent++;
    }
    await mine(`transfers round ${i + 1} (${sent} sent)`);
  }

  // ─── summary ───────────────────────────────────────────────────────────────
  const supply = (await req('GET', '/api/ledger/supply')).data;
  const blocks = (await req('GET', '/api/ledger')).data;
  const validate = (await req('GET', '/api/ledger/validate')).data;
  console.log('\n─── seed complete ─────────────────────────────');
  console.log(`   blocks:        ${blocks.total}`);
  console.log(`   total supply:  ${round8(supply.total_supply)} PoC`);
  console.log(`   chain valid:   ${validate.valid}`);
  console.log('   balances:');
  for (const u of users) console.log(`     ${u.name.padEnd(8)} ${String(round8(await balance(u.address))).padStart(10)} PoC   ${u.address}`);
  console.log('───────────────────────────────────────────────');
  process.exit(0);
}

main().catch((e) => { console.error('seeder crashed:', e); process.exit(1); });
