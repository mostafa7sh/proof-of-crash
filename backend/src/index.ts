import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import * as dotenv from 'dotenv';
import { checkConnection, initializeSchema, pool } from './config/database';
import { buildCorsOptions } from './config/cors';
import { initEngine, getEngine } from './blockchain/instance';
import { mineBlock } from './blockchain/mining';
import { appsRouter } from './routes/apps';
import { proofsRouter } from './routes/proofs';
import { verificationsRouter } from './routes/verifications';
import { ledgerRouter } from './routes/ledger';
import { authRouter } from './routes/auth';
import { purgeExpiredChallenges, purgeExpiredRefreshTokens, purgeExpiredRevokedJtis } from './auth';

dotenv.config();

const app = express();
const PORT = parseInt(process.env['PORT'] ?? '3000');
const BLOCK_INTERVAL_MS = parseInt(process.env['BLOCK_INTERVAL_MS'] ?? '30000');

// ─── Middleware ────────────────────────────────────────────────────────────

// Trust the reverse proxy (nginx, etc.) so req.ip and rate limiting see the
// real client IP rather than the proxy's. Configurable via TRUST_PROXY:
//   'true'/'false' -> boolean, a number -> hop count, anything else -> a
// preset ('loopback', ...) or comma-separated CIDR/IP list. Express's
// proxy-addr rejects 'true'/numbers passed as raw strings, so coerce here.
app.set('trust proxy', parseTrustProxy(process.env['TRUST_PROXY']));

app.use(cors(buildCorsOptions()));
app.use(cookieParser());
app.use(express.json({ limit: '10mb' }));

app.use((req: Request, _res: Response, next: NextFunction) => {
  console.log(`${new Date().toISOString()} ${req.method} ${req.path}`);
  next();
});

// ─── Routes ───────────────────────────────────────────────────────────────

app.get('/health', (_req: Request, res: Response) => {
  const engine = getEngine();
  res.json({
    status: engine.isReady() ? 'ok' : 'degraded',
    engine_ready: engine.isReady(),
    timestamp: Math.floor(Date.now() / 1000),
  });
});

app.use('/api/auth',          authRouter);
app.use('/api/apps',          appsRouter);
app.use('/api/proofs',        proofsRouter);
app.use('/api/verifications', verificationsRouter);
app.use('/api/ledger',        ledgerRouter);

// 404 handler
app.use((_req: Request, res: Response) => {
  res.status(404).json({ error: 'Not found', code: 'NOT_FOUND' });
});

// Global error handler
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error', code: 'INTERNAL_ERROR' });
});

// ─── Startup ──────────────────────────────────────────────────────────────

// Coerce the TRUST_PROXY env string into the shape Express expects.
function parseTrustProxy(raw: string | undefined): boolean | number | string {
  const v = (raw ?? 'loopback').trim();
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (/^\d+$/.test(v)) return parseInt(v, 10);
  return v;
}

async function start(): Promise<void> {
  try {
    await checkConnection();
    await initializeSchema();
    const engine = await initEngine();

    // Start the block miner (mines every BLOCK_INTERVAL_MS, skips if nothing to mine)
    const minerInterval = setInterval(() => {
      void mineBlock(engine, pool).catch(err => {
        console.error('Mining error:', err);
      });
    }, BLOCK_INTERVAL_MS);

    console.log(`Miner started: mining every ${BLOCK_INTERVAL_MS / 1000}s`);

    // Sweep expired auth artifacts hourly so the tables don't grow unbounded.
    const challengeSweep = setInterval(() => {
      void purgeExpiredChallenges(pool).catch(err => console.error('Challenge cleanup error:', err));
      void purgeExpiredRefreshTokens(pool).catch(err => console.error('Refresh-token cleanup error:', err));
      void purgeExpiredRevokedJtis(pool).catch(err => console.error('Revoked-jti cleanup error:', err));
    }, 60 * 60 * 1000);

    app.listen(PORT, () => {
      console.log(`Proof-of-Crash server listening on port ${PORT}`);
    });

    // Graceful shutdown
    const shutdown = async () => {
      console.log('Shutting down...');
      clearInterval(minerInterval);
      clearInterval(challengeSweep);
      await engine.shutdown();
      process.exit(0);
    };
    process.on('SIGTERM', () => void shutdown());
    process.on('SIGINT', () => void shutdown());
  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
}

void start();
