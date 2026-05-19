#include "Consensus.h"

#include <algorithm>
#include <cmath>
#include <stdexcept>

namespace poc {

// ─── Median Calculation ──────────────────────────────────────────────────────

double computeMedian(std::vector<double> values) {
    if (values.empty()) return 0.0;

    std::sort(values.begin(), values.end());
    size_t mid = values.size() / 2;

    if (values.size() % 2 != 0) {
        return values[mid];
    }
    return (values[mid - 1] + values[mid]) / 2.0;
}

// ─── Reward Distribution ─────────────────────────────────────────────────────

RewardCalculation calculateRewards(const std::vector<VerifierVote>& votes) {
    if (static_cast<int>(votes.size()) < MIN_VERIFICATIONS) {
        throw std::runtime_error(
            "Need at least " + std::to_string(MIN_VERIFICATIONS) +
            " votes, got " + std::to_string(votes.size()));
    }

    std::vector<double> scores;
    scores.reserve(votes.size());
    for (const auto& v : votes) {
        scores.push_back(v.score);
    }

    double medianScore = computeMedian(scores);
    double baseReward = std::floor(medianScore * 100);
    double finderReward = std::floor(baseReward * FINDER_SHARE);
    double verifierMaxPer = baseReward - finderReward;  // 30% per verifier

    std::vector<VerifierPayout> payouts;
    payouts.reserve(votes.size());

    for (const auto& v : votes) {
        double distance = std::abs(v.score - medianScore);
        double reward;

        if (distance > OUTLIER_THRESHOLD) {
            reward = 0.0;
        } else {
            double accuracyBonus = 1.0 - distance / OUTLIER_THRESHOLD;
            reward = std::floor(verifierMaxPer * accuracyBonus * 100) / 100.0;
        }

        payouts.push_back({
            v.address,
            v.score,
            std::round(distance * 1000) / 1000.0,
            reward,
        });
    }

    double totalVerifierReward = 0.0;
    for (const auto& p : payouts) {
        totalVerifierReward += p.reward;
    }
    double totalMinted = finderReward + totalVerifierReward;

    return {
        medianScore,
        baseReward,
        finderReward,
        verifierMaxPer,
        std::move(payouts),
        totalMinted,
    };
}

// ─── Coinbase Transaction Builder ────────────────────────────────────────────

CoinbaseTransaction buildCoinbaseTransaction(
    const std::string& proofId,
    const std::string& finderAddress,
    const RewardCalculation& rewards)
{
    std::vector<TxOutput> outputs;

    // Finder gets their share
    if (rewards.finderReward > 0) {
        outputs.push_back({ finderAddress, rewards.finderReward, RewardReason::BugBounty });
    }

    // Verifiers get accuracy-weighted shares
    for (const auto& payout : rewards.payouts) {
        if (payout.reward > 0) {
            outputs.push_back({
                payout.address,
                payout.reward,
                RewardReason::VerificationReward,
            });
        }
    }

    return CoinbaseTransaction(proofId, outputs);
}

// ─── Finalization Check ──────────────────────────────────────────────────────

FinalizationCheck checkFinalization(int voteCount, int votingDeadline, int nowSeconds) {
    if (voteCount < MIN_VERIFICATIONS) {
        return {
            false,
            "Need " + std::to_string(MIN_VERIFICATIONS) +
            " votes, have " + std::to_string(voteCount),
        };
    }

    if (nowSeconds < votingDeadline) {
        return {
            false,
            "Voting window still open until " + std::to_string(votingDeadline),
        };
    }

    return { true, "Ready for finalization" };
}

} // namespace poc
