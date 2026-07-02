#pragma once

#include "Transaction.h"
#include <string>
#include <vector>

namespace poc {

// ─── Constants ───────────────────────────────────────────────────────────────

/// Minimum number of verifier votes to finalize a proof (hard floor — the
/// runtime quorum may be raised above this as the active community grows).
inline constexpr int MIN_VERIFICATIONS = 3;

/// Distance from the median within which a vote is counted as "agreeing" for
/// consensus. (Rewards are no longer zeroed past this — see calculateRewards.)
inline constexpr double OUTLIER_THRESHOLD = 1.0;

/// Fixed coinbase reward minted per finalized proof, split finder/validators.
inline constexpr double BLOCK_REWARD = 1000.0;

/// Fraction of the block reward paid to the bug finder (the rest is the
/// validator pool, shared by closeness to the median).
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
    double baseReward;          // fixed block reward (BLOCK_REWARD)
    double finderReward;        // 70% of the block reward
    double verifierPool;        // 30% of the block reward, shared by all validators
    std::vector<VerifierPayout> payouts;
    double totalMinted;         // finder + all validators == baseReward exactly
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
