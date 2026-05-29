import { Pool } from 'pg';
import { CppEngine, type TransferTxSpec } from './CppEngine';

// ─── Types ───────────────────────────────────────────────────────────────────

interface AddressRow {
  public_key: string;
}

export interface TransferValidationResult {
  success: boolean;
  tx_id?: string;
  error?: string;
}

// ─── Validation ──────────────────────────────────────────────────────────────
//
// TypeScript orchestrates the *DB-side* prerequisites:
//   1. each input references an existing, registered, non-revoked address;
//   2. we attach the public key for the C++ engine to verify the signature.
//
// Everything strictly consensus — txId derivation, signature verification,
// UTXO state and conservation (sum_in == sum_out) — is the engine's job.

export async function validateAndSubmitTransfer(
  tx: {
    inputs: Array<{ prev_tx_id: string; output_index: number; signature: string }>;
    outputs: Array<{ address: string; amount: number }>;
  },
  engine: CppEngine,
  dbPool: Pool,
): Promise<TransferValidationResult> {
  if (tx.inputs.length === 0) {
    return { success: false, error: 'Transaction must have at least one input' };
  }
  if (tx.outputs.length === 0) {
    return { success: false, error: 'Transaction must have at least one output' };
  }
  for (const out of tx.outputs) {
    if (!Number.isFinite(out.amount) || out.amount <= 0) {
      return { success: false, error: 'Output amounts must be positive numbers' };
    }
  }

  // For each input, look up the owner's registered public key. The engine
  // will verify the signature itself; we just supply the key.
  const inputPublicKeys: string[] = [];
  for (const inp of tx.inputs) {
    const utxoResult = await dbPool.query<{ owner_address: string; is_spent: boolean }>(
      `SELECT owner_address, is_spent
         FROM utxos WHERE transaction_id = $1 AND output_index = $2`,
      [inp.prev_tx_id, inp.output_index],
    );
    const utxo = utxoResult.rows[0];
    if (!utxo) {
      return { success: false, error: `UTXO ${inp.prev_tx_id.slice(0, 16)}…:${inp.output_index} not found` };
    }
    if (utxo.is_spent) {
      return { success: false, error: `UTXO ${inp.prev_tx_id.slice(0, 16)}…:${inp.output_index} already spent` };
    }

    const addrResult = await dbPool.query<AddressRow>(
      `SELECT public_key FROM user_addresses
         WHERE address = $1 AND is_revoked = FALSE`,
      [utxo.owner_address],
    );
    const addrRow = addrResult.rows[0];
    if (!addrRow) {
      return { success: false, error: `No registered public key for UTXO owner ${utxo.owner_address.slice(0, 16)}…` };
    }
    inputPublicKeys.push(addrRow.public_key);
  }

  // Hand off to the engine: it recomputes txId, verifies every Ed25519
  // signature, enforces input/output conservation, and adds to the mempool.
  const spec: TransferTxSpec = {
    inputs: tx.inputs.map((inp, i) => ({
      prev_tx_id: inp.prev_tx_id,
      output_index: inp.output_index,
      signature: inp.signature,
      public_key: inputPublicKeys[i]!,
    })),
    outputs: tx.outputs.map(out => ({ address: out.address, amount: out.amount })),
  };

  try {
    const result = await engine.mempoolAdd(spec);
    return { success: true, tx_id: result.tx_id };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown engine error';
    return { success: false, error: msg };
  }
}
