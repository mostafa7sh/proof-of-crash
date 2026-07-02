#include "Consensus.h"

#include <algorithm>
#include <cmath>
#include <limits>
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

    // The coinbase reward is a fixed amount per finalized proof. The finder
    // always takes exactly FINDER_SHARE of it; the remainder is the validator
    // pool, distributed so the WHOLE block reward is always minted (no dust).
    double baseReward = BLOCK_REWARD;
    double finderReward = std::floor(baseReward * FINDER_SHARE * 100) / 100.0;
    double verifierPool = baseReward - finderReward;  // validators share this 30%

    // Weight each validator by closeness to the median: weight = 1/(1+distance),
    // so a vote on the median earns the most and accuracy degrades smoothly.
    // Every validator gets a proportional, non-zero share of the pool.
    std::vector<double> weights;
    weights.reserve(votes.size());
    double totalWeight = 0.0;
    for (const auto& v : votes) {
        double distance = std::abs(v.score - medianScore);
        double w = 1.0 / (1.0 + distance);
        weights.push_back(w);
        totalWeight += w;
    }

    // Floor each share to cents, tracking the most-accurate validator so the
    // rounding remainder can be handed to them — guaranteeing the validator
    // payouts sum to verifierPool EXACTLY (and total minted == baseReward).
    std::vector<VerifierPayout> payouts;
    payouts.reserve(votes.size());
    double distributed = 0.0;
    size_t closestIdx = 0;
    double closestDistance = std::numeric_limits<double>::infinity();

    for (size_t i = 0; i < votes.size(); ++i) {
        double distance = std::abs(votes[i].score - medianScore);
        double share = (totalWeight > 0.0) ? verifierPool * weights[i] / totalWeight : 0.0;
        double reward = std::floor(share * 100) / 100.0;

        payouts.push_back({
            votes[i].address,
            votes[i].score,
            std::round(distance * 1000) / 1000.0,
            reward,
        });
        distributed += reward;
        if (distance < closestDistance) {
            closestDistance = distance;
            closestIdx = i;
        }
    }

    double remainder = std::round((verifierPool - distributed) * 100) / 100.0;
    if (remainder != 0.0 && !payouts.empty()) {
        payouts[closestIdx].reward = std::round((payouts[closestIdx].reward + remainder) * 100) / 100.0;
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
        verifierPool,
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
