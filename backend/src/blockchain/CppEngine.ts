import { ChildProcess, spawn } from 'child_process';
import { createInterface, Interface } from 'readline';
import path from 'path';

// ─── Types ───────────────────────────────────────────────────────────────────

interface EngineResponse {
  id: number;
  ok: boolean;
  result?: Record<string, unknown>;
  error?: string;
}

export interface CoinbaseTxSpec {
  proof_id: string;
  outputs: Array<{
    address: string;
    amount: number;
    reason: 'bug_bounty' | 'verification_reward';
  }>;
}

export interface TransferTxSpec {
  tx_id?: string;
  inputs: Array<{
    prev_tx_id: string;
    output_index: number;
    signature: string;
    public_key?: string;  // required for mempool_add; omitted during load_block replay
  }>;
  outputs: Array<{
    address: string;
    amount: number;
  }>;
}

export interface EngineBlockData {
  block_number: number;
  block_hash: string;
  previous_hash: string;
  merkle_root: string;
  version: number;
  timestamp: number;
  total_minted: number;
  transactions: Array<{
    type: 'coinbase' | 'transfer';
    tx_id: string;
    proof_id?: string;
    inputs?: Array<{
      prev_tx_id: string;
      output_index: number;
      signature: string;
    }>;
    outputs: Array<{
      address: string;
      amount: number;
      reason?: string;
    }>;
  }>;
}

export interface AddBlockResult {
  block: EngineBlockData;
  drained_tx_ids: string[];
}

export interface EngineUTXO {
  tx_id: string;
  output_index: number;
  amount: number;
}

export interface PendingTxSummary {
  tx_id: string;
  input_count: number;
  output_count: number;
  total_amount: number;
}

export interface TransferTxData {
  found: boolean;
  tx_id: string;
  inputs: Array<{
    prev_tx_id: string;
    output_index: number;
    signature: string;
  }>;
  outputs: Array<{
    address: string;
    amount: number;
  }>;
  total_amount: number;
}

export interface VerifierVoteSpec {
  address: string;
  score: number;
}

export interface CoinbaseBuildResult {
  coinbase_tx: CoinbaseTxSpec;
  tx_id: string;
  median_score: number;
  base_reward: number;
  finder_reward: number;
  verifier_max_per: number;
  total_minted: number;
  payouts: Array<{
    address: string;
    score: number;
    distance: number;
    reward: number;
  }>;
}

export interface ConsensusStatus {
  vote_count: number;
  median: number | null;       // null when there are no votes
  agreeing_count: number;       // votes within outlier_threshold of the median
  dissenting_count: number;
  consensus_reached: boolean;   // quorum AND strict majority agreement
  outlier_threshold: number;
  min_verifications: number;
}

// ─── CppEngine ───────────────────────────────────────────────────────────────

const DEFAULT_ENGINE_PATH = path.join(__dirname, '../../../cpp/build/poc_engine');

/**
 * Wraps the C++ blockchain engine as a child process.
 * Communicates via newline-delimited JSON on stdin/stdout.
 */
export class CppEngine {
  private process: ChildProcess | null = null;
  private rl: Interface | null = null;
  private nextId = 1;
  private pending = new Map<
    number,
    {
      resolve: (value: EngineResponse) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  private ready = false;

  private readonly enginePath: string;
  private readonly timeout: number;

  constructor(enginePath?: string, timeout = 10_000) {
    this.enginePath = enginePath ?? process.env['CPP_ENGINE_PATH'] ?? DEFAULT_ENGINE_PATH;
    this.timeout = timeout;
  }

  // ─── Lifecycle ─────────────────────────────────────────────────────────

  async spawn(): Promise<void> {
    if (this.process) {
      throw new Error('Engine already spawned');
    }

    this.process = spawn(this.enginePath, [], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    // Pipe stderr to console for diagnostics
    this.process.stderr?.on('data', (data: Buffer) => {
      process.stderr.write(data);
    });

    // Set up readline on stdout for response parsing
    this.rl = createInterface({ input: this.process.stdout! });
    this.rl.on('line', (line: string) => {
      this.handleLine(line);
    });

    // Handle unexpected exit
    this.process.on('exit', (code, signal) => {
      if (this.ready) {
        console.error(
          `[CppEngine] Process exited unexpectedly: code=${code}, signal=${signal}`,
        );
      }
      this.ready = false;
      this.rejectAll(new Error(`Engine process exited: code=${code}, signal=${signal}`));
      this.process = null;
      this.rl = null;
    });

    this.process.on('error', (err) => {
      console.error(`[CppEngine] Process error: ${err.message}`);
      this.ready = false;
      this.rejectAll(err);
    });

    this.ready = true;
  }

  async shutdown(): Promise<void> {
    if (!this.process) return;
    try {
      await this.call('shutdown', {});
    } catch {
      // If shutdown command fails, force kill
    }
    this.ready = false;
    if (this.process && !this.process.killed) {
      this.process.kill('SIGTERM');
    }
    this.process = null;
    this.rl = null;
  }

  isReady(): boolean {
    return this.ready && this.process !== null;
  }

  // ─── Low-level send/receive ────────────────────────────────────────────

  private handleLine(line: string): void {
    try {
      const resp: EngineResponse = JSON.parse(line) as EngineResponse;
      const entry = this.pending.get(resp.id);
      if (entry) {
        clearTimeout(entry.timer);
        this.pending.delete(resp.id);
        entry.resolve(resp);
      }
    } catch {
      console.error(`[CppEngine] Failed to parse response: ${line.substring(0, 200)}`);
    }
  }

  private rejectAll(error: Error): void {
    for (const [, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.reject(error);
    }
    this.pending.clear();
  }

  private send(cmd: string, params: Record<string, unknown>): Promise<EngineResponse> {
    if (!this.process?.stdin?.writable) {
      return Promise.reject(new Error('Engine not available'));
    }

    const id = this.nextId++;
    const request = JSON.stringify({ id, cmd, params });

    return new Promise<EngineResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Engine command '${cmd}' timed out after ${this.timeout}ms`));
      }, this.timeout);

      this.pending.set(id, { resolve, reject, timer });
      this.process!.stdin!.write(request + '\n');
    });
  }

  private async call<T = Record<string, unknown>>(
    cmd: string,
    params: Record<string, unknown>,
  ): Promise<T> {
    const resp = await this.send(cmd, params);
    if (!resp.ok) {
      throw new Error(`Engine error (${cmd}): ${resp.error ?? 'unknown'}`);
    }
    return resp.result as T;
  }

  // ─── Typed API Methods ─────────────────────────────────────────────────

  async initialize(
    timestamp?: number,
  ): Promise<{ tip_hash: string; tip_height: number; genesis_block?: EngineBlockData }> {
    return this.call('initialize', { timestamp: timestamp ?? 0 });
  }

  async getTip(): Promise<{ hash: string; height: number }> {
    return this.call('get_tip', {});
  }

  async addBlock(
    coinbaseTxs: CoinbaseTxSpec[],
    timestamp?: number,
    maxTransferTxs?: number,
  ): Promise<AddBlockResult | null> {
    const result = await this.call<{ block: EngineBlockData | null; drained_tx_ids: string[] }>(
      'add_block',
      {
        coinbase_txs: coinbaseTxs,
        timestamp: timestamp ?? 0,
        max_transfer_txs: maxTransferTxs ?? 100,
      },
    );
    return result.block ? { block: result.block, drained_tx_ids: result.drained_tx_ids } : null;
  }

  async loadBlock(params: {
    block_number: number;
    previous_hash: string;
    timestamp: number;
    coinbase_txs: CoinbaseTxSpec[];
    transfer_txs: TransferTxSpec[];
  }): Promise<{ block_hash: string; tip_height: number }> {
    return this.call('load_block', params as unknown as Record<string, unknown>);
  }

  async mempoolAdd(
    tx: TransferTxSpec,
  ): Promise<{ tx_id: string; mempool_size: number }> {
    return this.call('mempool_add', tx as unknown as Record<string, unknown>);
  }

  async mempoolGetPending(): Promise<{
    pending_count: number;
    transactions: PendingTxSummary[];
  }> {
    return this.call('mempool_get_pending', {});
  }

  async mempoolGetTx(txId: string): Promise<TransferTxData | null> {
    const result = await this.call<TransferTxData>('mempool_get_tx', { tx_id: txId });
    return result.found ? result : null;
  }

  async mempoolIsSpent(prevTxId: string, outputIndex: number): Promise<boolean> {
    const result = await this.call<{ is_spent: boolean }>('mempool_is_spent', {
      prev_tx_id: prevTxId,
      output_index: outputIndex,
    });
    return result.is_spent;
  }

  async getBalance(address: string): Promise<number> {
    const result = await this.call<{ address: string; balance: number }>('get_balance', {
      address,
    });
    return result.balance;
  }

  async getUTXOs(address: string): Promise<EngineUTXO[]> {
    const result = await this.call<{ address: string; utxos: EngineUTXO[] }>('get_utxos', {
      address,
    });
    return result.utxos;
  }

  async getTotalSupply(): Promise<number> {
    const result = await this.call<{ total_supply: number }>('get_total_supply', {});
    return result.total_supply;
  }

  async validateChain(): Promise<{ valid: boolean; height: number; error?: string }> {
    return this.call('validate_chain', {});
  }

  async getBlockByHash(hash: string): Promise<EngineBlockData | null> {
    const result = await this.call<EngineBlockData & { found: boolean }>('get_block_by_hash', {
      hash,
    });
    return result.found ? result : null;
  }

  async getBlockByNumber(num: number): Promise<EngineBlockData | null> {
    const result = await this.call<EngineBlockData & { found: boolean }>('get_block_by_number', {
      number: num,
    });
    return result.found ? result : null;
  }

  // ─── Crypto Primitives (single source of truth in C++) ──────────────────

  /**
   * SHA-256 of raw bytes. The buffer is hex-encoded for transport since JSON
   * has no native binary type.
   */
  async sha256(data: Buffer | string): Promise<string> {
    const buf = typeof data === 'string' ? Buffer.from(data, 'utf8') : data;
    const result = await this.call<{ hash: string }>('sha256', {
      data_hex: buf.toString('hex'),
    });
    return result.hash;
  }

  /** Verify an Ed25519 signature. All arguments are lowercase hex. */
  async verifyEd25519(
    messageHex: string,
    signatureHex: string,
    publicKeyHex: string,
  ): Promise<boolean> {
    const result = await this.call<{ valid: boolean }>('verify_ed25519', {
      message_hex: messageHex,
      signature_hex: signatureHex,
      public_key_hex: publicKeyHex,
    });
    return result.valid;
  }

  // ─── Consensus (single source of truth in C++) ──────────────────────────

  /**
   * Compute median-based reward distribution for a finalized proof and build
   * a coinbase transaction spec. All reward math lives in the C++ engine.
   */
  async buildCoinbase(
    proofId: string,
    finderAddress: string,
    votes: VerifierVoteSpec[],
  ): Promise<CoinbaseBuildResult> {
    return this.call<CoinbaseBuildResult>('build_coinbase', {
      proof_id: proofId,
      finder_address: finderAddress,
      votes,
    });
  }

  /** Check whether a proof is ready to finalize (votes + deadline). */
  async checkFinalization(
    voteCount: number,
    votingDeadline: number,
    nowSeconds?: number,
  ): Promise<{ can_finalize: boolean; reason: string }> {
    return this.call('check_finalization', {
      vote_count: voteCount,
      voting_deadline: votingDeadline,
      now_seconds: nowSeconds ?? 0,
    });
  }

  /**
   * Deterministic agreement status for a proof's votes. Consensus is reached
   * when a quorum (>= min_verifications) exists AND a strict majority of votes
   * fall within outlier_threshold of the median. Same primitives the reward
   * engine uses, so this can never disagree with reward distribution.
   */
  async consensusStatus(votes: VerifierVoteSpec[]): Promise<ConsensusStatus> {
    return this.call<ConsensusStatus>('consensus_status', { votes });
  }
}
