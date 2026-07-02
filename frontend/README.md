# Proof of Crash — Frontend

Vite + React 18 + TypeScript SPA for the decentralized bug-validation platform.
Talks to the existing backend REST API; no backend logic lives here.

## Run

The whole stack (frontend + backend + engine + DB) runs from the repo root with
a single command — the frontend is built and served by nginx on port 3001:

```bash
docker compose up --build      # then open http://localhost:3001
```

See the [root README](../README.md) for ports/fallback. For local UI work
against a separately-running backend, the Vite dev server is still available:

```bash
npm install
npm run dev        # http://localhost:5173 (proxies /api + /health → :3000)
```

The dev server proxies API calls to `http://localhost:3000` by default —
override with `VITE_PROXY_TARGET`. For a deployed backend, set `VITE_API_URL`.

```bash
npm run build      # type-check + production bundle into dist/
npm run typecheck  # tsc --noEmit
node scripts/verify-auth.mjs   # e2e check: wallet → register → login → /me
```

> In Docker, `VITE_API_URL` is intentionally left empty so the bundle uses
> same-origin `/api` paths; nginx proxies them to the backend.

## Architecture

```
src/
  api/        Axios client (auth/refresh interceptor) + one module per resource
  components/ Reusable UI: Button, Input, Card, Modal, Badge, Hash, Pagination, states
  context/    AuthContext — wallet + session, persisted to localStorage
  hooks/      useAsync (loading/error/reload) + named data hooks
  layouts/    AppLayout (sticky top navbar + footer, lucide icons)
  pages/      Route-level screens
  types/      API models
  utils/      wallet (Ed25519), transaction builder, format, validation
  styles/     Global theme + layout CSS
```

No direct `fetch`/`axios` calls in components — everything goes through `src/api`
via the hooks. Every API-backed screen renders loading + error + empty states.

## Screen → route map

Routes follow the Figma frames (`figma/src/app/pages`). The Figma "Project"
maps to the backend **App**, "Submission/Crash" to **CrashProof**, and the
binary approve/reject mock to the real **score-based median consensus**.

| Figma frame          | Screen                | Route                  | Endpoints |
|----------------------|-----------------------|------------------------|-----------|
| Landing              | Marketing (public)    | `/`                    | `ledger/supply` |
| —                    | Auth / wallet connect | `/login`               | `auth/challenge`, `auth/register`, `auth/login` |
| Dashboard            | Dashboard             | `/dashboard`           | `ledger/supply`, `ledger/latest`, `ledger/balance`, `proofs` |
| (Dashboard projects) | Bug proofs feed       | `/proofs`              | `proofs?status=&page=` |
| —                    | Mempool (pipeline)    | `/mempool`             | `mempool` (pending / under-review / ready) |
| Validation           | Crash validation/vote | `/proofs/:proofId`     | `proofs/:id`, `proofs/:id/content`, `apps/:id/source`, `verifications/:id`, `verifications` (POST) |
| (app from mempool)   | Application detail     | `/apps/:appId`         | `apps/:id`, `apps/:id/source`, `proofs?app_id=` |
| UploadProject        | Submit (app + proof)  | `/submit`              | `apps` (POST), `proofs` (POST). `?app=<uuid>` pre-fills the proof target |
| BlockchainLedger     | Ledger (timeline)     | `/explorer`            | `ledger`, `ledger/supply`, `ledger/validate` |
| —                    | Leaderboard           | `/leaderboard`         | `leaderboard` (coins / proofs / bugs / sent / received) |
| (block on ledger)    | Block detail          | `/explorer/:blockHash` | `ledger/:hash` |
| (wallet chip)        | Wallet                | `/wallet`              | `ledger/balance`, `ledger/utxos`, `ledger/transfer` (POST) |

## Identity

Auth is wallet-style (matching the backend): an Ed25519 keypair is generated
(or imported) in the browser, the address is `SHA256(publicKey)`, and login is
challenge-response. **Keys are kept in `localStorage` — this is a demo wallet,
not production key management.**

## Design

The UI implements the Figma "Blockchain Bug Discovery Platform" design
(`figma/` in the repo root): a pure-black canvas with a cyan→blue gradient
system, emerald reward accents, `font-mono` for hashes/labels, lucide icons,
gradient panel cards, a sticky top navbar, and a vertical block timeline on the
ledger. The design tokens live in `styles/theme.css`; the shell in
`styles/layout.css`.

Where the Figma is a static mock (e.g. binary approve/reject voting, container
reward pools), the screens keep the **real** backend behaviour — score-based
median consensus, source-hash apps, UTXO balances — styled to match the design.

## Validation rules enforced in the UI (and backend)

- **Full visibility before voting.** The validation page shows the target's
  source code and the proof's actual crash input, so validators can reproduce
  the bug before scoring.
- **Blind review.** While a proof is `voting`, the reward median and every
  individual severity score are sealed (the API returns them as `null`); they
  are revealed only after the proof finalizes. This prevents anchoring on
  existing opinions.
- **One winner per app.** When a proof is accepted into the ledger, every
  competing proof for the same application is `archived`, and the app is closed
  to new proofs. Only the accepted proof stays associated with the block.
- **No empty ledger entries.** A block is mined only when it carries an
  approved proof or a pending transfer — never on an idle tick.
