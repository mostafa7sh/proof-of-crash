// API models — mirror the backend response shapes.

export type ProofStatus = 'pending' | 'voting' | 'finalized' | 'rejected' | 'archived';
export type InputFormat = 'stdin' | 'argv' | 'file' | 'binary';
export type Language = 'c' | 'cpp' | 'python' | 'rust' | 'go';

export interface Wallet {
  address: string;       // hex(SHA256(publicKey))
  publicKey: string;     // 64 hex chars
  privateKey: string;    // 64 hex chars — held in memory only, never persisted
}

export interface AuthUserAddress {
  address: string;
  registered_at: number;
  is_revoked: boolean;
}

export interface AuthUser {
  user_id: string | null;   // stable opaque account id (WebAuthn userHandle)
  primary_address: string;
  address: string;
  reputation: number;
  created_at: number | null;
  passkey_count: number;    // number of passkeys registered on this account

  registered_at: number | null;
  is_revoked: boolean;
  addresses: AuthUserAddress[];
}

export interface AuthSession {
  primary_address: string;
  address: string;
  token: string;
  expires_at: number;
  refresh_token: string;
  refresh_expires_at: number;
}

export interface ChallengeResponse {
  challenge: string;
  expires_at: number;
  pow_difficulty: number;   // leading-zero bits to solve before register/login
}

export interface App {
  app_id: string;
  developer_address: string;
  name: string;
  description: string | null;
  language: Language;
  content_hash: string;
  uploaded_at: number;
}

// App metadata + its full source code (GET /api/apps/:id/source).
export interface AppSource extends App {
  source_code: string;
  size_bytes: number;
}

export interface CrashProof {
  proof_id: string;
  app_id: string;
  tester_address: string;
  content_hash: string;
  status: ProofStatus;
  voting_deadline: number | null;
  reward_score: number | null;
  finalized_at: number | null;
  submitted_at: number;
}

// The actual crash input bytes behind a proof (GET /api/proofs/:id/content).
export interface ProofContent {
  proof_id: string;
  content_hash: string;
  input_format: InputFormat;
  input_size: number;
  crash_input_hex: string;
}

export interface Verification {
  verification_id: string;
  proof_id: string;
  verifier_address: string;
  score: number | null;   // sealed (null) until the proof is finalized
  exit_code: number | null;
  signal_number: number | null;
  stdout_preview: string | null;
  stderr_preview: string | null;
  duration_ms: number | null;
  crashed: boolean | null;
  signature: string;
  signed_at: number;
}

export interface VerificationSummary {
  data: Verification[];
  proof_id: string;
  scores_sealed: boolean;        // true while voting — median + scores withheld
  vote_count: number;
  current_median: number | null; // null until finalized (blind review)
  agreeing_count: number;
  dissenting_count: number;
  consensus_reached: boolean;
  outlier_threshold: number;
  min_verifications: number;
}

export type RewardReason = 'bug_bounty' | 'verification_reward' | 'transfer';

export interface TxOutput {
  address: string;
  amount: number;
  reason?: RewardReason | null;
}

export interface BlockTransaction {
  tx_id: string;
  tx_type: string;             // 'coinbase' | 'transfer'
  tx_index: number;
  proof_id?: string | null;
  outputs: TxOutput[];
  inputs?: Array<{ prev_tx_id: string; output_index: number }>;
}

export interface Block {
  block_hash: string;
  block_number: string | number;
  previous_hash: string | null;
  merkle_root: string;
  version: number;
  timestamp: string | number;
  proof_count?: number;   // present in the ledger list; lets the UI label block type
  tx_count?: number;      // present in the ledger list; total txs (coinbase + transfer)
  ai_verified?: boolean;  // every proof approved by all AI models (advisory badge)
  proofs?: CrashProof[];
  transactions?: BlockTransaction[];
}

// ─── AI Model Review (advisory) ───────────────────────────────────────────

export type AiModelId = 'chatgpt' | 'gemini' | 'deepseek';

export interface AiVerification {
  model: string;             // provider id: 'chatgpt' | 'gemini' | 'deepseek'
  approved: boolean;
  confidence_score: number;  // 0.000–1.000
  reasoning: string | null;
  queried_at: number;
}

export interface AiVerificationSummary {
  proof_id: string;
  required: number;          // models that must approve (all of them)
  approved_count: number;
  ai_verified: boolean;      // approved_count >= required
  data: AiVerification[];
}

export interface Supply {
  total_supply: number;
  tip: { hash: string; height: number };
}

export interface ChainValidation {
  valid: boolean;
  height: number;
  error?: string;
}

export interface Utxo {
  tx_id: string;
  output_index: number;
  amount: number;
}

export interface Paginated<T> {
  data: T[];
  total: number;
  page: number;
  page_size: number;
}

// Submission pipeline ("mempool") — the staging area before the blockchain.
export interface PendingSubmission {
  app_id: string;
  name: string;
  developer_address: string;
  language: string;
  uploaded_at: number;
}

export interface PipelineProof {
  proof_id: string;
  app_id: string;
  app_name: string;
  tester_address: string;
  content_hash: string;
  submitted_at: number;
  voting_deadline: number;
  vote_count: number;
  current_median: number | null;
  agreeing_count: number;
  dissenting_count: number;
  min_verifications: number;
  consensus_reached: boolean;
}

export interface MempoolPipeline {
  pending_submissions: PendingSubmission[];
  under_review: PipelineProof[];
  ready_for_block: PipelineProof[];
  counts: { pending: number; under_review: number; ready: number };
}

// Leaderboard — extensible list of ranking categories (GET /api/leaderboard).
export interface LeaderboardEntry {
  address: string;
  value: number;
}

export interface LeaderboardCategory {
  key: string;
  title: string;
  description: string;
  unit: string;            // 'POC' | 'proofs' | 'bugs' | …
  entries: LeaderboardEntry[];
}

export interface Leaderboard {
  categories: LeaderboardCategory[];
}

export interface ApiError {
  error: string;
  code: string;
}
