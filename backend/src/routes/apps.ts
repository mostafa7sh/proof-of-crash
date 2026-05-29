import { Router, Request, Response } from 'express';
import { pool } from '../config/database';
import { getEngine } from '../blockchain/instance';
import { requireAuth } from '../auth';
import type { App, ApiError } from '../types';

export const appsRouter = Router();

// POST /api/apps — upload a new application for bug testing.
// Identity is taken from the authenticated session; the developer_address
// field is no longer accepted from the body.
appsRouter.post('/', requireAuth, async (req: Request, res: Response) => {
  const { name, description, language, source_code } = req.body as {
    name?: string;
    description?: string | null;
    language?: string;
    source_code?: string;
  };
  const developer_address = req.user!.address;

  if (!name || !language || !source_code) {
    const err: ApiError = { error: 'Missing required fields: name, language, source_code', code: 'MISSING_FIELDS' };
    res.status(400).json(err);
    return;
  }

  const validLanguages = ['c', 'cpp', 'python', 'rust', 'go'];
  if (!validLanguages.includes(language)) {
    const err: ApiError = { error: `Invalid language. Allowed: ${validLanguages.join(', ')}`, code: 'INVALID_LANGUAGE' };
    res.status(400).json(err);
    return;
  }

  const client = await pool.connect();
  try {
    const contentHash = await getEngine().sha256(source_code);
    const now = Math.floor(Date.now() / 1000);

    await client.query('BEGIN');

    const appResult = await client.query<{ app_id: string }>(
      `INSERT INTO apps (developer_address, name, description, language, content_hash, uploaded_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING app_id`,
      [developer_address, name, description ?? null, language, contentHash, now]
    );

    const app_id = appResult.rows[0]?.app_id;

    await client.query(
      `INSERT INTO app_contents (content_hash, source_code, size_bytes, stored_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (content_hash) DO NOTHING`,
      [contentHash, source_code, Buffer.byteLength(source_code, 'utf8'), now]
    );

    await client.query('COMMIT');

    res.status(201).json({ app_id, content_hash: contentHash });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('POST /api/apps error:', err);
    res.status(500).json({ error: 'Internal server error', code: 'DB_ERROR' } satisfies ApiError);
  } finally {
    client.release();
  }
});

// GET /api/apps/:appId — retrieve app metadata
appsRouter.get('/:appId', async (req: Request, res: Response) => {
  const { appId } = req.params as { appId: string };

  try {
    const result = await pool.query<App>(
      `SELECT app_id, developer_address, name, description, language, content_hash, uploaded_at
       FROM apps WHERE app_id = $1`,
      [appId]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'App not found', code: 'NOT_FOUND' } satisfies ApiError);
      return;
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('GET /api/apps/:appId error:', err);
    res.status(500).json({ error: 'Internal server error', code: 'DB_ERROR' } satisfies ApiError);
  }
});
