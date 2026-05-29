import { Pool, PoolClient } from 'pg';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

dotenv.config();

export const pool = new Pool({
  host:     process.env['DB_HOST']     ?? 'localhost',
  port:     parseInt(process.env['DB_PORT'] ?? '5432'),
  database: process.env['DB_NAME']     ?? 'proof_of_crash',
  user:     process.env['DB_USER']     ?? 'poc_user',
  password: process.env['DB_PASSWORD'] ?? '',
  max: 20,                    // max pool size
  idleTimeoutMillis: 30_000,  // close idle connections after 30s
  connectionTimeoutMillis: 5_000,
});

pool.on('error', (err) => {
  console.error('Unexpected database pool error:', err);
  process.exit(1);
});

// Run schema.sql on startup — idempotent (all statements use IF NOT EXISTS)
export async function initializeSchema(): Promise<void> {
  const schemaPath = path.join(__dirname, '../db/schema.sql');
  const sql = fs.readFileSync(schemaPath, 'utf8');
  const client: PoolClient = await pool.connect();
  try {
    await client.query(sql);
    console.log('Database schema initialized.');
  } finally {
    client.release();
  }
}

// Verify the pool can connect before the server starts
export async function checkConnection(): Promise<void> {
  const client: PoolClient = await pool.connect();
  try {
    await client.query('SELECT 1');
    console.log('Database connection verified.');
  } finally {
    client.release();
  }
}
