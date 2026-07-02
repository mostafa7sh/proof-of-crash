import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils';
import { signBytes } from './wallet';
import type { Utxo } from '../types';

// Client-side transfer construction. The serialization MUST byte-for-byte match
// the backend/engine (Transaction.ts / Transaction.cpp) or the computed txId —
// and therefore the signature — will be rejected. This is the standard role of
// a wallet: build and sign a transaction; the engine remains the source of truth.

export interface TransferInput {
  prev_tx_id: string;
  output_index: number;
  signature: string;
}
export interface TransferOutput {
  address: string;
  amount: number;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) { out.set(p, off); off += p.length; }
  return out;
}

function uint16BE(n: number): Uint8Array {
  return new Uint8Array([(n >> 8) & 0xff, n & 0xff]);
}

// 2-byte BE length prefix + UTF-8 bytes.
function serializeString(s: string): Uint8Array {
  const body = utf8ToBytes(s);
  return concat([uint16BE(body.length), body]);
}

// Amount as 8-byte BE fixed point (amount * 1e8).
function serializeAmount(amount: number): Uint8Array {
  let units = BigInt(Math.round(amount * 1e8));
  const buf = new Uint8Array(8);
  for (let i = 7; i >= 0; i--) { buf[i] = Number(units & 0xffn); units >>= 8n; }
  return buf;
}

/** Compute the unsigned transfer txId (hex) used for signing. */
export function computeTransferTxId(
  inputs: Array<{ prev_tx_id: string; output_index: number }>,
  outputs: TransferOutput[],
): string {
  const parts: Uint8Array[] = [serializeString('transfer'), uint16BE(inputs.length)];
  for (const inp of inputs) {
    parts.push(serializeString(inp.prev_tx_id));
    parts.push(uint16BE(inp.output_index));
  }
  parts.push(uint16BE(outputs.length));
  for (const out of outputs) {
    parts.push(serializeString(out.address));
    parts.push(serializeAmount(out.amount));
  }
  return bytesToHex(sha256(concat(parts)));
}

export interface BuiltTransfer {
  txId: string;
  inputs: TransferInput[];
  outputs: TransferOutput[];
}

/**
 * Select UTXOs to cover `amount`, build outputs (recipient + change, no fee),
 * compute the txId and sign each input. Returns the payload for POST /ledger/transfer.
 */
export function buildSignedTransfer(opts: {
  utxos: Utxo[];
  fromAddress: string;
  toAddress: string;
  amount: number;
  privateKeyHex: string;
}): BuiltTransfer {
  const { utxos, fromAddress, toAddress, amount, privateKeyHex } = opts;

  // Greedy coin selection (largest first) — no fees, so sum(in) must equal sum(out).
  const sorted = [...utxos].sort((a, b) => b.amount - a.amount);
  const chosen: Utxo[] = [];
  let total = 0;
  for (const u of sorted) {
    chosen.push(u);
    total += u.amount;
    if (total >= amount) break;
  }
  if (total < amount) {
    throw new Error('Insufficient balance for this transfer');
  }

  const outputs: TransferOutput[] = [{ address: toAddress, amount }];
  // Fixed-point rounding keeps change exact to 8 decimals.
  const change = Math.round((total - amount) * 1e8) / 1e8;
  if (change > 0) outputs.push({ address: fromAddress, amount: change });

  const inputRefs = chosen.map((u) => ({ prev_tx_id: u.tx_id, output_index: u.output_index }));
  const txId = computeTransferTxId(inputRefs, outputs);
  const signature = signBytes(txId, privateKeyHex);

  // Every input is owned by the same wallet here, so they share one signature
  // over the txId bytes.
  const inputs: TransferInput[] = inputRefs.map((r) => ({ ...r, signature }));
  return { txId, inputs, outputs };
}
