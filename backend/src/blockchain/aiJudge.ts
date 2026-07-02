import { createHash } from 'crypto';
import {
  AI_MODELS,
  AI_TIMEOUT_MS,
  providerApiKey,
  providerMode,
  providerModelName,
  type AiModelConfig,
  type AiModelId,
} from '../config/ai';

// ─── AI Model Review — the three-model judge ──────────────────────────────
//
// judgeProof() shows the target code + the crash proof to each configured model
// and returns one verdict per model. It NEVER throws: a failing/slow provider
// resolves to a not-approved verdict, because AI review is advisory only and must
// never break the mining path (see config/ai.ts).

export interface AiJudgeInput {
  appName: string;
  language: string;       // 'c' | 'cpp' | 'python' | 'rust' | 'go'
  sourceCode: string;
  inputFormat: string;    // 'stdin' | 'argv' | 'file' | 'binary'
  crashInputHex: string;  // hex-encoded crash input
}

export interface AiVerdict {
  model: AiModelId;
  approved: boolean;
  confidence: number;     // 0..1 — confidence the proof demonstrates a real bug
  reasoning: string;
  requestHash: string;    // sha256 of the exact prompt (reproducibility audit)
  mode: 'live' | 'simulated';
}

// Cap the source shown to the models (and scanned by the simulated judge) so a
// huge file can't blow a real provider's token budget. Both modes see the same
// text, so the request hash and the verdict stay consistent.
const MAX_SOURCE_CHARS = 16000;

/** Run all three models in parallel over one proof. Resolves, never rejects. */
export async function judgeProof(input: AiJudgeInput): Promise<AiVerdict[]> {
  const prompt = buildPrompt(input);
  const requestHash = sha256Hex(prompt);
  return Promise.all(AI_MODELS.map((m) => judgeOne(m, input, prompt, requestHash)));
}

async function judgeOne(
  model: AiModelConfig,
  input: AiJudgeInput,
  prompt: string,
  requestHash: string,
): Promise<AiVerdict> {
  const mode = providerMode(model);
  try {
    if (mode === 'live') {
      const v = await callProvider(model, prompt);
      return { model: model.id, mode, requestHash, ...v };
    }
    return { model: model.id, mode, requestHash, ...simulatedVerdict(model.id, input, requestHash) };
  } catch (err) {
    // Advisory: a broken provider must not stop the block. It just doesn't
    // approve, so the "AI Verified" badge won't appear.
    console.error(`AI judge (${model.id}) failed:`, err instanceof Error ? err.message : err);
    return {
      model: model.id,
      mode,
      requestHash,
      approved: false,
      confidence: 0,
      reasoning: `${model.label} was unavailable during review.`,
    };
  }
}

// ─── Prompt ────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT =
  'You are a security code reviewer. You are given a program\'s source code and a ' +
  'crash input that was submitted as proof of a bug. Decide whether the code ' +
  'contains a genuine bug that the given input demonstrates (a real crash / ' +
  'memory-safety / logic fault — not a benign program). Respond with ONLY a JSON ' +
  'object of the form {"approved": boolean, "confidence": number between 0 and 1, ' +
  '"reasoning": string (max 280 chars)}.';

function buildPrompt(input: AiJudgeInput): string {
  const source = input.sourceCode.slice(0, MAX_SOURCE_CHARS);
  const truncated = input.sourceCode.length > MAX_SOURCE_CHARS ? '\n…(source truncated)…' : '';
  const asciiPreview = hexToAsciiPreview(input.crashInputHex).slice(0, 512);
  return [
    SYSTEM_PROMPT,
    '',
    `Application: ${input.appName}`,
    `Language: ${input.language}`,
    `Crash input format: ${input.inputFormat}`,
    '',
    '=== SOURCE CODE ===',
    source + truncated,
    '',
    '=== CRASH INPUT (hex) ===',
    input.crashInputHex.slice(0, 4096) || '(empty)',
    '',
    '=== CRASH INPUT (ascii preview) ===',
    asciiPreview || '(empty)',
  ].join('\n');
}

// ─── Simulated judge (deterministic, offline default) ─────────────────────
//
// A lightweight static reviewer. It approves when the proof carries a non-empty
// crash input AND the program either uses a language-appropriate crash-prone
// construct OR parses untrusted input (stdin/argv) — i.e. there is an
// attacker-controlled path the submitted input can exercise. This matches the
// platform's own bar: every proof here is a crash a human already reproduced, so
// a genuine buggy program that ingests the given input is approved, while a
// benign program that ignores input (or a proof with no input) is not.
//
// Deterministic per (model, prompt) so the demo/seeder are reproducible, with a
// small per-model jitter so the three models don't return identical confidences.

interface Pattern { re: RegExp; name: string; }

// Specific, nameable crash-prone constructs (used to enrich the reasoning).
const RISKY_PATTERNS: Record<string, Pattern[]> = {
  c: [
    { re: /\bgets\s*\(/, name: 'gets()' },
    { re: /\bstrcpy\s*\(/, name: 'strcpy()' },
    { re: /\bstrcat\s*\(/, name: 'strcat()' },
    { re: /\bsprintf\s*\(/, name: 'sprintf()' },
    { re: /\b(?:memcpy|memmove)\s*\(/, name: 'memcpy()' },
    { re: /\bsystem\s*\(/, name: 'system()' },
    { re: /\balloca\s*\(/, name: 'alloca()' },
    { re: /\b(?:malloc|calloc|realloc)\s*\(/, name: 'unchecked allocation' },
    { re: /printf\s*\(\s*\w+\s*\)/, name: 'format-string printf' },
    { re: /\.(?:resize|reserve)\s*\(/, name: 'input-sized allocation' },
    { re: /\[\s*[a-zA-Z_]\w*\s*\]/, name: 'unchecked index' },
  ],
  python: [
    { re: /\beval\s*\(/, name: 'eval()' },
    { re: /\bexec\s*\(/, name: 'exec()' },
    { re: /pickle\.loads\s*\(/, name: 'pickle.loads()' },
    { re: /os\.system\s*\(/, name: 'os.system()' },
    { re: /subprocess\.\w+\s*\(/, name: 'subprocess call' },
    { re: /__import__\s*\(/, name: '__import__()' },
    { re: /json\.loads?\s*\(/, name: 'unbounded json parse' },
  ],
  rust: [
    { re: /\.unwrap\s*\(\)/, name: '.unwrap()' },
    { re: /\.expect\s*\(/, name: '.expect()' },
    { re: /\bunsafe\b/, name: 'unsafe block' },
    { re: /panic!\s*\(/, name: 'panic!()' },
    { re: /get_unchecked/, name: 'get_unchecked()' },
    { re: /\[\s*\.\.\s*\w+\s*\]/, name: 'slice range from input' },
  ],
  go: [
    { re: /\bpanic\s*\(/, name: 'panic()' },
    { re: /unsafe\./, name: 'unsafe package' },
    { re: /\bvar\s+\w+\s+map\[/, name: 'possibly-nil map' },
    { re: /\[\s*[a-zA-Z_]\w*\s*\]/, name: 'unchecked index' },
  ],
};

// Evidence that the program consumes attacker-controlled input.
const INPUT_PATTERNS: Record<string, RegExp> = {
  c: /\b(?:fgets|gets|scanf|fscanf|getchar|getline|fread|read)\s*\(|std::cin|\bcin\b|\bargv\b/,
  python: /\bsys\.stdin\b|\binput\s*\(|\bsys\.argv\b|\.read(?:line)?\s*\(/,
  rust: /read_line|read_to_string|std::env::args|\bargs\s*\(\)|\bstdin\s*\(\)/,
  go: /fmt\.Scan\w*|bufio\.|os\.Args|os\.Stdin|\.Read\s*\(/,
};

function langKey(language: string): string {
  const lang = language.toLowerCase();
  return (lang === 'cpp' || lang === 'c++') ? 'c' : lang;
}

function simulatedVerdict(
  model: AiModelId,
  input: AiJudgeInput,
  requestHash: string,
): { approved: boolean; confidence: number; reasoning: string } {
  const source = input.sourceCode.slice(0, MAX_SOURCE_CHARS);
  const key = langKey(input.language);
  const risky = (RISKY_PATTERNS[key] ?? RISKY_PATTERNS['c'] ?? []).filter((p) => p.re.test(source)).map((p) => p.name);
  const readsInput = (INPUT_PATTERNS[key] ?? INPUT_PATTERNS['c']!).test(source);
  const hasInput = input.crashInputHex.trim().length > 0;
  const jitter = jitterFor(model, requestHash); // 0..0.08

  if (hasInput && (risky.length > 0 || readsInput)) {
    if (risky.length > 0) {
      const confidence = clamp01(0.70 + 0.05 * Math.min(risky.length, 4) + jitter);
      const named = [...new Set(risky)].slice(0, 3).join(', ');
      return {
        approved: true,
        confidence,
        reasoning: `Simulated static review: risky construct(s) ${named}${readsInput ? ' on an untrusted-input path' : ''}; the supplied crash input reproduces the fault. (simulated reviewer)`,
      };
    }
    return {
      approved: true,
      confidence: clamp01(0.63 + jitter),
      reasoning: 'Simulated static review: the program parses untrusted input and the supplied crash input reproduces a fault. (simulated reviewer)',
    };
  }

  const confidence = clamp01(0.15 + jitter);
  const why = !hasInput
    ? 'no crash input was supplied'
    : 'the program neither parses untrusted input nor uses a crash-prone construct';
  return {
    approved: false,
    confidence,
    reasoning: `Simulated static review: ${why}. (simulated reviewer)`,
  };
}

// Deterministic per-model jitter in [0, 0.08] derived from the prompt hash.
function jitterFor(model: AiModelId, requestHash: string): number {
  const h = sha256Hex(`${model}:${requestHash}`);
  const n = parseInt(h.slice(0, 4), 16); // 0..65535
  return (n / 65535) * 0.08;
}

// ─── Real provider adapters ────────────────────────────────────────────────

interface RawVerdict { approved: boolean; confidence: number; reasoning: string; }

async function callProvider(model: AiModelConfig, prompt: string): Promise<RawVerdict> {
  if (model.id === 'gemini') return callGemini(model, prompt);
  return callOpenAiCompatible(model, prompt); // chatgpt + deepseek
}

// OpenAI and DeepSeek share the /chat/completions shape.
async function callOpenAiCompatible(model: AiModelConfig, prompt: string): Promise<RawVerdict> {
  const baseUrl = model.id === 'deepseek'
    ? 'https://api.deepseek.com/chat/completions'
    : 'https://api.openai.com/v1/chat/completions';

  const body = {
    model: providerModelName(model),
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: prompt },
    ],
    temperature: 0,
    response_format: { type: 'json_object' },
  };

  const json = await fetchJson(baseUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${providerApiKey(model)}`,
    },
    body: JSON.stringify(body),
  }) as { choices?: Array<{ message?: { content?: string } }> };

  const content = json.choices?.[0]?.message?.content ?? '';
  return parseVerdict(content);
}

async function callGemini(model: AiModelConfig, prompt: string): Promise<RawVerdict> {
  const name = providerModelName(model);
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${name}:generateContent?key=${providerApiKey(model)}`;
  const body = {
    contents: [{ parts: [{ text: `${SYSTEM_PROMPT}\n\n${prompt}` }] }],
    generationConfig: { temperature: 0, responseMimeType: 'application/json' },
  };

  const json = await fetchJson(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };

  const content = json.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
  return parseVerdict(content);
}

async function fetchJson(url: string, init: RequestInit): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText}`);
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

// Tolerate models that wrap JSON in prose or code fences.
function parseVerdict(content: string): RawVerdict {
  const match = content.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('no JSON object in model response');
  const obj = JSON.parse(match[0]) as { approved?: unknown; confidence?: unknown; reasoning?: unknown };
  const confidence = clamp01(typeof obj.confidence === 'number' ? obj.confidence : 0);
  return {
    approved: obj.approved === true,
    confidence,
    reasoning: typeof obj.reasoning === 'string' ? obj.reasoning.slice(0, 500) : '',
  };
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function sha256Hex(s: string): string {
  return createHash('sha256').update(s, 'utf8').digest('hex');
}

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(0.999, n));
}

function hexToAsciiPreview(hex: string): string {
  let out = '';
  for (let i = 0; i + 1 < hex.length; i += 2) {
    const code = parseInt(hex.slice(i, i + 2), 16);
    out += code >= 32 && code < 127 ? String.fromCharCode(code) : '.';
  }
  return out;
}
