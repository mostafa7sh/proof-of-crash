#pragma once

#include "Transaction.h"
#include <set>
#include <string>
#include <vector>

namespace poc {

struct MempoolAddResult {
    bool success;
    std::string error;  // empty if success
};

/**
 * In-memory mempool for pending transfer transactions.
 *
 * Tracks double-spend conflicts via a spentInMempool set.
 * No signature verification — Node.js handles that before sending here.
 * Preserves insertion order for fair block inclusion.
 */
class Mempool {
public:
    /// Number of pending transactions.
    size_t size() const;

    /// Add a pre-validated transfer transaction.
    /// Checks: duplicate, txId recomputation, double-spend within mempool.
    MempoolAddResult addTransaction(const TransferTransaction& tx);

    /// Get all pending transactions (insertion order).
    std::vector<const TransferTransaction*> getPending() const;

    /// Get a specific pending transaction by txId. Returns nullptr if not found.
    const TransferTransaction* getTransaction(const std::string& txId) const;

    /// Drain up to limit transactions for block inclusion (removes from mempool).
    std::vector<TransferTransaction> drainTransactions(int limit);

    /// Check if a UTXO is claimed by a pending mempool transaction.
    bool isSpentInMempool(const std::string& prevTxId, uint16_t outputIndex) const;

    /// Remove a specific transaction after block inclusion.
    void removeTransaction(const std::string& txId);

private:
    // Vector of (txId, transaction) pairs — preserves insertion order
    std::vector<std::pair<std::string, TransferTransaction>> pending_;

    // Set of "prevTxId:outputIndex" keys claimed by pending transactions
    std::set<std::string> spentInMempool_;

    static std::string utxoKey(const std::string& txId, uint16_t outputIndex);
};

} // namespace poc
