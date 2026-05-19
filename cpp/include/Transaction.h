#pragma once

#include "SHA256.h"
#include <string>
#include <variant>
#include <vector>

namespace poc {

/// Reward reason for a transaction output.
enum class RewardReason {
    BugBounty,
    VerificationReward,
};

std::string rewardReasonToString(RewardReason reason);

/// A single output in a coinbase transaction (UTXO).
struct TxOutput {
    std::string address;
    double amount;          // PoC tokens (up to 8 decimal places)
    RewardReason reason;
};

/**
 * Coinbase Transaction — creates new PoC tokens from thin air.
 *
 * Serialization format (deterministic, for txId computation):
 *   "coinbase" marker    (length-prefixed string)
 *   proofId              (length-prefixed string)
 *   outputCount          (uint16 BE)
 *   for each output:
 *     address            (length-prefixed string)
 *     amount             (8 bytes BE fixed-point)
 *     reason             (length-prefixed string)
 */
class CoinbaseTransaction {
public:
    CoinbaseTransaction(const std::string& proofId, const std::vector<TxOutput>& outputs);

    const std::string& txId() const { return txId_; }
    const std::string& proofId() const { return proofId_; }
    const std::vector<TxOutput>& outputs() const { return outputs_; }

    std::vector<uint8_t> serialize() const;
    double totalMinted() const;

    static std::string computeTxId(const std::string& proofId,
                                    const std::vector<TxOutput>& outputs);

private:
    std::string proofId_;
    std::vector<TxOutput> outputs_;
    std::string txId_;

    static std::vector<uint8_t> buildBytes(const std::string& proofId,
                                            const std::vector<TxOutput>& outputs);
};

// ─── Transfer Transaction ─────────────────────────────────────────────────

/// A single input in a transfer transaction (references an existing UTXO).
struct TxInput {
    std::string prevTxId;       // txId of the transaction containing the UTXO
    uint16_t outputIndex;       // which output in that transaction
    std::string signature;      // hex Ed25519 signature of txId
};

/// A single output in a transfer transaction.
struct TransferTxOutput {
    std::string address;
    double amount;
};

/**
 * Transfer Transaction — spends existing UTXOs and creates new ones.
 *
 * Serialization for txId (UNSIGNED — signatures excluded):
 *   "transfer" marker   (length-prefixed string)
 *   inputCount          (uint16 BE)
 *   for each input:
 *     prevTxId          (length-prefixed string)
 *     outputIndex       (uint16 BE)
 *   outputCount         (uint16 BE)
 *   for each output:
 *     address           (length-prefixed string)
 *     amount            (8 bytes BE fixed-point)
 */
class TransferTransaction {
public:
    TransferTransaction(const std::vector<TxInput>& inputs,
                        const std::vector<TransferTxOutput>& outputs);

    const std::string& txId() const { return txId_; }
    const std::vector<TxInput>& inputs() const { return inputs_; }
    const std::vector<TransferTxOutput>& outputs() const { return outputs_; }

    /// Serialize without signatures (for txId computation and signing).
    std::vector<uint8_t> serializeForSigning() const;

    /// Full serialization including signatures (stored in blocks).
    std::vector<uint8_t> serialize() const;

    /// Total output amount.
    double totalOutput() const;

    /// txId = SHA256(unsigned serialization).
    static std::string computeTxId(const std::vector<TxInput>& inputs,
                                    const std::vector<TransferTxOutput>& outputs);

private:
    std::vector<TxInput> inputs_;
    std::vector<TransferTxOutput> outputs_;
    std::string txId_;

    static std::vector<uint8_t> buildSigningBytes(const std::vector<TxInput>& inputs,
                                                   const std::vector<TransferTxOutput>& outputs);
};

// ─── Transaction variant ──────────────────────────────────────────────────

using Transaction = std::variant<CoinbaseTransaction, TransferTransaction>;

/// Get the txId from any transaction type.
inline std::string getTxId(const Transaction& tx) {
    return std::visit([](const auto& t) -> std::string { return t.txId(); }, tx);
}

/// Get the serialized bytes from any transaction type.
inline std::vector<uint8_t> serializeTx(const Transaction& tx) {
    return std::visit([](const auto& t) { return t.serialize(); }, tx);
}

} // namespace poc
