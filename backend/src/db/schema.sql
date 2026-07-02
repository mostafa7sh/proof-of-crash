-- ─────────────────────────────────────────────────────────────────────────
-- PROOF OF CRASH — Database Schema
-- Bitcoin-style cryptographic identity, UTXO token model
-- ─────────────────────────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ─── Identity ─────────────────────────────────────────────────────────────

-- Users: no username, no email — identity is a cryptographic address.
-- primary_address stays the account anchor (every account has >=1 Ed25519
-- signing key; passkeys are a session-only convenience layered on top, never a
-- standalone account). user_id is a stable opaque account id, used e.g. as the
-- WebAuthn userHandle so credentials never embed an address/PII.
CREATE TABLE IF NOT EXISTS users (
  primary_address  TEXT    PRIMARY KEY,     -- hex(SHA256(primary_public_key))
  reputation       DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
  created_at       BIGINT  NOT NULL          -- Unix timestamp
);

-- Phase-1 account anchor (additive; idempotent for existing databases).
ALTER TABLE users ADD COLUMN IF NOT EXISTS user_id UUID NOT NULL DEFAULT gen_random_uuid();
CREATE UNIQUE INDEX IF NOT EXISTS users_user_id_key ON users(user_id);

-- Multiple keys per user (different devices, key rotation)
CREATE TABLE IF NOT EXISTS user_addresses (
  address                 TEXT    PRIMARY KEY,  -- hex(SHA256(public_key))
  user_primary_address    TEXT    NOT NULL REFERENCES users(primary_address) ON DELETE CASCADE,
  public_key              TEXT    NOT NULL UNIQUE,  -- hex-encoded Ed25519 public key
  registered_at           BIGINT  NOT NULL,
  is_revoked              BOOLEAN NOT NULL DEFAULT FALSE,
  revoked_at              BIGINT,
  registration_signature  TEXT    NOT NULL  -- primary key signs: address || public_key || registered_at
);

CREATE INDEX IF NOT EXISTS idx_user_addresses_primary
  ON user_addresses(user_primary_address);

-- Login challenge-response (random nonce, single-use, expires in 120s — see
-- CHALLENGE_TTL_SECONDS in backend/src/auth/challenges.ts)
CREATE TABLE IF NOT EXISTS auth_challenges (
  challenge   TEXT    PRIMARY KEY,  -- hex(random 32 bytes)
  address     TEXT    NOT NULL,     -- address requesting challenge
  expires_at  BIGINT  NOT NULL,
  used        BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  BIGINT  NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_auth_challenges_expires
  ON auth_challenges(expires_at);

-- ─── WebAuthn (passkey) — session-only credentials ────────────────────────
-- Passkeys authenticate a SESSION only; they never sign blockchain txs. Every
-- account still has >=1 Ed25519 signing key (see users.user_id).
CREATE TABLE IF NOT EXISTS webauthn_credentials (
  credential_id  TEXT    PRIMARY KEY,            -- base64url credential id
  user_id        UUID    NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  public_key     BYTEA   NOT NULL,               -- COSE public key
  counter        BIGINT  NOT NULL DEFAULT 0,     -- signature counter (replay defence)
  device_type    TEXT,                            -- 'singleDevice' | 'multiDevice'
  backed_up      BOOLEAN NOT NULL DEFAULT FALSE,
  transports     TEXT,                            -- JSON array
  label          TEXT,
  created_at     BIGINT  NOT NULL,
  last_used_at   BIGINT
);
CREATE INDEX IF NOT EXISTS idx_webauthn_credentials_user ON webauthn_credentials(user_id);

-- Short-lived, single-use WebAuthn ceremony challenges (address-less). The
-- two-request ceremony is correlated by an opaque flow_id handed to the client.
CREATE TABLE IF NOT EXISTS webauthn_challenges (
  flow_id     UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID,                               -- set for registration; NULL for usernameless auth
  kind        TEXT    NOT NULL CHECK (kind IN ('register', 'authenticate')),
  challenge   TEXT    NOT NULL,                    -- base64url
  expires_at  BIGINT  NOT NULL,
  used        BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  BIGINT  NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_webauthn_challenges_expires ON webauthn_challenges(expires_at);

-- ─── Session Hardening (auth tokens) ──────────────────────────────────────

-- Per-address "revoke all" cutoff: any access token whose iat is < this value
-- is rejected. Set to now() to invalidate every outstanding token at once.
ALTER TABLE user_addresses
  ADD COLUMN IF NOT EXISTS tokens_valid_after BIGINT NOT NULL DEFAULT 0;

-- Single-token (jti) denylist for fine-grained access-token revocation.
-- expires_at lets a sweeper drop rows once the token would have expired anyway.
CREATE TABLE IF NOT EXISTS revoked_jtis (
  jti         TEXT    PRIMARY KEY,   -- JWT ID claim (hex(random 16 bytes))
  address     TEXT    NOT NULL,      -- address the token was issued to
  revoked_at  BIGINT  NOT NULL,
  expires_at  BIGINT  NOT NULL,      -- original token expiry (for cleanup)
  reason      TEXT
);

CREATE INDEX IF NOT EXISTS idx_revoked_jtis_expires ON revoked_jtis(expires_at);

-- Refresh tokens. Only the SHA-256 hash of the token is stored, so a DB leak
-- does not expose usable tokens. Rotation: each use issues a new token and
-- marks the old one used; presenting an already-used token triggers family
-- revocation (reuse detection).
CREATE TABLE IF NOT EXISTS refresh_tokens (
  token_hash       TEXT    PRIMARY KEY,  -- hex(SHA256(token))
  address          TEXT    NOT NULL,
  primary_address  TEXT    NOT NULL,
  issued_at        BIGINT  NOT NULL,
  expires_at       BIGINT  NOT NULL,
  used             BOOLEAN NOT NULL DEFAULT FALSE,
  revoked          BOOLEAN NOT NULL DEFAULT FALSE,
  rotated_to       TEXT,                 -- token_hash of the successor (audit chain)
  created_at       BIGINT  NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_address ON refresh_tokens(address);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_expires ON refresh_tokens(expires_at);

-- ─── Applications ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS apps (
  app_id            UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  developer_address TEXT    NOT NULL,
  name              TEXT    NOT NULL
    CHECK (length(name) BETWEEN 1 AND 255),
  description       TEXT,
  language          TEXT    NOT NULL
    CHECK (language IN ('c', 'cpp', 'python', 'rust', 'go')),
  content_hash      TEXT    NOT NULL,  -- hex(SHA256(source_code))
  uploaded_at       BIGINT  NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_apps_developer   ON apps(developer_address);
CREATE INDEX IF NOT EXISTS idx_apps_language    ON apps(language);
CREATE INDEX IF NOT EXISTS idx_apps_uploaded_at ON apps(uploaded_at DESC);

-- App source code (off-chain: potentially large)
CREATE TABLE IF NOT EXISTS app_contents (
  content_hash  TEXT    PRIMARY KEY,
  source_code   TEXT    NOT NULL,
  size_bytes    INT     NOT NULL,
  stored_at     BIGINT  NOT NULL
);

-- ─── Blockchain Blocks ────────────────────────────────────────────────────

-- Blocks reference no other tables so they can be created first.
-- Crash proofs are linked via the block_proofs junction table.
CREATE TABLE IF NOT EXISTS blocks (
  block_hash     TEXT    PRIMARY KEY,   -- hex(SHA256(SHA256(serialized_header)))
  block_number   BIGINT  NOT NULL UNIQUE,
  previous_hash  TEXT,                  -- NULL only for genesis (block 0)
  merkle_root    TEXT    NOT NULL,      -- merkle root of finalized proofs in block
  version        INT     NOT NULL DEFAULT 1,
  timestamp      BIGINT  NOT NULL,
  CONSTRAINT blocks_genesis_check CHECK (
    (block_number = 0 AND previous_hash IS NULL) OR
    (block_number > 0 AND previous_hash IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_blocks_number ON blocks(block_number DESC);
CREATE INDEX IF NOT EXISTS idx_blocks_prev   ON blocks(previous_hash);

-- ─── Crash Proofs ─────────────────────────────────────────────────────────

-- On-chain record: small, consensus-critical
CREATE TABLE IF NOT EXISTS crash_proofs (
  proof_id         TEXT    PRIMARY KEY,        -- hex(SHA256(content_hash || app_id || tester_address || submitted_at))
  app_id           UUID    NOT NULL REFERENCES apps(app_id),
  tester_address   TEXT    NOT NULL,
  content_hash     TEXT    NOT NULL,            -- references proof_contents.content_hash
  status           TEXT    NOT NULL DEFAULT 'pending'
    -- 'archived' = superseded: a sibling proof for the same app won the ledger slot.
    CHECK (status IN ('pending', 'voting', 'finalized', 'rejected', 'archived')),
  voting_deadline  BIGINT,                      -- set when proof enters 'voting' state
  reward_score     DECIMAL(4, 2),               -- final median (0.10–10.00), set on finalization
  finalized_at     BIGINT,
  submitted_at     BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_proofs_app_id    ON crash_proofs(app_id);
CREATE INDEX IF NOT EXISTS idx_proofs_status    ON crash_proofs(status);
CREATE INDEX IF NOT EXISTS idx_proofs_tester    ON crash_proofs(tester_address);
CREATE INDEX IF NOT EXISTS idx_proofs_deadline  ON crash_proofs(voting_deadline)
  WHERE status = 'voting';

-- Idempotent constraint upgrade for databases created before 'archived' existed.
-- schema.sql is re-run on every startup, so drop+add keeps the CHECK in sync.
ALTER TABLE crash_proofs DROP CONSTRAINT IF EXISTS crash_proofs_status_check;
ALTER TABLE crash_proofs ADD  CONSTRAINT crash_proofs_status_check
  CHECK (status IN ('pending', 'voting', 'finalized', 'rejected', 'archived'));

-- Off-chain content: the actual binary crash input
CREATE TABLE IF NOT EXISTS proof_contents (
  content_hash  TEXT   PRIMARY KEY,
  crash_input   BYTEA  NOT NULL,        -- raw binary that triggers the crash
  input_format  TEXT   NOT NULL
    CHECK (input_format IN ('stdin', 'argv', 'file', 'binary')),
  input_size    INT    NOT NULL,
  stored_at     BIGINT NOT NULL
);

-- ─── Block ↔ Proof Association ────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS block_proofs (
  block_hash  TEXT  NOT NULL REFERENCES blocks(block_hash),
  proof_id    TEXT  NOT NULL REFERENCES crash_proofs(proof_id),
  PRIMARY KEY (block_hash, proof_id)
);

CREATE INDEX IF NOT EXISTS idx_block_proofs_proof ON block_proofs(proof_id);

-- ─── Verifications ────────────────────────────────────────────────────────

-- Human verifier votes: CVSS-style score 0.10–10.00
CREATE TABLE IF NOT EXISTS verifications (
  verification_id   UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  proof_id          TEXT    NOT NULL REFERENCES crash_proofs(proof_id),
  verifier_address  TEXT    NOT NULL,
  score             DECIMAL(4, 2) NOT NULL
    CHECK (score >= 0.10 AND score <= 10.00),
  exit_code         INT,
  signal_number     INT,
  stdout_preview    TEXT,   -- capped at first 1024 bytes
  stderr_preview    TEXT,
  duration_ms       INT,
  crashed           BOOLEAN,
  signature         TEXT    NOT NULL,   -- hex(Ed25519.sign(proof_id || score_bytes || signed_at))
  signed_at         BIGINT  NOT NULL,
  UNIQUE (proof_id, verifier_address)   -- one vote per verifier per proof
);

CREATE INDEX IF NOT EXISTS idx_verifications_proof    ON verifications(proof_id);
CREATE INDEX IF NOT EXISTS idx_verifications_verifier ON verifications(verifier_address);

-- ─── AI Verifications ─────────────────────────────────────────────────────

-- Advisory, off-chain AI review. Before a proof is minted, three AI models
-- (ChatGPT / Gemini / DeepSeek) inspect the code + crash input; a block earns an
-- "AI Verified" badge only when all of them approve. This never gates the
-- ledger — human consensus decides — so it is NOT consensus-critical.
CREATE TABLE IF NOT EXISTS ai_verifications (
  ai_verification_id  UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  proof_id            TEXT    NOT NULL REFERENCES crash_proofs(proof_id),
  model               TEXT    NOT NULL,   -- provider id: 'chatgpt' | 'gemini' | 'deepseek'
  confidence_score    DECIMAL(4, 3) NOT NULL
    CHECK (confidence_score >= 0 AND confidence_score <= 1),
  reasoning           TEXT,
  request_hash        TEXT    NOT NULL,   -- hash of the exact prompt (reproducibility audit)
  queried_at          BIGINT  NOT NULL,
  UNIQUE (proof_id, model)                -- one analysis per model per proof
);

-- Whether this model approved the proof (all-approve → block is "AI Verified").
-- Additive for databases created before AI review existed.
ALTER TABLE ai_verifications ADD COLUMN IF NOT EXISTS approved BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_ai_verifications_proof ON ai_verifications(proof_id);

-- ─── UTXO Token System ────────────────────────────────────────────────────

-- Unspent Transaction Outputs — token balances are derived from these
-- Tokens are created via coinbase (proof rewards) or transfer outputs
CREATE TABLE IF NOT EXISTS utxos (
  utxo_id           UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id    TEXT    NOT NULL,         -- hex(SHA256(tx_content))
  output_index      INT     NOT NULL,
  owner_address     TEXT    NOT NULL,
  amount            DECIMAL(20, 8) NOT NULL
    CHECK (amount > 0),
  proof_id          TEXT    REFERENCES crash_proofs(proof_id),
  creation_reason   TEXT    NOT NULL
    CHECK (creation_reason IN ('bug_bounty', 'verification_reward', 'transfer')),
  block_hash        TEXT    NOT NULL REFERENCES blocks(block_hash),
  is_spent          BOOLEAN NOT NULL DEFAULT FALSE,
  spent_in_tx       TEXT,                     -- transaction_id of the spending transaction
  created_at        BIGINT  NOT NULL,
  UNIQUE (transaction_id, output_index)
);

CREATE INDEX IF NOT EXISTS idx_utxos_owner
  ON utxos(owner_address) WHERE is_spent = FALSE;
CREATE INDEX IF NOT EXISTS idx_utxos_transaction ON utxos(transaction_id);
CREATE INDEX IF NOT EXISTS idx_utxos_block       ON utxos(block_hash);
CREATE INDEX IF NOT EXISTS idx_utxos_proof       ON utxos(proof_id);

-- ─── Audit Log ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS audit_logs (
  log_id       UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  action       TEXT    NOT NULL,
  entity_type  TEXT    NOT NULL,
  entity_id    TEXT,
  address      TEXT,
  details      JSONB,
  created_at   BIGINT  NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_address    ON audit_logs(address);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity     ON audit_logs(entity_type, entity_id);

-- ─── Transaction Records ────────────────────────────────────────────────────
-- Stores all transactions (coinbase + transfer) for block reconstruction and queries

CREATE TABLE IF NOT EXISTS transactions (
  tx_id       TEXT    PRIMARY KEY,
  tx_type     TEXT    NOT NULL CHECK (tx_type IN ('coinbase', 'transfer')),
  block_hash  TEXT    NOT NULL REFERENCES blocks(block_hash),
  tx_index    INT     NOT NULL,        -- position within the block
  raw_data    BYTEA   NOT NULL,        -- serialized transaction bytes
  created_at  BIGINT  NOT NULL,
  UNIQUE (block_hash, tx_index)
);

CREATE INDEX IF NOT EXISTS idx_transactions_block ON transactions(block_hash);
CREATE INDEX IF NOT EXISTS idx_transactions_type  ON transactions(tx_type);

-- ─── Constraint Migration ───────────────────────────────────────────────────
-- For existing databases: widen creation_reason to include 'transfer'

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.check_constraints
    WHERE constraint_name = 'utxos_creation_reason_check'
    AND check_clause NOT LIKE '%transfer%'
  ) THEN
    ALTER TABLE utxos DROP CONSTRAINT utxos_creation_reason_check;
    ALTER TABLE utxos ADD CONSTRAINT utxos_creation_reason_check
      CHECK (creation_reason IN ('bug_bounty', 'verification_reward', 'transfer'));
  END IF;
END $$;
