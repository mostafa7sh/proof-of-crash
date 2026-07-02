// ─── Core Blockchain Types ─────────────────────────────────────────────────

export interface Block {
  block_hash: string;       // hex(SHA256(SHA256(serialized_header))) — NOT stored in block itself
  block_number: number;
  previous_hash: string | null; // null only for genesis block
  merkle_root: string;
  version: number;
  timestamp: number;        // Unix seconds
}

export interface BlockHeader {
  version: number;
  previous_block_hash: string;
  merkle_root: string;
  timestamp: number;
  consensus_threshold: number; // fraction required, e.g. 0.667
}

// ─── Transactions & UTXO ──────────────────────────────────────────────────

export type RewardReason = 'bug_bounty' | 'verification_reward' | 'transfer';

export interface UTXO {
  utxo_id: string;
  transaction_id: string;   // hex(SHA256(tx_content))
  output_index: number;
  owner_address: string;
  amount: number;           // PoC tokens (8 decimal precision)
  proof_id: string | null;  // source crash proof
  creation_reason: RewardReason;
  block_hash: string;
  is_spent: boolean;
  spent_in_tx: string | null;
  created_at: number;
}

// ─── Identity & Authentication ────────────────────────────────────────────

export interface User {
  primary_address: string;  // hex(SHA256(primary_public_key))
  reputation: number;
  created_at: number;
}

export interface UserAddress {
  address: string;          // hex(SHA256(public_key))
  user_primary_address: string;
  public_key: string;       // hex-encoded Ed25519 public key (64 hex chars)
  registered_at: number;
  is_revoked: boolean;
  revoked_at: number | null;
  registration_signature: string;
}

export interface AuthChallenge {
  challenge: string;        // hex(random 32 bytes)
  address: string;
  expires_at: number;
  used: boolean;
  created_at: number;
}

// ─── Apps ─────────────────────────────────────────────────────────────────

export type Language = 'c' | 'cpp' | 'python' | 'rust' | 'go';

export interface App {
  app_id: string;
  developer_address: string;
  name: string;
  description: string | null;
  language: Language;
  content_hash: string;     // hex(SHA256(source_code))
  uploaded_at: number;
}

export interface AppContent {
  content_hash: string;
  source_code: string;
  size_bytes: number;
  stored_at: number;
}

// ─── Crash Proofs ─────────────────────────────────────────────────────────

export type ProofStatus = 'pending' | 'voting' | 'finalized' | 'rejected' | 'archived';
export type InputFormat = 'stdin' | 'argv' | 'file' | 'binary';

export interface CrashProof {
  proof_id: string;         // hex(SHA256(content_hash || app_id || tester_address || submitted_at))
  app_id: string;
  tester_address: string;
  content_hash: string;     // hex(SHA256(crash_input)) — references proof_contents
  status: ProofStatus;
  voting_deadline: number | null;
  reward_score: number | null; // Final median (0.10–10.00)
  finalized_at: number | null;
  submitted_at: number;
}

export interface ProofContent {
  content_hash: string;
  crash_input: Buffer;      // raw binary crash input
  input_format: InputFormat;
  input_size: number;
  stored_at: number;
}

// ─── Verifications ────────────────────────────────────────────────────────

export interface Verification {
  verification_id: string;
  proof_id: string;
  verifier_address: string;
  score: number;            // 0.10–10.00 (CVSS-like)
  exit_code: number | null;
  signal_number: number | null;
  stdout_preview: string | null;
  stderr_preview: string | null;
  duration_ms: number | null;
  crashed: boolean | null;
  signature: string;        // hex(Ed25519.sign(proof_id || score_bytes || signed_at))
  signed_at: number;
}

// ─── AI Verifications ─────────────────────────────────────────────────────

export interface AIVerification {
  ai_verification_id: string;
  proof_id: string;
  model: string;            // provider id: 'chatgpt' | 'gemini' | 'deepseek'
  approved: boolean;        // whether this model approved the proof
  confidence_score: number; // 0.000–1.000
  reasoning: string | null;
  request_hash: string;     // hash of the prompt sent (for reproducibility audit)
  queried_at: number;
}

// ─── Reward Calculation ───────────────────────────────────────────────────

export interface VerifierScoreEntry {
  verifier_address: string;
  score: number;
}

export interface RewardDistribution {
  base_reward: number;      // fixed block reward (BLOCK_REWARD, e.g. 1000)
  finder_reward: number;    // 70% of base_reward
  verifier_pool: number;    // 30% of base_reward, shared by all validators
  verifier_payouts: Array<{
    address: string;
    reward: number;         // share of the pool, weighted by closeness to the median
    distance: number;       // |score - median|
  }>;
}

// ─── API Request/Response Shapes ──────────────────────────────────────────

export interface ApiError {
  error: string;
  code: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  page_size: number;
}
