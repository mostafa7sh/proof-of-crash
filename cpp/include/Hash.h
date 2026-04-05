#pragma once

#include "SHA256.h"
#include <cstdint>
#include <string>
#include <vector>

namespace poc {

// ─── Core Hash Functions ─────────────────────────────────────────────────────
// Mirrors backend/src/crypto/hash.ts

/// SHA-256 of a UTF-8 string, returned as hex.
std::string sha256Hex(const std::string& data);

/// Double SHA-256 of a UTF-8 string, returned as hex.
std::string hash256Hex(const std::string& data);

// ─── Serialization Helpers ───────────────────────────────────────────────────
// Mirrors the TypeScript serializeString / serializeAmount.

/// Write a 2-byte big-endian length prefix + UTF-8 string bytes.
std::vector<uint8_t> serializeString(const std::string& value);

/// Write an amount as 8-byte big-endian fixed-point (amount × 10^8).
std::vector<uint8_t> serializeAmount(double amount);

/// Concatenate multiple byte vectors.
std::vector<uint8_t> concat(const std::vector<std::vector<uint8_t>>& parts);

/// Write a uint16 as 2 bytes big-endian.
std::vector<uint8_t> serializeUint16BE(uint16_t value);

/// Write a uint32 as 4 bytes little-endian.
std::vector<uint8_t> serializeUint32LE(uint32_t value);

} // namespace poc
