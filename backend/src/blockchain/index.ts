// Orchestration-layer barrel.
// everything below is a wrapper around the C++ engine or a database persistence helper.

export { getEngine, initEngine } from './instance';
export { CppEngine } from './CppEngine';
export type {
  CoinbaseTxSpec,
  TransferTxSpec,
  EngineBlockData,
  EngineUTXO,
  PendingTxSummary,
  TransferTxData,
  VerifierVoteSpec,
  CoinbaseBuildResult,
  ConsensusStatus,
} from './CppEngine';
export { mineBlock } from './mining';
export { validateAndSubmitTransfer } from './validateTransfer';
export type { TransferValidationResult } from './validateTransfer';
export { persistBlockFromEngine, loadBlockDataFromDB } from './persistence';
