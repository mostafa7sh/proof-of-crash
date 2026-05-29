-- ─────────────────────────────────────────────────────────────────────────
-- Migration: Auth Hardening (rate limiting, JWT revocation, refresh tokens,
--            multi-address, audit logging, cookie auth)
--
-- Apply to an existing database that predates these features. All statements
-- are idempotent and also live in schema.sql (which runs on every startup),
-- so a fresh database needs nothing extra. This file exists as an explicit,
-- reviewable record of the incremental change.
--
--   psql "$DATABASE_URL" -f src/db/migrations/2026_05_auth_hardening.sql
-- ─────────────────────────────────────────────────────────────────────────

BEGIN;

-- Per-address "revoke all tokens" cutoff (Unix seconds).
ALTER TABLE user_addresses
  ADD COLUMN IF NOT EXISTS tokens_valid_after BIGINT NOT NULL DEFAULT 0;

-- Single-token (jti) denylist for fine-grained access-token revocation.
CREATE TABLE IF NOT EXISTS revoked_jtis (
  jti         TEXT    PRIMARY KEY,
  address     TEXT    NOT NULL,
  revoked_at  BIGINT  NOT NULL,
  expires_at  BIGINT  NOT NULL,
  reason      TEXT
);

CREATE INDEX IF NOT EXISTS idx_revoked_jtis_expires ON revoked_jtis(expires_at);

-- Refresh tokens (stored as SHA-256 hashes; rotation + reuse detection).
CREATE TABLE IF NOT EXISTS refresh_tokens (
  token_hash       TEXT    PRIMARY KEY,
  address          TEXT    NOT NULL,
  primary_address  TEXT    NOT NULL,
  issued_at        BIGINT  NOT NULL,
  expires_at       BIGINT  NOT NULL,
  used             BOOLEAN NOT NULL DEFAULT FALSE,
  revoked          BOOLEAN NOT NULL DEFAULT FALSE,
  rotated_to       TEXT,
  created_at       BIGINT  NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_address ON refresh_tokens(address);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_expires ON refresh_tokens(expires_at);

COMMIT;
