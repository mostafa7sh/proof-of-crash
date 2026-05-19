#include "Block.h"
#include "Hash.h"
#include "MerkleTree.h"

#include <chrono>
#include <cstring>
#include <type_traits>
#include <variant>

namespace poc {

// ─── Helpers ─────────────────────────────────────────────────────────────────

static uint32_t nowUnix() {
    auto now = std::chrono::system_clock::now();
    return static_cast<uint32_t>(
        std::chrono::duration_cast<std::chrono::seconds>(now.time_since_epoch()).count());
}

// ─── BlockHeader ─────────────────────────────────────────────────────────────

BlockHeader::BlockHeader(uint32_t version,
                         const std::string& previousBlockHash,
                         const std::string& merkleRoot,
                         uint32_t timestamp)
    : version_(version)
    , previousBlockHash_(previousBlockHash)
    , merkleRoot_(merkleRoot)
    , timestamp_(timestamp)
{
}

std::vector<uint8_t> BlockHeader::serialize() const {
    std::vector<uint8_t> buf(72, 0);

    // version — 4 bytes little-endian
    buf[0] = static_cast<uint8_t>(version_ & 0xFF);
    buf[1] = static_cast<uint8_t>((version_ >> 8) & 0xFF);
    buf[2] = static_cast<uint8_t>((version_ >> 16) & 0xFF);
    buf[3] = static_cast<uint8_t>((version_ >> 24) & 0xFF);

    // previous block hash — 32 bytes
    auto prevBytes = fromHex(previousBlockHash_);
    std::memcpy(buf.data() + 4, prevBytes.data(), 32);

    // merkle root — 32 bytes
    auto merkleBytes = fromHex(merkleRoot_);
    std::memcpy(buf.data() + 36, merkleBytes.data(), 32);

    // timestamp — 4 bytes little-endian
    buf[68] = static_cast<uint8_t>(timestamp_ & 0xFF);
    buf[69] = static_cast<uint8_t>((timestamp_ >> 8) & 0xFF);
    buf[70] = static_cast<uint8_t>((timestamp_ >> 16) & 0xFF);
    buf[71] = static_cast<uint8_t>((timestamp_ >> 24) & 0xFF);

    return buf;
}

std::string BlockHeader::computeHash() const {
    auto serialized = serialize();
    return toHex(hash256(serialized));
}

// ─── Block ───────────────────────────────────────────────────────────────────

Block::Block(uint32_t blockNumber,
             const BlockHeader& header,
             const std::vector<Transaction>& transactions)
    : blockNumber_(blockNumber)
    , header_(header)
    , transactions_(transactions)
{
}

std::string Block::hash() const {
    return header_.computeHash();
}

double Block::totalMinted() const {
    double sum = 0.0;
    for (const auto& tx : transactions_) {
        std::visit([&sum](const auto& t) {
            using T = std::decay_t<decltype(t)>;
            if constexpr (std::is_same_v<T, CoinbaseTransaction>) {
                sum += t.totalMinted();
            }
            // TransferTransaction does not mint tokens
        }, tx);
    }
    return sum;
}

Block Block::createGenesis(uint32_t timestamp) {
    uint32_t ts = (timestamp != 0) ? timestamp : nowUnix();

    std::vector<Digest> empty;
    std::string emptyMerkle = toHex(computeMerkleRoot(empty));

    BlockHeader header(BLOCK_VERSION, NULL_HASH, emptyMerkle, ts);
    return Block(0, header, {});
}

Block Block::build(uint32_t blockNumber,
                   const std::string& previousBlockHash,
                   const std::vector<Transaction>& transactions,
                   uint32_t timestamp) {
    uint32_t ts = (timestamp != 0) ? timestamp : nowUnix();

    // Merkle tree over transaction IDs
    std::vector<Digest> txHashes;
    txHashes.reserve(transactions.size());
    for (const auto& tx : transactions) {
        std::string id = getTxId(tx);
        auto bytes = fromHex(id);
        Digest d;
        std::memcpy(d.data(), bytes.data(), 32);
        txHashes.push_back(d);
    }

    std::string merkleRoot = toHex(computeMerkleRoot(txHashes));
    BlockHeader header(BLOCK_VERSION, previousBlockHash, merkleRoot, ts);
    return Block(blockNumber, header, transactions);
}

BlockValidation Block::validate(const Block* previousBlock) const {
    auto fail = [](const std::string& error) -> BlockValidation {
        return { false, error };
    };
    auto pass = []() -> BlockValidation {
        return { true, "" };
    };

    // Genesis
    if (blockNumber_ == 0) {
        if (header_.previousBlockHash() != NULL_HASH) {
            return fail("Genesis block must reference NULL_HASH as previous");
        }
        if (!transactions_.empty()) {
            return fail("Genesis block must have zero transactions");
        }
        return pass();
    }

    // Non-genesis requires a valid predecessor
    if (!previousBlock) {
        return fail("Non-genesis block requires a previous block for validation");
    }

    // Hash chain linkage
    if (header_.previousBlockHash() != previousBlock->hash()) {
        return fail("Previous hash mismatch: header says " +
                    header_.previousBlockHash().substr(0, 16) + "..., actual previous is " +
                    previousBlock->hash().substr(0, 16) + "...");
    }

    // Sequential block numbers
    if (blockNumber_ != previousBlock->blockNumber() + 1) {
        return fail("Block number gap: expected " +
                    std::to_string(previousBlock->blockNumber() + 1) +
                    ", got " + std::to_string(blockNumber_));
    }

    // Monotonic timestamps
    if (header_.timestamp() <= previousBlock->header().timestamp()) {
        return fail("Timestamp must be strictly greater than previous block");
    }

    // Merkle root integrity
    std::vector<Digest> txHashes;
    txHashes.reserve(transactions_.size());
    for (const auto& tx : transactions_) {
        std::string id = getTxId(tx);
        auto bytes = fromHex(id);
        Digest d;
        std::memcpy(d.data(), bytes.data(), 32);
        txHashes.push_back(d);
    }
    std::string computedMerkle = toHex(computeMerkleRoot(txHashes));
    if (header_.merkleRoot() != computedMerkle) {
        return fail("Merkle root mismatch: computed " + computedMerkle.substr(0, 16) +
                    "..., header says " + header_.merkleRoot().substr(0, 16) + "...");
    }

    return pass();
}

} // namespace poc
