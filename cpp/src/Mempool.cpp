#include "Mempool.h"

#include <algorithm>

namespace poc {

std::string Mempool::utxoKey(const std::string& txId, uint16_t outputIndex) {
    return txId + ":" + std::to_string(outputIndex);
}

size_t Mempool::size() const {
    return pending_.size();
}

MempoolAddResult Mempool::addTransaction(const TransferTransaction& tx) {
    const std::string& txId = tx.txId();

    // 1. Duplicate check
    for (const auto& [id, _] : pending_) {
        if (id == txId) {
            return { false, "Transaction " + txId.substr(0, 16) + "... already in mempool" };
        }
    }

    // 2. Basic format validation
    if (tx.inputs().empty()) {
        return { false, "Transaction has no inputs" };
    }
    if (tx.outputs().empty()) {
        return { false, "Transaction has no outputs" };
    }
    for (const auto& out : tx.outputs()) {
        if (out.amount <= 0.0) {
            return { false, "Output amount must be positive" };
        }
    }

    // 3. Recompute txId to verify integrity
    std::string recomputed = TransferTransaction::computeTxId(tx.inputs(), tx.outputs());
    if (recomputed != txId) {
        return { false, "txId mismatch: expected " + recomputed.substr(0, 16) + "..., got " + txId.substr(0, 16) + "..." };
    }

    // 4. Double-spend check against mempool
    for (const auto& inp : tx.inputs()) {
        std::string key = utxoKey(inp.prevTxId, inp.outputIndex);
        if (spentInMempool_.count(key)) {
            return { false, "Input " + key + " already spent by another mempool transaction" };
        }
    }

    // 5. All checks passed — add to mempool
    for (const auto& inp : tx.inputs()) {
        spentInMempool_.insert(utxoKey(inp.prevTxId, inp.outputIndex));
    }
    pending_.emplace_back(txId, tx);

    return { true, "" };
}

std::vector<const TransferTransaction*> Mempool::getPending() const {
    std::vector<const TransferTransaction*> result;
    result.reserve(pending_.size());
    for (const auto& [id, tx] : pending_) {
        result.push_back(&tx);
    }
    return result;
}

const TransferTransaction* Mempool::getTransaction(const std::string& txId) const {
    for (const auto& [id, tx] : pending_) {
        if (id == txId) {
            return &tx;
        }
    }
    return nullptr;
}

std::vector<TransferTransaction> Mempool::drainTransactions(int limit) {
    std::vector<TransferTransaction> drained;
    int count = std::min(limit, static_cast<int>(pending_.size()));
    drained.reserve(count);

    for (int i = 0; i < count; ++i) {
        auto& [id, tx] = pending_[i];
        // Remove spent keys for drained transactions
        for (const auto& inp : tx.inputs()) {
            spentInMempool_.erase(utxoKey(inp.prevTxId, inp.outputIndex));
        }
        drained.push_back(std::move(tx));
    }

    pending_.erase(pending_.begin(), pending_.begin() + count);
    return drained;
}

bool Mempool::isSpentInMempool(const std::string& prevTxId, uint16_t outputIndex) const {
    return spentInMempool_.count(utxoKey(prevTxId, outputIndex)) > 0;
}

void Mempool::removeTransaction(const std::string& txId) {
    auto it = std::find_if(pending_.begin(), pending_.end(),
        [&txId](const auto& pair) { return pair.first == txId; });

    if (it != pending_.end()) {
        // Remove spent keys
        for (const auto& inp : it->second.inputs()) {
            spentInMempool_.erase(utxoKey(inp.prevTxId, inp.outputIndex));
        }
        pending_.erase(it);
    }
}

} // namespace poc
