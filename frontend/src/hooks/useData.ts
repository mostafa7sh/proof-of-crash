import { proofsApi, ledgerApi, verificationsApi, mempoolApi, appsApi, leaderboardApi } from '../api';
import type { ProofStatus } from '../types';
import { useAsync } from './useAsync';

// Thin, named data hooks built on useAsync. Components never call the API
// layer directly — they use these.

export function useProofs(params: { status?: ProofStatus; app_id?: string; page: number; page_size: number }) {
  return useAsync(() => proofsApi.list(params), [params.status, params.app_id, params.page, params.page_size]);
}

export function useApp(appId: string) {
  return useAsync(() => appsApi.get(appId), [appId]);
}

export function useAppSource(appId: string) {
  return useAsync(() => appsApi.source(appId), [appId]);
}

export function useMempool() {
  return useAsync(() => mempoolApi.pipeline(), []);
}

export function useLeaderboard() {
  return useAsync(() => leaderboardApi.get(), []);
}

export function useProof(proofId: string) {
  return useAsync(() => proofsApi.get(proofId), [proofId]);
}

export function useProofContent(proofId: string) {
  return useAsync(() => proofsApi.content(proofId), [proofId]);
}

export function useAiVerifications(proofId: string) {
  return useAsync(() => proofsApi.aiVerifications(proofId), [proofId]);
}

export function useVerifications(proofId: string) {
  return useAsync(() => verificationsApi.forProof(proofId), [proofId]);
}

export function useSupply() {
  return useAsync(() => ledgerApi.supply(), []);
}

export function useLatestBlock() {
  return useAsync(() => ledgerApi.latest().catch(() => null), []);
}

export function useBlocks(page: number, pageSize: number) {
  return useAsync(() => ledgerApi.blocks({ page, page_size: pageSize }), [page, pageSize]);
}

export function useBlock(blockHash: string) {
  return useAsync(() => ledgerApi.block(blockHash), [blockHash]);
}

export function useBalance(address: string | null) {
  return useAsync(
    () => (address ? ledgerApi.balance(address) : Promise.resolve(null)),
    [address],
  );
}

export function useUtxos(address: string | null) {
  return useAsync(
    () => (address ? ledgerApi.utxos(address) : Promise.resolve(null)),
    [address],
  );
}
