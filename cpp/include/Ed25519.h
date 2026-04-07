#pragma once

#include <string>

namespace poc {

/**
 * Verify an Ed25519 signature.
 * All parameters are lowercase hex strings.
 *
 * @param messageHex    hex-encoded message bytes (e.g. the raw 32-byte txId)
 * @param signatureHex  hex-encoded 64-byte Ed25519 signature
 * @param publicKeyHex  hex-encoded 32-byte Ed25519 public key
 * @returns true iff the signature is valid
 */
bool verifyEd25519Hex(const std::string& messageHex,
                      const std::string& signatureHex,
                      const std::string& publicKeyHex);

} // namespace poc
