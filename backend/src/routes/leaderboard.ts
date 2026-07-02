import { Router, Request, Response } from 'express';
import { pool } from '../config/database';
import type { ApiError } from '../types';

// ─── Leaderboard ─────────────────────────────────────────────────────────────
//
// Aggregates public, ledger-derived rankings. Everything is computed from the
// persisted tables (utxos, crash_proofs, apps) — the same data the explorer and
// wallet read — so the board can never disagree with the chain.
//
// The response is an extensible list of categories; adding a new ranking later
// is just another entry in CATEGORIES (one SQL query + a label).

export const leaderboardRouter = Router();

interface LeaderEntryRow {
  address: string;
  value: number;
}

interface Category {
  key: string;
  title: string;
  description: string;
  unit: string;
  query: string;
}

const TOP_N = 10;

const CATEGORIES: Category[] = [
  {
    key: 'coins',
    title: 'Most PoC Coins',
    description: 'Current spendable balance (sum of unspent outputs).',
    unit: 'POC',
    query: `SELECT owner_address AS address, SUM(amount)::float8 AS value
              FROM utxos WHERE is_spent = FALSE
             GROUP BY owner_address ORDER BY value DESC LIMIT ${TOP_N}`,
  },
  {
    key: 'proofs',
    title: 'Most Valid Proofs',
    description: 'Crash proofs accepted into the ledger by community consensus.',
    unit: 'proofs',
    query: `SELECT tester_address AS address, COUNT(*)::int AS value
              FROM crash_proofs WHERE status = 'finalized'
             GROUP BY tester_address ORDER BY value DESC LIMIT ${TOP_N}`,
  },
  {
    key: 'bugs',
    title: 'Most Bugs Found in Their Code',
    description: 'Developers whose uploaded code accumulated the most confirmed bugs.',
    unit: 'bugs',
    query: `SELECT a.developer_address AS address, COUNT(*)::int AS value
              FROM crash_proofs cp JOIN apps a ON a.app_id = cp.app_id
             WHERE cp.status = 'finalized'
             GROUP BY a.developer_address ORDER BY value DESC LIMIT ${TOP_N}`,
  },
  {
    key: 'sent',
    title: 'Most PoC Sent',
    description: 'Total coins spent in transfers (gross outflow).',
    unit: 'POC',
    query: `SELECT owner_address AS address, SUM(amount)::float8 AS value
              FROM utxos WHERE is_spent = TRUE
             GROUP BY owner_address ORDER BY value DESC LIMIT ${TOP_N}`,
  },
  {
    key: 'received',
    title: 'Most PoC Received',
    description: 'Total coins ever received (rewards + incoming transfers).',
    unit: 'POC',
    query: `SELECT owner_address AS address, SUM(amount)::float8 AS value
              FROM utxos GROUP BY owner_address ORDER BY value DESC LIMIT ${TOP_N}`,
  },
];

// GET /api/leaderboard — all ranking categories. Public.
leaderboardRouter.get('/', async (_req: Request, res: Response) => {
  try {
    const categories = await Promise.all(
      CATEGORIES.map(async (c) => {
        const result = await pool.query<LeaderEntryRow>(c.query);
        return {
          key: c.key,
          title: c.title,
          description: c.description,
          unit: c.unit,
          entries: result.rows.map((r) => ({ address: r.address, value: Number(r.value) })),
        };
      }),
    );
    res.json({ categories });
  } catch (err) {
    console.error('GET /api/leaderboard error:', err);
    res.status(500).json({ error: 'Internal server error', code: 'DB_ERROR' } satisfies ApiError);
  }
});
