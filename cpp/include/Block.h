#pragma once

#include "SHA256.h"
#include "Transaction.h"
#include <string>
#include <vector>

namespace poc {

/// 64 hex zeros (32 zero bytes) — previous hash for genesis block.
inline const std::string NULL_HASH(64, '0');

/// Current block version.
inline constexpr uint32_t BLOCK_VERSION = 1;

/**
 * Block Header — Bitcoin-style 72-byte binary layout.
 *
 *   offset  0: version           uint32 LE  (4 bytes)
 *   offset  4: previousBlockHash bytes  BE  (32 bytes)
 *   offset 36: merkleRoot        bytes  BE  (32 bytes)
 *   offset 68: timestamp         uint32 LE  (4 bytes)
 *
 * Block hash = SHA256(SHA256(serialized_header)).
 * Block hash is NEVER stored inside the block.
 */
class BlockHeader {
public:
    BlockHeader(uint32_t version,
                const std::string& previousBlockHash,
                const std::string& merkleRoot,
                uint32_t timestamp);

    uint32_t version() const { return version_; }
    const std::string& previousBlockHash() const { return previousBlockHash_; }
    const std::string& merkleRoot() const { return merkleRoot_; }
    uint32_t timestamp() const { return timestamp_; }

    std::vector<uint8_t> serialize() const;
    std::string computeHash() const;

private:
    uint32_t version_;
    std::string previousBlockHash_;
    std::string merkleRoot_;
    uint32_t timestamp_;
};

/// Block validation result.
struct BlockValidation {
    bool valid;
    std::string error;
};

/**
 * Block — contains a header and transactions (coinbase + transfer).
 */
class Block {
public:
    Block(uint32_t blockNumber,
          const BlockHeader& header,
          const std::vector<Transaction>& transactions);

    uint32_t blockNumber() const { return blockNumber_; }
    const BlockHeader& header() const { return header_; }
    const std::vector<Transaction>& transactions() const { return transactions_; }

    /// Block hash — derived from header, never stored.
    std::string hash() const;

    /// Total PoC tokens minted (only coinbase transactions mint).
    double totalMinted() const;

    // ─── Factory Methods ─────────────────────────────────────────────────

    static Block createGenesis(uint32_t timestamp = 0);

    static Block build(uint32_t blockNumber,
                       const std::string& previousBlockHash,
                       const std::vector<Transaction>& transactions,
                       uint32_t timestamp = 0);

    // ─── Validation ──────────────────────────────────────────────────────

    BlockValidation validate(const Block* previousBlock) const;

private:
    uint32_t blockNumber_;
    BlockHeader header_;
    std::vector<Transaction> transactions_;
};

} // namespace poc
