import { Router, Request, Response } from 'express';
import { pool } from '../config/database';
import { getEngine } from '../blockchain/instance';
import { requireAuth, sameAccount } from '../auth';
import { isUuid } from '../utils/uuid';
import { AI_MODELS, AI_REQUIRED_APPROVALS } from '../config/ai';
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

  // app_id is a Postgres UUID — reject malformed ids up front with a precise
  // message rather than letting the type cast throw a generic 500.
  if (!isUuid(app_id)) {
    res.status(400).json({ error: 'Invalid target application UUID format.', code: 'INVALID_UUID' } satisfies ApiError);
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
    // Verify the target application exists before staging a proof against it.
    const appCheck = await client.query<{ developer_address: string }>(
      'SELECT developer_address FROM apps WHERE app_id = $1',
      [app_id],
    );
    if (appCheck.rows.length === 0) {
      res.status(404).json({ error: 'No application exists with this UUID. Check the target App ID and try again.', code: 'APP_NOT_FOUND' } satisfies ApiError);
      return;
    }

    // The developer who uploaded the code cannot file a proof against it — and
    // "developer" means the ACCOUNT, so a second key on the same account can't
    // be used to prove a bug in one's own code.
    if (await sameAccount(pool, appCheck.rows[0]!.developer_address, tester_address)) {
      res.status(403).json({ error: 'You cannot submit a proof against your own code submission.', code: 'SELF_PROOF' } satisfies ApiError);
      return;
    }

    // An application is closed once one of its proofs has been accepted into the
    // ledger — only the accepted proof remains, so no further proofs are taken.
    const finalizedCheck = await client.query(
      `SELECT 1 FROM crash_proofs WHERE app_id = $1 AND status = 'finalized' LIMIT 1`,
      [app_id],
    );
    if ((finalizedCheck.rowCount ?? 0) > 0) {
      res.status(409).json({ error: 'This application already has an accepted proof and is closed to new submissions.', code: 'APP_FINALIZED' } satisfies ApiError);
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

// GET /api/proofs/:proofId/content — the actual crash input bytes (hex).
// Public so every reviewer can inspect what is being voted on: validators
// cannot meaningfully verify a proof they cannot see.
proofsRouter.get('/:proofId/content', async (req: Request, res: Response) => {
  const { proofId } = req.params as { proofId: string };

  try {
    const result = await pool.query<{
      proof_id: string;
      content_hash: string;
      crash_input: Buffer;
      input_format: string;
      input_size: number;
    }>(
      `SELECT cp.proof_id, cp.content_hash, pc.crash_input, pc.input_format, pc.input_size
         FROM crash_proofs cp
         JOIN proof_contents pc ON pc.content_hash = cp.content_hash
        WHERE cp.proof_id = $1`,
      [proofId],
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Proof content not found', code: 'NOT_FOUND' } satisfies ApiError);
      return;
    }

    const row = result.rows[0]!;
    res.json({
      proof_id: row.proof_id,
      content_hash: row.content_hash,
      input_format: row.input_format,
      input_size: row.input_size,
      crash_input_hex: row.crash_input.toString('hex'),
    });
  } catch (err) {
    console.error('GET /api/proofs/:proofId/content error:', err);
    res.status(500).json({ error: 'Internal server error', code: 'DB_ERROR' } satisfies ApiError);
  }
});

// GET /api/proofs/:proofId/ai-verifications — the advisory AI model review.
// Public so anyone can see how the three models (ChatGPT / Gemini / DeepSeek)
// judged this proof. `ai_verified` is true only when ALL required models
// approved; it never gates the ledger (human consensus does).
proofsRouter.get('/:proofId/ai-verifications', async (req: Request, res: Response) => {
  const { proofId } = req.params as { proofId: string };

  try {
    const result = await pool.query<{
      model: string;
      approved: boolean;
      confidence_score: string;
      reasoning: string | null;
      queried_at: string;
    }>(
      `SELECT model, approved, confidence_score::text AS confidence_score, reasoning, queried_at
         FROM ai_verifications WHERE proof_id = $1`,
      [proofId],
    );

    // Order by the canonical model list so the UI is stable regardless of insert
    // order; coerce the NUMERIC confidence (pg returns it as a string).
    const byModel = new Map(result.rows.map((r) => [r.model, r]));
    const data = AI_MODELS
      .map((m) => byModel.get(m.id))
      .filter((r): r is NonNullable<typeof r> => r !== undefined)
      .map((r) => ({
        model: r.model,
        approved: r.approved,
        confidence_score: parseFloat(r.confidence_score),
        reasoning: r.reasoning,
        queried_at: parseInt(r.queried_at),
      }));

    const approvedCount = data.filter((r) => r.approved).length;

    res.json({
      proof_id: proofId,
      required: AI_REQUIRED_APPROVALS,
      approved_count: approvedCount,
      ai_verified: data.length >= AI_REQUIRED_APPROVALS && approvedCount >= AI_REQUIRED_APPROVALS,
      data,
    });
  } catch (err) {
    console.error('GET /api/proofs/:proofId/ai-verifications error:', err);
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
  } else {
    // Rejected proofs are clutter — never surface them in the default feed.
    conditions.push(`status <> 'rejected'`);
  }
  if (app_id) {
    if (!isUuid(app_id)) {
      res.status(400).json({ error: 'Invalid application UUID format.', code: 'INVALID_UUID' } satisfies ApiError);
      return;
    }
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
