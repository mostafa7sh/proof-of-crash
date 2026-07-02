import { client } from './client';
import type { Block, ChainValidation, Paginated, Supply, Utxo } from '../types';
import type { TransferInput, TransferOutput } from '../utils/transaction';

// getting ledger data from the backend API
export const ledgerApi = {
  blocks(params: { page?: number; page_size?: number } = {}) {
    return client.get<Paginated<Block>>('/api/ledger', { params }).then((r) => r.data);
  },

  // retrieve the latest block from the ledger, returning the block object
  latest() {
    return client.get<Block>('/api/ledger/latest').then((r) => r.data);
  },

  // retrieve a specific block by its hash from the ledger, returning the block object
  block(blockHash: string) {
    return client.get<Block>(`/api/ledger/${blockHash}`).then((r) => r.data);
  },

  // retrieve the total supply of the ledger, returning the supply object
  supply() {
    return client.get<Supply>('/api/ledger/supply').then((r) => r.data);
  },

  // validate the integrity of the ledger, returning the validation result
  validate() {
    return client.get<ChainValidation>('/api/ledger/validate').then((r) => r.data);
  },

  // retrieve the balance of a specific address from the ledger, returning the address and its balance
  balance(address: string) {
    return client
      .get<{ address: string; balance: number }>(`/api/ledger/balance/${address}`)
      .then((r) => r.data);
  },

  // retrieve the unspent transaction outputs (UTXOs) of a specific address from the ledger, returning the address and its UTXOs
  utxos(address: string) {
    return client
      .get<{ address: string; utxos: Utxo[] }>(`/api/ledger/utxos/${address}`)
      .then((r) => r.data);
  },

  // transfer funds from one or more inputs to one or more outputs, returning the transaction ID, status, and message
  transfer(body: { inputs: TransferInput[]; outputs: TransferOutput[] }) {
    return client
      .post<{ tx_id: string; status: string; message: string }>('/api/ledger/transfer', body)
      .then((r) => r.data);
  },
};
