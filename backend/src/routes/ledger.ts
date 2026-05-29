import { Router, Request, Response } from 'express';
import { pool } from '../config/database';
import { getEngine } from '../blockchain/instance';
import { validateAndSubmitTransfer } from '../blockchain/validateTransfer';
import { mineBlock } from '../blockchain/mining';
import { requireAuth, requireAdmin } from '../auth';
import type { Block as BlockDbRow, CrashProof, ApiError } from '../types';

export const ledgerRouter = Router();

// ─── Block Queries ────────────────────────────────────────────────────────

// GET /api/ledger/latest — most recent block (DB query, includes proof associations)
ledgerRouter.get('/latest', async (_req: Request, res: Response) => {
  try {
    const blockResult = await pool.query<BlockDbRow>(
      `SELECT block_hash, block_number, previous_hash, merkle_root, version, timestamp
       FROM blocks ORDER BY block_number DESC LIMIT 1`
    );

    if (blockResult.rows.length === 0) {
      res.status(404).json({ error: 'No blocks found', code: 'NO_BLOCKS' } satisfies ApiError);
      return;
    }

    const block = blockResult.rows[0] as BlockDbRow;
    const proofs = await getProofsInBlock(block.block_hash);

    res.json({ ...block, proofs });
  } catch (err) {
    console.error('GET /api/ledger/latest error:', err);
    res.status(500).json({ error: 'Internal server error', code: 'DB_ERROR' } satisfies ApiError);
  }
});

// GET /api/ledger/validate — walk the chain and verify every hash link (C++ engine)
ledgerRouter.get('/validate', async (_req: Request, res: Response) => {
  try {
    const engine = getEngine();
    const result = await engine.validateChain();
    res.json(result);
  } catch (err) {
    console.error('GET /api/ledger/validate error:', err);
    res.status(500).json({ error: 'Internal server error', code: 'DB_ERROR' } satisfies ApiError);
  }
});

// GET /api/ledger/supply — total PoC tokens in existence (C++ engine)
ledgerRouter.get('/supply', async (_req: Request, res: Response) => {
  try {
    const engine = getEngine();
    const totalSupply = await engine.getTotalSupply();
    const tip = await engine.getTip();
    res.json({ total_supply: totalSupply, tip });
  } catch (err) {
    console.error('GET /api/ledger/supply error:', err);
    res.status(500).json({ error: 'Internal server error', code: 'DB_ERROR' } satisfies ApiError);
  }
});

// POST /api/ledger/finalize — trigger immediate mining (admin only).
// Mining also runs automatically every BLOCK_INTERVAL_MS via the background
// timer; this manual trigger exists for operators only.
ledgerRouter.post('/finalize', requireAuth, requireAdmin, async (_req: Request, res: Response) => {
  try {
    const engine = getEngine();
    const block = await mineBlock(engine, pool);

    if (!block) {
      res.json({ message: 'Nothing to mine — no finalized proofs nor pending transfers' });
      return;
    }

    res.status(201).json({
      block_hash: block.block_hash,
      block_number: block.block_number,
      transactions: block.transactions.length,
      total_minted: block.total_minted,
    });
  } catch (err) {
    console.error('POST /api/ledger/finalize error:', err);
    res.status(500).json({ error: 'Internal server error', code: 'DB_ERROR' } satisfies ApiError);
  }
});

// ─── Token Transfers ──────────────────────────────────────────────────────

// POST /api/ledger/transfer — submit a signed transfer transaction to the mempool.
// Requires an authenticated session to broadcast. The per-input Ed25519
// signatures are still verified independently by the C++ engine against the
// UTXO owners' public keys, so the caller's session does not need to match
// any specific input (Bitcoin-style: anyone can relay a valid signed tx).
ledgerRouter.post('/transfer', requireAuth, async (req: Request, res: Response) => {
  try {
    const { inputs, outputs } = req.body as {
      inputs?: Array<{ prev_tx_id?: string; output_index?: number; signature?: string }>;
      outputs?: Array<{ address?: string; amount?: number }>;
    };

    if (!inputs || !Array.isArray(inputs) || inputs.length === 0) {
      res.status(400).json({ error: 'inputs array is required', code: 'INVALID_INPUT' } satisfies ApiError);
      return;
    }
    if (!outputs || !Array.isArray(outputs) || outputs.length === 0) {
      res.status(400).json({ error: 'outputs array is required', code: 'INVALID_INPUT' } satisfies ApiError);
      return;
    }

    // Shape-validate the incoming JSON. Transaction identity and consensus
    // rules (txId, signature verification, conservation) are enforced by the
    // C++ engine; this layer just rejects obviously malformed requests early.
    const cleanInputs: Array<{ prev_tx_id: string; output_index: number; signature: string }> = [];
    for (const inp of inputs) {
      if (typeof inp.prev_tx_id !== 'string' || typeof inp.output_index !== 'number' || typeof inp.signature !== 'string') {
        res.status(400).json({
          error: 'Each input must have prev_tx_id (string), output_index (number), and signature (string)',
          code: 'INVALID_INPUT',
        } satisfies ApiError);
        return;
      }
      cleanInputs.push({
        prev_tx_id: inp.prev_tx_id,
        output_index: inp.output_index,
        signature: inp.signature,
      });
    }

    const cleanOutputs: Array<{ address: string; amount: number }> = [];
    for (const out of outputs) {
      if (typeof out.address !== 'string' || typeof out.amount !== 'number' || out.amount <= 0) {
        res.status(400).json({
          error: 'Each output must have address (string) and amount (positive number)',
          code: 'INVALID_INPUT',
        } satisfies ApiError);
        return;
      }
      cleanOutputs.push({ address: out.address, amount: out.amount });
    }

    const engine = getEngine();
    const result = await validateAndSubmitTransfer(
      { inputs: cleanInputs, outputs: cleanOutputs },
      engine,
      pool,
    );

    if (!result.success) {
      res.status(409).json({ error: result.error ?? 'Unknown error', code: 'MEMPOOL_REJECT' } satisfies ApiError);
      return;
    }

    res.status(202).json({
      tx_id: result.tx_id,
      status: 'pending',
      message: 'Transaction accepted into mempool. Will be included in next block.',
    });
  } catch (err) {
    console.error('POST /api/ledger/transfer error:', err);
    res.status(500).json({ error: 'Internal server error', code: 'INTERNAL_ERROR' } satisfies ApiError);
  }
});

// GET /api/ledger/mempool — list pending transactions (C++ engine)
ledgerRouter.get('/mempool', async (_req: Request, res: Response) => {
  try {
    const engine = getEngine();
    const result = await engine.mempoolGetPending();
    res.json(result);
  } catch (err) {
    console.error('GET /api/ledger/mempool error:', err);
    res.status(500).json({ error: 'Internal server error', code: 'INTERNAL_ERROR' } satisfies ApiError);
  }
});

// GET /api/ledger/utxos/:address — list unspent UTXOs for an address (C++ engine)
ledgerRouter.get('/utxos/:address', async (req: Request, res: Response) => {
  const { address } = req.params as { address: string };

  try {
    const engine = getEngine();
    const utxos = await engine.getUTXOs(address);

    // Filter out UTXOs claimed by mempool transactions
    const available = [];
    for (const u of utxos) {
      const spent = await engine.mempoolIsSpent(u.tx_id, u.output_index);
      if (!spent) {
        available.push(u);
      }
    }

    res.json({ address, utxos: available });
  } catch (err) {
    console.error('GET /api/ledger/utxos error:', err);
    res.status(500).json({ error: 'Internal server error', code: 'DB_ERROR' } satisfies ApiError);
  }
});

// GET /api/ledger/tx/:txId — look up a transaction
ledgerRouter.get('/tx/:txId', async (req: Request, res: Response) => {
  const { txId } = req.params as { txId: string };

  try {
    // Check DB first
    const result = await pool.query<{
      tx_id: string;
      tx_type: string;
      block_hash: string;
      tx_index: number;
      created_at: string;
    }>(
      'SELECT tx_id, tx_type, block_hash, tx_index, created_at FROM transactions WHERE tx_id = $1',
      [txId]
    );

    if (result.rows.length > 0 && result.rows[0]) {
      const row = result.rows[0];
      res.json({ ...row, status: 'confirmed' });
      return;
    }

    // Check mempool via C++ engine
    const engine = getEngine();
    const pending = await engine.mempoolGetTx(txId);
    if (pending) {
      res.json({
        tx_id: pending.tx_id,
        tx_type: 'transfer',
        status: 'pending',
        input_count: pending.inputs.length,
        output_count: pending.outputs.length,
        total_amount: pending.total_amount,
      });
      return;
    }

    res.status(404).json({ error: 'Transaction not found', code: 'NOT_FOUND' } satisfies ApiError);
  } catch (err) {
    console.error('GET /api/ledger/tx error:', err);
    res.status(500).json({ error: 'Internal server error', code: 'DB_ERROR' } satisfies ApiError);
  }
});

// GET /api/ledger/balance/:address — unspent PoC balance (C++ engine)
ledgerRouter.get('/balance/:address', async (req: Request, res: Response) => {
  const { address } = req.params as { address: string };

  try {
    const engine = getEngine();
    const balance = await engine.getBalance(address);
    res.json({ address, balance });
  } catch (err) {
    console.error('GET /api/ledger/balance error:', err);
    res.status(500).json({ error: 'Internal server error', code: 'DB_ERROR' } satisfies ApiError);
  }
});

// GET /api/ledger/:blockHash — block by hash (DB query, includes proofs + txs)
ledgerRouter.get('/:blockHash', async (req: Request, res: Response) => {
  const { blockHash } = req.params as { blockHash: string };

  try {
    const blockResult = await pool.query<BlockDbRow>(
      `SELECT block_hash, block_number, previous_hash, merkle_root, version, timestamp
       FROM blocks WHERE block_hash = $1`,
      [blockHash]
    );

    if (blockResult.rows.length === 0) {
      res.status(404).json({ error: 'Block not found', code: 'NOT_FOUND' } satisfies ApiError);
      return;
    }

    const block = blockResult.rows[0] as BlockDbRow;
    const proofs = await getProofsInBlock(block.block_hash);

    const txResult = await pool.query<{ tx_id: string; tx_type: string; tx_index: number }>(
      'SELECT tx_id, tx_type, tx_index FROM transactions WHERE block_hash = $1 ORDER BY tx_index',
      [block.block_hash]
    );

    res.json({ ...block, proofs, transactions: txResult.rows });
  } catch (err) {
    console.error('GET /api/ledger/:blockHash error:', err);
    res.status(500).json({ error: 'Internal server error', code: 'DB_ERROR' } satisfies ApiError);
  }
});

// GET /api/ledger — paginated block list (DB query)
ledgerRouter.get('/', async (req: Request, res: Response) => {
  const { page = '1', page_size = '20' } = req.query as {
    page?: string;
    page_size?: string;
  };

  const pageNum = Math.max(1, parseInt(page));
  const size = Math.min(100, Math.max(1, parseInt(page_size)));
  const offset = (pageNum - 1) * size;

  try {
    const countResult = await pool.query<{ count: string }>('SELECT COUNT(*) as count FROM blocks');
    const total = parseInt(countResult.rows[0]?.count ?? '0');

    const rows = await pool.query<BlockDbRow>(
      `SELECT block_hash, block_number, previous_hash, merkle_root, version, timestamp
       FROM blocks ORDER BY block_number DESC
       LIMIT $1 OFFSET $2`,
      [size, offset]
    );

    res.json({ data: rows.rows, total, page: pageNum, page_size: size });
  } catch (err) {
    console.error('GET /api/ledger error:', err);
    res.status(500).json({ error: 'Internal server error', code: 'DB_ERROR' } satisfies ApiError);
  }
});

// ─── Helpers ──────────────────────────────────────────────────────────────

async function getProofsInBlock(blockHash: string): Promise<CrashProof[]> {
  const result = await pool.query<CrashProof>(
    `SELECT cp.proof_id, cp.app_id, cp.tester_address, cp.content_hash,
            cp.status, cp.voting_deadline, cp.reward_score, cp.finalized_at, cp.submitted_at
     FROM crash_proofs cp
     INNER JOIN block_proofs bp ON bp.proof_id = cp.proof_id
     WHERE bp.block_hash = $1
     ORDER BY cp.finalized_at ASC`,
    [blockHash]
  );
  return result.rows;
}
