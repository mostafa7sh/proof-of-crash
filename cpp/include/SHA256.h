#pragma once

#include <array>
#include <cstdint>
#include <cstddef>
#include <string>
#include <vector>

namespace poc {

/// 32-byte SHA-256 digest.
using Digest = std::array<uint8_t, 32>;

/**
 * Pure C++ SHA-256 implementation following FIPS 180-4.
 *
 * Usage:
 *   SHA256 ctx;
 *   ctx.update(data, len);
 *   Digest d = ctx.finalize();
 *
 * Or use the one-shot helpers: sha256(), hash256().
 */
class SHA256 {
public:
    SHA256();

    /// Feed data into the hash.
    void update(const uint8_t* data, size_t length);
    void update(const std::vector<uint8_t>& data);
    void update(const std::string& data);

    /// Finalize and return the 32-byte digest.  Resets internal state.
    Digest finalize();

private:
    void processBlock(const uint8_t block[64]);

    std::array<uint32_t, 8> state_;
    uint64_t bitCount_;
    std::array<uint8_t, 64> buffer_;
    size_t bufferLen_;
};

// ─── One-shot helpers ────────────────────────────────────────────────────────

/// Single SHA-256 of raw bytes.
Digest sha256(const uint8_t* data, size_t length);
Digest sha256(const std::vector<uint8_t>& data);
Digest sha256(const std::string& data);

/// Double SHA-256: SHA256(SHA256(data))  — Bitcoin convention.
Digest hash256(const uint8_t* data, size_t length);
Digest hash256(const std::vector<uint8_t>& data);

// ─── Hex utilities ───────────────────────────────────────────────────────────

/// Convert a digest to lowercase hex string (64 chars).
std::string toHex(const Digest& digest);

/// Convert arbitrary byte vector to hex string.
std::string toHex(const std::vector<uint8_t>& bytes);

/// Parse a hex string into bytes. Throws on invalid input.
std::vector<uint8_t> fromHex(const std::string& hex);

} // namespace poc
