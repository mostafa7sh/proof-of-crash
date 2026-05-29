#include "TxValidation.h"

#include "Blockchain.h"
#include "Ed25519.h"
#include "SHA256.h"

#include <cmath>
#include <set>

namespace poc {

namespace {

/// Fixed-point round-trip tolerance: amounts are stored as integer satoshis
/// (value × 10^8), so equality across the double boundary is exact to ~5e-9.
constexpr double CONSERVATION_TOLERANCE = 5e-9;

/// Derive the platform owner address from an Ed25519 public key:
/// hex(SHA256(publicKeyBytes)). Returns empty string if the key is not valid
/// 32-byte hex, so the caller treats it as an ownership failure rather than
/// crashing on malformed input.
std::string addressFromPublicKey(const std::string& publicKeyHex) {
    if (publicKeyHex.size() != 64) return "";  // Ed25519 public key = 32 bytes
    try {
        return toHex(sha256(fromHex(publicKeyHex)));
    } catch (...) {
        return "";
    }
}

TxValidationResult fail(const std::string& error) { return { false, error }; }
TxValidationResult pass() { return { true, "" }; }

} // namespace

TxValidationResult validateTransferTransaction(const TransferTransaction& tx,
                                               const Blockchain& chain) {
    const auto& inputs = tx.inputs();
    const auto& outputs = tx.outputs();

    // 1. Structure.
    if (inputs.empty())  return fail("Transaction has no inputs");
    if (outputs.empty()) return fail("Transaction has no outputs");

    // 2. Output amounts must be strictly positive and finite. A non-positive or
    //    NaN output could otherwise satisfy conservation while creating value or
    //    poisoning balance arithmetic.
    for (const auto& out : outputs) {
        if (!std::isfinite(out.amount) || out.amount <= 0.0) {
            return fail("Output amount must be a positive, finite number");
        }
    }

    // 4. txId integrity — recompute from the canonical (unsigned) serialization
    //    and confirm it matches. This guarantees the signature we verify in
    //    step 8 is bound to exactly these inputs and outputs; a caller cannot
    //    present a txId computed over different data.
    if (TransferTransaction::computeTxId(inputs, outputs) != tx.txId()) {
        return fail("txId does not commit to the transaction's inputs/outputs");
    }

    // 3 + 5–7. First pass over the inputs: reject duplicate outpoints, confirm
    // each is an existing unspent UTXO, bind ownership, and total the spent
    // value. Signature verification is deferred to a second pass so that the
    // cheap structural/economic checks (including conservation, below) reject a
    // bad transaction before we ever run elliptic-curve math.
    std::set<std::string> seenOutpoints;
    double totalInput = 0.0;

    for (const auto& inp : inputs) {
        const std::string outpoint = inp.prevTxId + ":" + std::to_string(inp.outputIndex);

        // 3. No duplicate inputs. Without this, the same UTXO listed twice would
        //    be counted twice toward totalInput while being spent only once on
        //    the chain — letting an attacker fabricate value out of one coin.
        if (!seenOutpoints.insert(outpoint).second) {
            return fail("Duplicate input " + outpoint + " spent more than once");
        }

        // 5 + 6. Input must reference a UTXO that exists and is unspent. getUTXO
        //    returns nullopt for both unknown and already-spent outpoints (spent
        //    outputs are removed from the set), collapsing both into one check.
        auto utxo = chain.getUTXO(inp.prevTxId, inp.outputIndex);
        if (!utxo.has_value()) {
            return fail("Input " + outpoint + " does not reference an existing unspent UTXO");
        }

        // 7. Ownership: the spender must prove control of the address that owns
        //    the UTXO. The owner address is SHA256(publicKey), so an attacker
        //    cannot substitute their own key — it would hash to a different
        //    address and fail here. This is the rule that stops "anyone can
        //    spend anyone's coins".
        if (inp.publicKey.empty()) {
            return fail("Input " + outpoint + " is missing the spending public key");
        }
        const std::string derived = addressFromPublicKey(inp.publicKey);
        if (derived.empty()) {
            return fail("Input " + outpoint + " has a malformed public key");
        }
        if (derived != utxo->address) {
            return fail("Input " + outpoint + " public key does not own the UTXO "
                        "(owner " + utxo->address.substr(0, 16) + "…, key hashes to " +
                        derived.substr(0, 16) + "…)");
        }

        totalInput += utxo->amount;
    }

    // 9. Conservation: no minting and no fees on transfers — value in must equal
    //    value out. (Coinbase transactions are the only mint, and they take a
    //    separate path that is gated by verification consensus, not this layer.)
    if (std::abs(totalInput - tx.totalOutput()) > CONSERVATION_TOLERANCE) {
        return fail("Conservation violation: inputs total " + std::to_string(totalInput) +
                    " but outputs total " + std::to_string(tx.totalOutput()));
    }

    // 8. Second pass: every input's signature must be a valid Ed25519 signature
    //    over the txId by the (already ownership-bound) public key. Run last
    //    because it is the most expensive step and only meaningful once the
    //    transaction is otherwise well-formed and balanced.
    for (const auto& inp : inputs) {
        if (!verifyEd25519Hex(tx.txId(), inp.signature, inp.publicKey)) {
            const std::string outpoint = inp.prevTxId + ":" + std::to_string(inp.outputIndex);
            return fail("Input " + outpoint + " has an invalid Ed25519 signature");
        }
    }

    return pass();
}

} // namespace poc
