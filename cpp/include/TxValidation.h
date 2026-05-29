#pragma once

#include "Transaction.h"
#include <string>

namespace poc {

class Blockchain;

/// Outcome of validating a transaction. `error` is empty iff `valid` is true.
struct TxValidationResult {
    bool valid;
    std::string error;
};

/**
 * Full stateful validation of a transfer transaction against the confirmed
 * UTXO set. This is the single authority that decides whether a transfer is
 * allowed to spend coins — it must run before a transfer enters the mempool or
 * a block, and it must not trust any property asserted by the caller.
 *
 * Implements the canonical transaction-validation checklist:
 *
 *   1. structure        — at least one input and one output
 *   2. amounts          — every output strictly positive and finite
 *   3. no duplicates    — no input spends the same outpoint twice
 *   4. txId integrity   — the id commits to exactly these inputs+outputs
 *   5. inputs exist     — each outpoint is a known UTXO …
 *   6. inputs unspent   — … and is currently unspent (getUTXO returns only unspent)
 *   7. ownership        — SHA256(input.publicKey) equals the UTXO's owner address
 *   8. signatures       — input.signature is a valid Ed25519 signature over the
 *                         txId by input.publicKey
 *   9. conservation     — sum(input amounts) == sum(output amounts); transfers
 *                         neither mint nor burn (no fees in this ledger)
 *
 * Checks are ordered cheapest/structural first and crypto last, so malformed
 * input is rejected before any signature verification runs.
 */
TxValidationResult validateTransferTransaction(const TransferTransaction& tx,
                                                const Blockchain& chain);

} // namespace poc
