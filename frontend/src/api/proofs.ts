import { client } from './client';
import type { AiVerificationSummary, CrashProof, Paginated, ProofContent, ProofStatus } from '../types';

// getting proof data from the backend API
export const proofsApi = {
  // retrieve a paginated list of proofs, optionally filtered by status and/or app ID
  list(params: { status?: ProofStatus; app_id?: string; page?: number; page_size?: number } = {}) {
    return client.get<Paginated<CrashProof>>('/api/proofs', { params }).then((r) => r.data);
  },

  // retrieve a specific proof by its ID, returning the proof object
  get(proofId: string) {
    return client.get<CrashProof>(`/api/proofs/${proofId}`).then((r) => r.data);
  },

  // retrieve the content of a specific proof by its ID, returning the proof content object
  content(proofId: string) {
    return client.get<ProofContent>(`/api/proofs/${proofId}/content`).then((r) => r.data);
  },

  // advisory AI model review (ChatGPT / Gemini / DeepSeek verdicts) for a proof
  aiVerifications(proofId: string) {
    return client.get<AiVerificationSummary>(`/api/proofs/${proofId}/ai-verifications`).then((r) => r.data);
  },

  // submit a new proof with the provided app ID, crash input, and more.
  create(body: { app_id: string; crash_input: string; input_format: string }) {
    return client
      .post<{ proof_id: string; status: ProofStatus; voting_deadline: number }>('/api/proofs', body)
      .then((r) => r.data);
  },
};
