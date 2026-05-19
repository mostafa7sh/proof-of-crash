#pragma once

#include "Transaction.h"
#include <string>
#include <vector>

namespace poc {

// ─── Constants ───────────────────────────────────────────────────────────────

/// Minimum number of verifier votes to finalize a proof.
inline constexpr int MIN_VERIFICATIONS = 3;

/// Maximum distance from median before reward drops to zero.
inline constexpr double OUTLIER_THRESHOLD = 1.0;

/// Fraction of base reward allocated to bug finder.
inline constexpr double FINDER_SHARE = 0.70;

/// Voting window in seconds (7 days).
inline constexpr int VOTING_WINDOW_SECONDS = 7 * 24 * 60 * 60;

// ─── Types ───────────────────────────────────────────────────────────────────

struct VerifierVote {
    std::string address;
    double score;           // 0.10–10.00
};

struct VerifierPayout {
    std::string address;
    double score;
    double distance;
    double reward;
};

struct RewardCalculation {
    double medianScore;
    double baseReward;          // floor(median × 100) PoC
    double finderReward;        // 70% of base
    double verifierMaxPer;      // 30% of base (max per verifier)
    std::vector<VerifierPayout> payouts;
    double totalMinted;         // finder + all verifiers
};

struct FinalizationCheck {
    bool canFinalize;
    std::string reason;
};

// ─── Functions ───────────────────────────────────────────────────────────────

/// Compute the median of a list of values.
double computeMedian(std::vector<double> values);

/// Calculate accuracy-based rewards for a finalized proof.
RewardCalculation calculateRewards(const std::vector<VerifierVote>& votes);

/// Build a coinbase transaction from a reward calculation.
CoinbaseTransaction buildCoinbaseTransaction(
    const std::string& proofId,
    const std::string& finderAddress,
    const RewardCalculation& rewards);

/// Check whether a proof is ready for finalization.
FinalizationCheck checkFinalization(int voteCount, int votingDeadline, int nowSeconds);

} // namespace poc
