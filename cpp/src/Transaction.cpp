#include "Transaction.h"
#include "Hash.h"

namespace poc {

// ─── RewardReason ────────────────────────────────────────────────────────────

std::string rewardReasonToString(RewardReason reason) {
    switch (reason) {
        case RewardReason::BugBounty:           return "bug_bounty";
        case RewardReason::VerificationReward:  return "verification_reward";
    }
    return "unknown";
}

// ─── CoinbaseTransaction ─────────────────────────────────────────────────────

CoinbaseTransaction::CoinbaseTransaction(const std::string& proofId,
                                         const std::vector<TxOutput>& outputs)
    : proofId_(proofId)
    , outputs_(outputs)
    , txId_(computeTxId(proofId, outputs))
{
}

std::vector<uint8_t> CoinbaseTransaction::buildBytes(const std::string& proofId,
                                                      const std::vector<TxOutput>& outputs) {
    std::vector<std::vector<uint8_t>> parts;

    parts.push_back(serializeString("coinbase"));
    parts.push_back(serializeString(proofId));
    parts.push_back(serializeUint16BE(static_cast<uint16_t>(outputs.size())));

    for (const auto& out : outputs) {
        parts.push_back(serializeString(out.address));
        parts.push_back(serializeAmount(out.amount));
        parts.push_back(serializeString(rewardReasonToString(out.reason)));
    }

    return concat(parts);
}

std::vector<uint8_t> CoinbaseTransaction::serialize() const {
    return buildBytes(proofId_, outputs_);
}

double CoinbaseTransaction::totalMinted() const {
    double sum = 0.0;
    for (const auto& out : outputs_) {
        sum += out.amount;
    }
    return sum;
}

std::string CoinbaseTransaction::computeTxId(const std::string& proofId,
                                              const std::vector<TxOutput>& outputs) {
    return toHex(sha256(buildBytes(proofId, outputs)));
}

// ─── TransferTransaction ─────────────────────────────────────────────────────

TransferTransaction::TransferTransaction(const std::vector<TxInput>& inputs,
                                         const std::vector<TransferTxOutput>& outputs)
    : inputs_(inputs)
    , outputs_(outputs)
    , txId_(computeTxId(inputs, outputs))
{
}

std::vector<uint8_t> TransferTransaction::buildSigningBytes(const std::vector<TxInput>& inputs,
                                                             const std::vector<TransferTxOutput>& outputs) {
    std::vector<std::vector<uint8_t>> parts;

    parts.push_back(serializeString("transfer"));

    parts.push_back(serializeUint16BE(static_cast<uint16_t>(inputs.size())));
    for (const auto& inp : inputs) {
        parts.push_back(serializeString(inp.prevTxId));
        parts.push_back(serializeUint16BE(inp.outputIndex));
    }

    parts.push_back(serializeUint16BE(static_cast<uint16_t>(outputs.size())));
    for (const auto& out : outputs) {
        parts.push_back(serializeString(out.address));
        parts.push_back(serializeAmount(out.amount));
    }

    return concat(parts);
}

std::vector<uint8_t> TransferTransaction::serializeForSigning() const {
    return buildSigningBytes(inputs_, outputs_);
}

std::vector<uint8_t> TransferTransaction::serialize() const {
    std::vector<std::vector<uint8_t>> parts;

    parts.push_back(serializeString("transfer"));

    // Inputs with signatures
    parts.push_back(serializeUint16BE(static_cast<uint16_t>(inputs_.size())));
    for (const auto& inp : inputs_) {
        parts.push_back(serializeString(inp.prevTxId));
        parts.push_back(serializeUint16BE(inp.outputIndex));
        parts.push_back(serializeString(inp.signature));
    }

    // Outputs
    parts.push_back(serializeUint16BE(static_cast<uint16_t>(outputs_.size())));
    for (const auto& out : outputs_) {
        parts.push_back(serializeString(out.address));
        parts.push_back(serializeAmount(out.amount));
    }

    return concat(parts);
}

double TransferTransaction::totalOutput() const {
    double sum = 0.0;
    for (const auto& out : outputs_) {
        sum += out.amount;
    }
    return sum;
}

std::string TransferTransaction::computeTxId(const std::vector<TxInput>& inputs,
                                              const std::vector<TransferTxOutput>& outputs) {
    return toHex(sha256(buildSigningBytes(inputs, outputs)));
}

} // namespace poc
