import { Sparkles, CheckCircle, XCircle } from 'lucide-react';
import { Badge } from './Badge';
import type { AiVerification, AiVerificationSummary } from '../types';

// Advisory AI model review — ChatGPT / Gemini / DeepSeek verdicts on a proof.
// A block earns the "AI Verified" badge only when all three approve; this never
// gates the ledger (human consensus does).

const MODEL_LABELS: Record<string, string> = {
  chatgpt: 'ChatGPT',
  gemini: 'Gemini',
  deepseek: 'DeepSeek',
};

function modelLabel(model: string): string {
  return MODEL_LABELS[model] ?? model;
}

function pct(confidence: number): string {
  return `${Math.round(confidence * 100)}%`;
}

/** One-line overall verdict summary ("AI Verified · 3/3" or "1/3 approved"). */
export function AiReviewSummary({ summary }: { summary: AiVerificationSummary }) {
  return summary.ai_verified ? (
    <Badge variant="accent" dot icon={<Sparkles style={{ width: 13, height: 13 }} />}>
      AI Verified · {summary.approved_count}/{summary.required}
    </Badge>
  ) : (
    <Badge variant="neutral">{summary.approved_count}/{summary.required} models approved</Badge>
  );
}

/** Compact chips — one per model — for tight spaces (block detail). */
export function AiVerdictChips({ data }: { data: AiVerification[] }) {
  if (data.length === 0) return <span className="faint text-xs">no AI review</span>;
  return (
    <div className="row gap-sm wrap">
      {data.map((v) => (
        <Badge
          key={v.model}
          variant={v.approved ? 'green' : 'neutral'}
          icon={v.approved
            ? <CheckCircle style={{ width: 12, height: 12 }} />
            : <XCircle style={{ width: 12, height: 12 }} />}
        >
          {modelLabel(v.model)} · {pct(v.confidence_score)}
        </Badge>
      ))}
    </div>
  );
}

/** Full per-model breakdown with confidence + reasoning (proof detail). */
export function AiReviewList({ data }: { data: AiVerification[] }) {
  return (
    <div className="stack-sm">
      {data.map((v) => (
        <div key={v.model} className="stack-sm" style={{ paddingBottom: 8, borderBottom: '1px solid var(--border-soft)' }}>
          <div className="row-between">
            <span className="row gap-sm">
              {v.approved
                ? <CheckCircle style={{ width: 16, height: 16, color: 'var(--green, #34d399)' }} />
                : <XCircle style={{ width: 16, height: 16, color: 'var(--text-faint)' }} />}
              <strong>{modelLabel(v.model)}</strong>
              <Badge variant={v.approved ? 'green' : 'neutral'}>{v.approved ? 'approved' : 'rejected'}</Badge>
            </span>
            <span className="mono text-sm cyan">{pct(v.confidence_score)}</span>
          </div>
          {v.reasoning && <p className="muted text-xs" style={{ margin: 0 }}>{v.reasoning}</p>}
        </div>
      ))}
    </div>
  );
}
