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
| Frontend | http://localhost:3001        |
| Backend  | http://localhost:3000 (`/api`, `/health`) |
| Postgres | localhost:5432               |

The browser only talks to the frontend origin — nginx proxies `/api` and
`/health` through to the backend, so there's no CORS to configure.

### Ports

The frontend defaults to **3001** and the backend to **3000**. If either host
port is already taken, you have two options:

1. **Override explicitly** — pick any free port without editing files:
   ```bash
   FRONTEND_PORT=3002 BACKEND_PORT=3010 docker compose up --build
   ```
2. **Auto-select free ports** — the helper script finds the next free ports
   (starting at 3001 / 3000) and runs compose for you:
   ```bash
   ./up.sh                 # add -d to detach; args pass through to compose
   ```
   It prints the chosen URLs before starting.

### Common commands

```bash
docker compose up --build        # build + run in the foreground
docker compose up --build -d     # ...detached
docker compose logs -f backend   # follow a service's logs
docker compose down              # stop (keeps the postgres volume)
docker compose down -v           # stop and wipe the database
```

## Notes

- `JWT_SECRET` in `docker-compose.yml` is a throwaway dev value — replace it for
  any real deployment.
- The wallet keys the frontend generates live in `localStorage`; this is a demo
  wallet, not production key management.
- Per-service details: [`backend/`](backend/) and [`frontend/README.md`](frontend/README.md).
