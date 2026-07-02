import * as dotenv from 'dotenv';

dotenv.config();

// ─── AI Model Review (advisory, off-chain) ────────────────────────────────
//
// Before a proof is minted into a block it is shown to three AI models. If ALL
// of them agree the code is buggy and the crash proof is valid, the finalized
// block earns an "AI Verified" badge. This is ADVISORY ONLY: human consensus
// still decides what enters the ledger — the AI verdict never blocks a proof and
// is not consensus-critical.
//
// Providers are pluggable. By default each model runs as a deterministic
// *simulated* judge (offline, free, reproducible) so the badge works in the demo
// and seeder without any keys. Set a provider's API key env var to upgrade just
// that provider to the real API.

export type AiModelId = 'chatgpt' | 'gemini' | 'deepseek';

export interface AiModelConfig {
  id: AiModelId;
  label: string;          // human-facing name
  apiKeyEnv: string;      // env var holding the provider API key
  modelEnv: string;       // env var overriding the concrete model name
  defaultModel: string;   // model used when modelEnv is unset
}

// The three required reviewers, in display order. `model` rows in the
// ai_verifications table store the id, so the "all approved" aggregate counts a
// fixed, known set.
export const AI_MODELS: readonly AiModelConfig[] = [
  { id: 'chatgpt',  label: 'ChatGPT',  apiKeyEnv: 'OPENAI_API_KEY',   modelEnv: 'OPENAI_MODEL',   defaultModel: 'gpt-4o-mini' },
  { id: 'gemini',   label: 'Gemini',   apiKeyEnv: 'GEMINI_API_KEY',   modelEnv: 'GEMINI_MODEL',   defaultModel: 'gemini-1.5-flash' },
  { id: 'deepseek', label: 'DeepSeek', apiKeyEnv: 'DEEPSEEK_API_KEY', modelEnv: 'DEEPSEEK_MODEL', defaultModel: 'deepseek-chat' },
] as const;

// A block is "AI Verified" only when every reviewer approves — i.e. all three.
export const AI_REQUIRED_APPROVALS = AI_MODELS.length;

// Master switch. When false, mining skips AI review entirely (no verdicts are
// written and no badge appears). Real providers only activate per-key.
export const AI_VERIFICATION_ENABLED =
  (process.env['AI_VERIFICATION_ENABLED'] ?? 'true').toLowerCase() !== 'false';

// Per-call timeout for the real HTTP adapters (the simulated judge is instant).
export const AI_TIMEOUT_MS = parseInt(process.env['AI_TIMEOUT_MS'] ?? '20000');

/** 'live' when the provider's API key is present, else 'simulated'. */
export function providerMode(model: AiModelConfig): 'live' | 'simulated' {
  return (process.env[model.apiKeyEnv] ?? '').trim().length > 0 ? 'live' : 'simulated';
}

export function providerApiKey(model: AiModelConfig): string {
  return (process.env[model.apiKeyEnv] ?? '').trim();
}

export function providerModelName(model: AiModelConfig): string {
  const override = (process.env[model.modelEnv] ?? '').trim();
  return override.length > 0 ? override : model.defaultModel;
}
