# Demo seed accounts

These 12 accounts are created automatically by the **seeder** service every time
you run `docker compose up --build` (see [`seed/`](seed/) and the `seeder` service
in [`docker-compose.yml`](docker-compose.yml)). They are **deterministic** — the
keys are derived from a fixed phrase, so this list is the same on every build.

> ⚠️ **Demo keys only — do not use real funds.** These private keys are public by
> design so you can log in as any seed user. The platform is non-custodial: the
> server only ever stores the **public key**; the **private key** below is what
> you paste into the app (Cryptographic Key tab → *Import Private Key*) to sign
> votes, proofs and transfers.

- **`alice` is the admin miner** — her address is in `ADMIN_ADDRESSES`, so she can
  trigger `/api/ledger/finalize`. The seeder uses this to mine blocks on demand.
- To **reseed from scratch**, wipe the database volume first:
  `docker compose down -v && docker compose up --build`.

| # | Name | Address (SHA-256 of public key) | Public key (Ed25519) | Private key |
|---|------|----------------------------------|----------------------|-------------|
| 0 | alice ⛏️ | `65c0a5f362353fb1fc6fd70475499bf7db199adee2d8a2fbe815b8cd3aeed76f` | `b3449da87d04b768041f420789754dacb7f6e14b4d89101ac40d1c0574a815d1` | `c007a9c8ff4bd04d541395c66cd345ea393323a130934d41de63f1580ed65d5b` |
| 1 | bob | `4c06ad7621169dba3921a383033ca7ef7fd1f7360e763682bc9844bcca30a217` | `38a1dd9f8c19d4ba8abc70700471dfb4a817e862974239213f1782138a1bd8de` | `9b7d0e1e8e95fa462ace347bd3f8088d597014db966e158508471e4b08c52bdc` |
| 2 | carol | `c3eeb46d694ebc65c93cd49e84e282848866b363794ee0d709dd312d4cb79aac` | `bf345ec4ff53fce04fb523196a36d1bb80333656678cfff1df51ba759fb89f62` | `32b52d744874c87605e20c99f74efbf0cae59f4e5b04a360bcf532cb210bed84` |
| 3 | dave | `601b5e2f9b11d77c87d72974fcf23954cfc33caf3a01bd386d02749e837955d3` | `e8d007532e78251d3d1c1130c8778ef44a75627db6b04bb66f43826f8849ab37` | `70a35400175e8b71aa24815d262b59f348a38ca095696666f168fa79dac9af31` |
| 4 | erin | `31863367f550b8aab95be7a059713f301e153f309944fc826cedae15decc3968` | `a631191baf41e3c7e8ea83843591bca1b7d7bf82598e243b55aef21279f7bee1` | `ece09c404b472664a24992b14cb3b510dc2d235065a485be5d126410bc6d1888` |
| 5 | frank | `009785d4214c1159d4426af14b14e22e92a27f98f3d6390a4b2a6931b9707883` | `6644d12bc1c44189bb85f33b658dfa3d3e84ec9703b68f4f2f3b9feb31f2ac0e` | `71f232bf87f515f3a5798ede8ad9e558f6a0d3732a8d6d03cd706fedf18d207b` |
| 6 | grace | `3a490c254eaa94777b56e692ffadeab12b14713e8b248c451521547803013f8f` | `adc2e428019f883fa6d241fbdb6f7a4c03b6be8105da46793ae753d94952e844` | `6671255709ef5eb4322c787df7a6dbb1a6b41110d37f786252359f90ef9da478` |
| 7 | heidi | `7a7ac880507d2e3c98bfed75190750be44b709de52bc25ffc811f8bb4245e8d0` | `f954285a0551df01458b09275b3525e765174eddb8c5e5395043f3297a66a490` | `d9b5dd21d38d4592dc78fdb0d646fdef200edaf55591fde473c09d86400b1013` |
| 8 | ivan | `c80e712413fe3cf39f911c0f9b41f310ff77a2dafe55b96afa2b205daa7c9e2e` | `b32abb42deb64831d7790c01406f902a883d34f0fe338bf01eceb9a414929621` | `af7a01653534d67bdf32552c106b2275a628f3d8f9a8bd8cbc0d5c5e543b87c7` |
| 9 | judy | `3ea0033ec32d1800ff669c0cf6ed8234064a30be04b69d3045470c1e6a75924d` | `1202aed06ec9ea8b3e507cecfaffd79a3b62255dc496087219deb889e79b05dc` | `e7163b0a44bd435b121fe5fa03dbf08bd715f1de2399cba8adaaec5e137a85cc` |
| 10 | mallory | `982ca1f6b246fb53f0716103d31690fbbb08c70f94037e0260d16ac4017d83f3` | `1ba3333b36820c535a6d6e9bacbb24bc3d1289bac06b223d1e4b8be05566709c` | `668c5b99ac761a58eea116d3463ecd31f3941a1695844ea4130eb20046f08ed4` |
| 11 | niaj | `e5b84b6a70907257be479a15250b685f1b0338dabe497f29f575adf1e778d87c` | `2981f7e369bb7b7ef159e656b3f858d1ea2677a76819f6b02a4017fcb0458a9d` | `6b9b1e6c6e60f90466d1dda15525ed0af0f31c16aecd3e71308ce2bb1173ccbc` |

## What the seed builds

- **12 users**, each owning one target app (14 apps total: 12 owned round-robin +
  a `race-target` and a `disputed-bug`).
- **~13 finalized crash proofs** → coinbase reward blocks (fixed **1000 PoC** each:
  finder **700**, validators share **300** by closeness to the median).
- **A race**: two researchers submit proofs for one app; exactly one is finalized,
  the other archived (first valid proof to reach consensus wins).
- **A disputed proof** left "under review" (validators never reach consensus).
- **~18 token transfers** across several blocks (chains, back-and-forth, fan-out).
- **AI model review** — as each proof is finalized, three AI models (ChatGPT,
  Gemini, DeepSeek) review the code + crash input. With no API keys they run as a
  deterministic *simulated* judge, so seeded bug-discovery blocks show an
  **"AI Verified"** badge (advisory only — human consensus still gates the ledger).

Net result is ~20 non-trivial blocks and a chain that validates end-to-end. Watch
the `seeder` container's logs during `up` for a per-step summary and final balances.
