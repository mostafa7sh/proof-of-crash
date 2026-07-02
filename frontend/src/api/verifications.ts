import { client } from './client';
import type { VerificationSummary } from '../types';

export const verificationsApi = {
  forProof(proofId: string) {
    return client.get<VerificationSummary>(`/api/verifications/${proofId}`).then((r) => r.data);
  },

  submit(body: {
    proof_id: string;
    score: number;
    signature: string;
    signed_at: number;
    exit_code?: number | null;
    signal_number?: number | null;
    stdout_preview?: string | null;
    stderr_preview?: string | null;
    duration_ms?: number | null;
    crashed?: boolean | null;
  }) {
    return client
      .post<{ accepted: boolean; vote_count: number; consensus_reached: boolean; current_median: number | null }>(
        '/api/verifications',
        body,
      )
      .then((r) => r.data);
  },
};
