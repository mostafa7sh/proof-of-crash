# proof-of-crash

A blockchain-based bug-bounty platform: people find bugs in code in exchange for
cryptocurrency. Three layers, each compiled from source inside its own container:

- **C++ engine** — blockchain state, UTXO set, mempool, SHA-256/SHA-512, Ed25519
  (all from scratch). Spawned by the backend as a child process over stdio.
- **TypeScript backend** — Express API, wallet-style auth, PostgreSQL persistence;
  bridges to the C++ engine. No crypto/chain logic lives here.
- **React frontend** — Vite SPA, served in production by nginx, which also
  reverse-proxies the API to the backend.

## Run the whole stack — one command

```bash
docker compose up --build
```

That builds everything from scratch (C++ engine, backend, frontend bundle) and
starts all three services plus PostgreSQL. Nothing is compiled on the host.

When it's up:

| Service  | URL                          |
|----------|------------------------------|
| Frontend | http://localhost:3009        |
| Backend  | http://localhost:3000 (`/api`, `/health`) |
| Postgres | localhost:5432               |

The browser only talks to the frontend origin — nginx proxies `/api` and
`/health` through to the backend, so there's no CORS to configure.

### Common commands

```bash
docker compose up --build        # build + run in the foreground
docker compose up --build -d     # ...detached
docker compose logs -f backend   # follow a service's logs
docker compose down              # stop (keeps the postgres volume)
docker compose down -v           # stop and wipe the database
```

## Notes

- The wallet keys the frontend generates live in `localStorage`; this is a demo
  wallet, not production key management.
- **AI model review (advisory):** before a proof is minted, three AI models
  (ChatGPT, Gemini, DeepSeek) review the code + crash input; a block earns an
  **"AI Verified"** badge only when all three approve. This is advisory and *not*
  consensus-critical — human consensus still decides what enters the ledger. With
  no API keys the models run as a deterministic *simulated* judge (offline, free);
  set `OPENAI_API_KEY` / `GEMINI_API_KEY` / `DEEPSEEK_API_KEY` to use the real APIs.
- Per-service details: [`backend/`](backend/) and [`frontend/README.md`](frontend/README.md).
