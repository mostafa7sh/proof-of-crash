#include "Blockchain.h"

#include <map>
#include <stdexcept>
#include <type_traits>
#include <variant>

namespace poc {

Blockchain::Blockchain()
    : tipHeight_(-1)
{
}

void Blockchain::initialize(uint32_t genesisTimestamp) {
    if (!blocks_.empty()) {
        throw std::runtime_error("Blockchain already initialized");
    }

    Block genesis = Block::createGenesis(genesisTimestamp);
    tipHash_ = genesis.hash();
    tipHeight_ = 0;
    blocks_.push_back(std::move(genesis));
}

Block Blockchain::addBlock(const std::vector<Transaction>& transactions,
                           uint32_t timestamp) {
    if (blocks_.empty()) {
        throw std::runtime_error("Blockchain not initialized");
    }

    const Block& previousBlock = blocks_.back();
    Block newBlock = Block::build(
        static_cast<uint32_t>(tipHeight_ + 1),
        tipHash_,
        transactions,
        timestamp);

    BlockValidation validation = newBlock.validate(&previousBlock);
    if (!validation.valid) {
        throw std::runtime_error("Block validation failed: " + validation.error);
    }

    tipHash_ = newBlock.hash();
    tipHeight_ = static_cast<int>(newBlock.blockNumber());
    blocks_.push_back(newBlock);

    processBlockUTXOs(blocks_.back());

    return blocks_.back();
}

void Blockchain::processBlockUTXOs(const Block& block) {
    for (const auto& tx : block.transactions()) {
        std::visit([this](const auto& t) {
            using T = std::decay_t<decltype(t)>;
            if constexpr (std::is_same_v<T, CoinbaseTransaction>) {
                for (size_t i = 0; i < t.outputs().size(); ++i) {
                    const auto& out = t.outputs()[i];
                    std::string key = t.txId() + ":" + std::to_string(i);
                    utxoSet_[key] = { out.address, out.amount };
                }
            } else if constexpr (std::is_same_v<T, TransferTransaction>) {
                // Spend inputs
                for (const auto& inp : t.inputs()) {
                    std::string key = inp.prevTxId + ":" + std::to_string(inp.outputIndex);
                    utxoSet_.erase(key);
                    spentOutputs_.insert(key);
                }
                // Create outputs
                for (size_t i = 0; i < t.outputs().size(); ++i) {
                    const auto& out = t.outputs()[i];
                    std::string key = t.txId() + ":" + std::to_string(i);
                    utxoSet_[key] = { out.address, out.amount };
                }
            }
        }, tx);
    }
}

const Block* Blockchain::getBlockByHash(const std::string& hash) const {
    for (const auto& block : blocks_) {
        if (block.hash() == hash) {
            return &block;
        }
    }
    return nullptr;
}

const Block* Blockchain::getBlockByNumber(uint32_t number) const {
    if (number < blocks_.size()) {
        return &blocks_[number];
    }
    return nullptr;
}

double Blockchain::getTotalSupply() const {
    double total = 0.0;
    for (const auto& block : blocks_) {
        total += block.totalMinted();
    }
    return total;
}

double Blockchain::getBalance(const std::string& address) const {
    double balance = 0.0;
    for (const auto& [key, entry] : utxoSet_) {
        if (entry.address == address) {
            balance += entry.amount;
        }
    }
    return balance;
}

bool Blockchain::isUTXOUnspent(const std::string& txId, uint16_t outputIndex) const {
    std::string key = txId + ":" + std::to_string(outputIndex);
    return utxoSet_.count(key) > 0;
}

std::optional<double> Blockchain::getUTXOAmount(const std::string& txId, uint16_t outputIndex) const {
    std::string key = txId + ":" + std::to_string(outputIndex);
    auto it = utxoSet_.find(key);
    if (it == utxoSet_.end()) return std::nullopt;
    return it->second.amount;
}

std::vector<Blockchain::UTXOInfo> Blockchain::getUTXOs(const std::string& address) const {
    std::vector<UTXOInfo> result;
    for (const auto& [key, entry] : utxoSet_) {
        if (entry.address == address) {
            // Parse "txId:outputIndex" from key
            auto colonPos = key.rfind(':');
            if (colonPos != std::string::npos) {
                result.push_back({
                    key.substr(0, colonPos),
                    static_cast<uint16_t>(std::stoi(key.substr(colonPos + 1))),
                    entry.amount
                });
            }
        }
    }
    return result;
}

ChainValidation Blockchain::validateChain() const {
    const Block* prevBlock = nullptr;

    for (const auto& block : blocks_) {
        if (block.blockNumber() == 0) {
            if (block.header().previousBlockHash() != NULL_HASH) {
                return { false, 0, "Genesis previousBlockHash is not NULL_HASH" };
            }
        } else if (prevBlock) {
            if (block.header().previousBlockHash() != prevBlock->hash()) {
                return {
                    false,
                    static_cast<int>(block.blockNumber()),
                    "Chain break at block #" + std::to_string(block.blockNumber()) +
                    ": references " + block.header().previousBlockHash().substr(0, 16) +
                    "..., expected " + prevBlock->hash().substr(0, 16) + "...",
                };
            }
            if (block.header().timestamp() <= prevBlock->header().timestamp()) {
                return {
                    false,
                    static_cast<int>(block.blockNumber()),
                    "Timestamp not monotonic at block #" + std::to_string(block.blockNumber()),
                };
            }
        }

        prevBlock = &block;
    }

    return { true, tipHeight_, "" };
}

} // namespace poc
