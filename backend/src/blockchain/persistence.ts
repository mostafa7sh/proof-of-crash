import { Pool, PoolClient } from 'pg';
import type { EngineBlockData, CoinbaseTxSpec } from './CppEngine';

// ─── Persistence ─────────────────────────────────────────────────────────────
// Extracted from Blockchain.ts — persists block data from the C++ engine to PostgreSQL.

export async function persistBlockFromEngine(
  pool: Pool,
  block: EngineBlockData,
  proofIds: string[],
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Insert block
    await client.query(
      `INSERT INTO blocks (block_hash, block_number, previous_hash, merkle_root, version, timestamp)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        block.block_hash,
        block.block_number,
        block.block_number === 0 ? null : block.previous_hash,
        block.merkle_root,
        block.version,
        block.timestamp,
      ]
    );

    // Link proofs to block
    for (const proofId of proofIds) {
      await client.query(
        'INSERT INTO block_proofs (block_hash, proof_id) VALUES ($1, $2)',
        [block.block_hash, proofId]
      );
    }

    // Process each transaction
    const now = Math.floor(Date.now() / 1000);
    for (let txIdx = 0; txIdx < block.transactions.length; txIdx++) {
      const tx = block.transactions[txIdx]!;

      // Store transaction record
      await client.query(
        `INSERT INTO transactions (tx_id, tx_type, block_hash, tx_index, raw_data, created_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          tx.tx_id,
          tx.type,
          block.block_hash,
          txIdx,
          Buffer.from(JSON.stringify(tx)),  // store as JSON blob
          now,
        ]
      );

      if (tx.type === 'coinbase') {
        await persistCoinbaseOutputs(client, tx, block.block_hash, now);
      } else if (tx.type === 'transfer') {
        await persistTransferTx(client, tx, block.block_hash, now);
      }
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function persistCoinbaseOutputs(
  client: PoolClient,
  tx: EngineBlockData['transactions'][number],
  blockHash: string,
  now: number,
): Promise<void> {
  for (let idx = 0; idx < tx.outputs.length; idx++) {
    const out = tx.outputs[idx]!;
    await client.query(
      `INSERT INTO utxos
         (transaction_id, output_index, owner_address, amount,
          proof_id, creation_reason, block_hash, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [tx.tx_id, idx, out.address, out.amount, tx.proof_id, out.reason ?? 'bug_bounty', blockHash, now]
    );
  }
}

async function persistTransferTx(
  client: PoolClient,
  tx: EngineBlockData['transactions'][number],
  blockHash: string,
  now: number,
): Promise<void> {
  // Mark input UTXOs as spent
  if (tx.inputs) {
    for (const inp of tx.inputs) {
      await client.query(
        `UPDATE utxos SET is_spent = TRUE, spent_in_tx = $1
         WHERE transaction_id = $2 AND output_index = $3 AND is_spent = FALSE`,
        [tx.tx_id, inp.prev_tx_id, inp.output_index]
      );
    }
  }

  // Create output UTXOs
  for (let idx = 0; idx < tx.outputs.length; idx++) {
    const out = tx.outputs[idx]!;
    await client.query(
      `INSERT INTO utxos
         (transaction_id, output_index, owner_address, amount,
          proof_id, creation_reason, block_hash, created_at)
       VALUES ($1, $2, $3, $4, NULL, 'transfer', $5, $6)`,
      [tx.tx_id, idx, out.address, out.amount, blockHash, now]
    );
  }
}

// ─── Load block data from DB for engine replay ──────────────────────────────

interface TxRow {
  tx_id: string;
  tx_type: string;
  raw_data: Buffer;
}

export async function loadBlockDataFromDB(
  pool: Pool,
  blockNumber: number,
): Promise<{
  block_number: number;
  previous_hash: string;
  timestamp: number;
  coinbase_txs: CoinbaseTxSpec[];
  transfer_txs: Array<{
    inputs: Array<{ prev_tx_id: string; output_index: number; signature: string }>;
    outputs: Array<{ address: string; amount: number }>;
  }>;
}> {
  // Get block
  const blockResult = await pool.query<{
    previous_hash: string | null;
    timestamp: string;
  }>(
    'SELECT previous_hash, timestamp FROM blocks WHERE block_number = $1',
    [blockNumber]
  );

  if (blockResult.rows.length === 0 || !blockResult.rows[0]) {
    throw new Error(`Block #${blockNumber} not found in DB`);
  }

  const blockRow = blockResult.rows[0];

  // Get transactions
  const txResult = await pool.query<TxRow>(
    'SELECT tx_id, tx_type, raw_data FROM transactions WHERE block_hash = (SELECT block_hash FROM blocks WHERE block_number = $1) ORDER BY tx_index',
    [blockNumber]
  );

  const coinbaseTxs: CoinbaseTxSpec[] = [];
  const transferTxs: Array<{
    inputs: Array<{ prev_tx_id: string; output_index: number; signature: string }>;
    outputs: Array<{ address: string; amount: number }>;
  }> = [];

  for (const txRow of txResult.rows) {
    const data = JSON.parse(txRow.raw_data.toString()) as Record<string, unknown>;

    if (txRow.tx_type === 'coinbase') {
      coinbaseTxs.push({
        proof_id: data['proof_id'] as string,
        outputs: (data['outputs'] as Array<{ address: string; amount: number; reason: string }>).map(o => ({
          address: o.address,
          amount: o.amount,
          reason: o.reason as 'bug_bounty' | 'verification_reward',
        })),
      });
    } else if (txRow.tx_type === 'transfer') {
      transferTxs.push({
        inputs: (data['inputs'] as Array<{ prev_tx_id: string; output_index: number; signature: string }>),
        outputs: (data['outputs'] as Array<{ address: string; amount: number }>),
      });
    }
  }

  return {
    block_number: blockNumber,
    previous_hash: blockRow.previous_hash ?? '0000000000000000000000000000000000000000000000000000000000000000',
    timestamp: parseInt(blockRow.timestamp),
    coinbase_txs: coinbaseTxs,
    transfer_txs: transferTxs,
  };
}
