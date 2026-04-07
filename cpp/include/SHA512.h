#pragma once

#include <array>
#include <cstdint>
#include <cstddef>
#include <string>
#include <vector>

namespace poc {

/// 64-byte SHA-512 digest.
using Digest512 = std::array<uint8_t, 64>;

/**
 * Pure C++ SHA-512 implementation following FIPS 180-4.
 *
 * Usage:
 *   SHA512 ctx;
 *   ctx.update(data, len);
 *   Digest512 d = ctx.finalize();
 *
 * Or use the one-shot helpers: sha512().
 */
class SHA512 {
public:
    SHA512();

    /// Feed data into the hash.
    void update(const uint8_t* data, size_t length);
    void update(const std::vector<uint8_t>& data);
    void update(const std::string& data);

    /// Finalize and return the 64-byte digest.  Resets internal state.
    Digest512 finalize();

private:
    void processBlock(const uint8_t block[128]);

    std::array<uint64_t, 8> state_;
    uint64_t bitCount_;
    std::array<uint8_t, 128> buffer_;
    size_t bufferLen_;
};

// ─── One-shot helpers ────────────────────────────────────────────────────────

/// Single SHA-512 of raw bytes.
Digest512 sha512(const uint8_t* data, size_t length);
Digest512 sha512(const std::vector<uint8_t>& data);
Digest512 sha512(const std::string& data);

} // namespace poc
