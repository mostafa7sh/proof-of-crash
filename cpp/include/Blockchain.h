#pragma once

#include "Block.h"
#include "Consensus.h"
#include <map>
#include <optional>
#include <set>
#include <string>
#include <vector>

namespace poc {

/// Chain validation result.
struct ChainValidation {
    bool valid;
    int height;
    std::string error;  // empty if valid
};

/**
 * In-memory blockchain engine.
 *
 * This mirrors the TypeScript Blockchain class but operates purely
 * in-memory (no PostgreSQL dependency). Suitable for testing,
 * validation, and standalone use.
 */
class Blockchain {
public:
    Blockchain();

    /// Initialize chain with genesis block.
    void initialize(uint32_t genesisTimestamp = 0);

    /// Chain tip info.
    const std::string& tipHash() const { return tipHash_; }
    int tipHeight() const { return tipHeight_; }

    /// Add a new block with any mix of transaction types.
    Block addBlock(const std::vector<Transaction>& transactions,
                   uint32_t timestamp = 0);

    /// Get a block by its hash.  Returns nullptr if not found.
    const Block* getBlockByHash(const std::string& hash) const;

    /// Get a block by its number.  Returns nullptr if not found.
    const Block* getBlockByNumber(uint32_t number) const;

    /// Total PoC supply (all minted tokens, excluding transfer-created UTXOs).
    double getTotalSupply() const;

    /// Unspent balance for an address (tracks spent state from transfers).
    double getBalance(const std::string& address) const;

    /// Walk the chain from genesis and verify every hash link.
    ChainValidation validateChain() const;

    /// All blocks in order.
    const std::vector<Block>& blocks() const { return blocks_; }

    /// Check if a specific UTXO exists and is unspent.
    bool isUTXOUnspent(const std::string& txId, uint16_t outputIndex) const;

    /// Get the amount of a specific UTXO if it exists and is unspent.
    /// Used by the engine to enforce input/output conservation on transfers.
    std::optional<double> getUTXOAmount(const std::string& txId, uint16_t outputIndex) const;

    /// Info about a single unspent output.
    struct UTXOInfo {
        std::string txId;
        uint16_t outputIndex;
        double amount;
    };

    /// Get all unspent UTXOs for an address.
    std::vector<UTXOInfo> getUTXOs(const std::string& address) const;

private:
    std::vector<Block> blocks_;
    std::string tipHash_;
    int tipHeight_;

    // In-memory UTXO tracking: "txId:outputIndex" → (address, amount)
    struct UTXOEntry {
        std::string address;
        double amount;
    };
    std::map<std::string, UTXOEntry> utxoSet_;       // unspent
    std::set<std::string> spentOutputs_;              // spent keys

    void processBlockUTXOs(const Block& block);
};

} // namespace poc
