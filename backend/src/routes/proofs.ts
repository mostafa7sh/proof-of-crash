import { Router, Request, Response } from 'express';
import { pool } from '../config/database';
import { getEngine } from '../blockchain/instance';
import { requireAuth } from '../auth';
import type { CrashProof, ApiError } from '../types';

export const proofsRouter = Router();

const VOTING_WINDOW_SECONDS = 7 * 24 * 60 * 60; // 7 days

// POST /api/proofs — submit a crash proof.
// tester_address comes from the authenticated session, not the request body.
proofsRouter.post('/', requireAuth, async (req: Request, res: Response) => {
  const { app_id, crash_input, input_format } = req.body as {
    app_id?: string;
    crash_input?: string;       // hex-encoded binary
    input_format?: string;
  };
  const tester_address = req.user!.address;

  if (!app_id || !crash_input || !input_format) {
    const err: ApiError = { error: 'Missing required fields: app_id, crash_input, input_format', code: 'MISSING_FIELDS' };
    res.status(400).json(err);
    return;
  }

  const validFormats = ['stdin', 'argv', 'file', 'binary'];
  if (!validFormats.includes(input_format)) {
    const err: ApiError = { error: `Invalid input_format. Allowed: ${validFormats.join(', ')}`, code: 'INVALID_FORMAT' };
    res.status(400).json(err);
    return;
  }

  const client = await pool.connect();
  try {
    // Verify the app exists
    const appCheck = await client.query('SELECT app_id FROM apps WHERE app_id = $1', [app_id]);
    if (appCheck.rows.length === 0) {
      res.status(404).json({ error: 'App not found', code: 'APP_NOT_FOUND' } satisfies ApiError);
      return;
    }

    const now = Math.floor(Date.now() / 1000);
    const inputBuffer = Buffer.from(crash_input, 'hex');

    // All hashing happens in the C++ engine — the single source of truth.
    const engine = getEngine();
    const contentHash = await engine.sha256(inputBuffer);
    const proofId = await engine.sha256(
      Buffer.from(contentHash + app_id + tester_address + now.toString(), 'utf8'),
    );

    await client.query('BEGIN');

    await client.query(
      `INSERT INTO proof_contents (content_hash, crash_input, input_format, input_size, stored_at)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (content_hash) DO NOTHING`,
      [contentHash, inputBuffer, input_format, inputBuffer.length, now]
    );

    const proofResult = await client.query<{ proof_id: string }>(
      `INSERT INTO crash_proofs (proof_id, app_id, tester_address, content_hash, status, voting_deadline, submitted_at)
       VALUES ($1, $2, $3, $4, 'voting', $5, $6)
       RETURNING proof_id`,
      [proofId, app_id, tester_address, contentHash, now + VOTING_WINDOW_SECONDS, now]
    );

    await client.query('COMMIT');

    res.status(201).json({
      proof_id: proofResult.rows[0]?.proof_id,
      status: 'voting',
      voting_deadline: now + VOTING_WINDOW_SECONDS,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('POST /api/proofs error:', err);
    res.status(500).json({ error: 'Internal server error', code: 'DB_ERROR' } satisfies ApiError);
  } finally {
    client.release();
  }
});

// GET /api/proofs/:proofId — retrieve a crash proof
proofsRouter.get('/:proofId', async (req: Request, res: Response) => {
  const { proofId } = req.params as { proofId: string };

  try {
    const result = await pool.query<CrashProof>(
      `SELECT proof_id, app_id, tester_address, content_hash, status,
              voting_deadline, reward_score, finalized_at, submitted_at
       FROM crash_proofs WHERE proof_id = $1`,
      [proofId]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Proof not found', code: 'NOT_FOUND' } satisfies ApiError);
      return;
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('GET /api/proofs/:proofId error:', err);
    res.status(500).json({ error: 'Internal server error', code: 'DB_ERROR' } satisfies ApiError);
  }
});

// GET /api/proofs — list proofs (filtered by status)
proofsRouter.get('/', async (req: Request, res: Response) => {
  const { status, app_id, page = '1', page_size = '20' } = req.query as {
    status?: string;
    app_id?: string;
    page?: string;
    page_size?: string;
  };

  const pageNum = Math.max(1, parseInt(page));
  const size = Math.min(100, Math.max(1, parseInt(page_size)));
  const offset = (pageNum - 1) * size;

  const conditions: string[] = [];
  const params: unknown[] = [];
  let paramIdx = 1;

  if (status) {
    conditions.push(`status = $${paramIdx++}`);
    params.push(status);
  }
  if (app_id) {
    conditions.push(`app_id = $${paramIdx++}`);
    params.push(app_id);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  try {
    const countResult = await pool.query<{ count: string }>(
      `SELECT COUNT(*) as count FROM crash_proofs ${where}`,
      params
    );
    const total = parseInt(countResult.rows[0]?.count ?? '0');

    const rows = await pool.query<CrashProof>(
      `SELECT proof_id, app_id, tester_address, content_hash, status,
              voting_deadline, reward_score, finalized_at, submitted_at
       FROM crash_proofs ${where}
       ORDER BY submitted_at DESC
       LIMIT $${paramIdx++} OFFSET $${paramIdx}`,
      [...params, size, offset]
    );

    res.json({ data: rows.rows, total, page: pageNum, page_size: size });
  } catch (err) {
    console.error('GET /api/proofs error:', err);
    res.status(500).json({ error: 'Internal server error', code: 'DB_ERROR' } satisfies ApiError);
  }
});
