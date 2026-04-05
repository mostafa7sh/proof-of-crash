#include "SHA256.h"

#include <cstring>
#include <sstream>
#include <iomanip>
#include <stdexcept>

namespace poc {

// ─── SHA-256 Constants (FIPS 180-4 §4.2.2) ──────────────────────────────────

static constexpr uint32_t K[64] = {
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5,
    0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
    0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
    0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
    0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
    0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3,
    0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5,
    0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
    0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
};

// ─── Bit Manipulation ────────────────────────────────────────────────────────

static inline uint32_t rotr(uint32_t x, int n) {
    return (x >> n) | (x << (32 - n));
}

static inline uint32_t ch(uint32_t x, uint32_t y, uint32_t z) {
    return (x & y) ^ (~x & z);
}

static inline uint32_t maj(uint32_t x, uint32_t y, uint32_t z) {
    return (x & y) ^ (x & z) ^ (y & z);
}

static inline uint32_t sigma0(uint32_t x) {
    return rotr(x, 2) ^ rotr(x, 13) ^ rotr(x, 22);
}

static inline uint32_t sigma1(uint32_t x) {
    return rotr(x, 6) ^ rotr(x, 11) ^ rotr(x, 25);
}

static inline uint32_t gamma0(uint32_t x) {
    return rotr(x, 7) ^ rotr(x, 18) ^ (x >> 3);
}

static inline uint32_t gamma1(uint32_t x) {
    return rotr(x, 17) ^ rotr(x, 19) ^ (x >> 10);
}

// ─── SHA256 Class Implementation ─────────────────────────────────────────────

SHA256::SHA256() : bitCount_(0), bufferLen_(0) {
    // Initial hash values (FIPS 180-4 §5.3.3)
    state_ = {
        0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
        0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
    };
    buffer_.fill(0);
}

void SHA256::update(const uint8_t* data, size_t length) {
    for (size_t i = 0; i < length; ++i) {
        buffer_[bufferLen_++] = data[i];
        if (bufferLen_ == 64) {
            processBlock(buffer_.data());
            bitCount_ += 512;
            bufferLen_ = 0;
        }
    }
}

void SHA256::update(const std::vector<uint8_t>& data) {
    update(data.data(), data.size());
}

void SHA256::update(const std::string& data) {
    update(reinterpret_cast<const uint8_t*>(data.data()), data.size());
}

Digest SHA256::finalize() {
    bitCount_ += bufferLen_ * 8;

    // Padding: append 1-bit
    buffer_[bufferLen_++] = 0x80;

    // If not enough room for 8-byte length, pad this block and process
    if (bufferLen_ > 56) {
        while (bufferLen_ < 64) {
            buffer_[bufferLen_++] = 0x00;
        }
        processBlock(buffer_.data());
        bufferLen_ = 0;
    }

    // Pad with zeros up to 56 bytes
    while (bufferLen_ < 56) {
        buffer_[bufferLen_++] = 0x00;
    }

    // Append 64-bit length in big-endian
    for (int i = 7; i >= 0; --i) {
        buffer_[bufferLen_++] = static_cast<uint8_t>(bitCount_ >> (i * 8));
    }

    processBlock(buffer_.data());

    // Produce the digest (big-endian)
    Digest digest;
    for (int i = 0; i < 8; ++i) {
        digest[i * 4 + 0] = static_cast<uint8_t>(state_[i] >> 24);
        digest[i * 4 + 1] = static_cast<uint8_t>(state_[i] >> 16);
        digest[i * 4 + 2] = static_cast<uint8_t>(state_[i] >> 8);
        digest[i * 4 + 3] = static_cast<uint8_t>(state_[i]);
    }

    // Reset for reuse
    *this = SHA256();

    return digest;
}

void SHA256::processBlock(const uint8_t block[64]) {
    // Message schedule (§6.2.2 step 1)
    uint32_t W[64];
    for (int t = 0; t < 16; ++t) {
        W[t] = (static_cast<uint32_t>(block[t * 4]) << 24)
             | (static_cast<uint32_t>(block[t * 4 + 1]) << 16)
             | (static_cast<uint32_t>(block[t * 4 + 2]) << 8)
             | (static_cast<uint32_t>(block[t * 4 + 3]));
    }
    for (int t = 16; t < 64; ++t) {
        W[t] = gamma1(W[t - 2]) + W[t - 7] + gamma0(W[t - 15]) + W[t - 16];
    }

    // Working variables (§6.2.2 step 2)
    uint32_t a = state_[0];
    uint32_t b = state_[1];
    uint32_t c = state_[2];
    uint32_t d = state_[3];
    uint32_t e = state_[4];
    uint32_t f = state_[5];
    uint32_t g = state_[6];
    uint32_t h = state_[7];

    // Compression (§6.2.2 step 3)
    for (int t = 0; t < 64; ++t) {
        uint32_t T1 = h + sigma1(e) + ch(e, f, g) + K[t] + W[t];
        uint32_t T2 = sigma0(a) + maj(a, b, c);
        h = g;
        g = f;
        f = e;
        e = d + T1;
        d = c;
        c = b;
        b = a;
        a = T1 + T2;
    }

    // Update hash values (§6.2.2 step 4)
    state_[0] += a;
    state_[1] += b;
    state_[2] += c;
    state_[3] += d;
    state_[4] += e;
    state_[5] += f;
    state_[6] += g;
    state_[7] += h;
}

// ─── One-shot Helpers ────────────────────────────────────────────────────────

Digest sha256(const uint8_t* data, size_t length) {
    SHA256 ctx;
    ctx.update(data, length);
    return ctx.finalize();
}

Digest sha256(const std::vector<uint8_t>& data) {
    return sha256(data.data(), data.size());
}

Digest sha256(const std::string& data) {
    return sha256(reinterpret_cast<const uint8_t*>(data.data()), data.size());
}

Digest hash256(const uint8_t* data, size_t length) {
    Digest first = sha256(data, length);
    return sha256(first.data(), first.size());
}

Digest hash256(const std::vector<uint8_t>& data) {
    return hash256(data.data(), data.size());
}

// ─── Hex Utilities ───────────────────────────────────────────────────────────

std::string toHex(const Digest& digest) {
    std::ostringstream ss;
    ss << std::hex << std::setfill('0');
    for (uint8_t byte : digest) {
        ss << std::setw(2) << static_cast<int>(byte);
    }
    return ss.str();
}

std::string toHex(const std::vector<uint8_t>& bytes) {
    std::ostringstream ss;
    ss << std::hex << std::setfill('0');
    for (uint8_t byte : bytes) {
        ss << std::setw(2) << static_cast<int>(byte);
    }
    return ss.str();
}

static uint8_t hexCharToNibble(char c) {
    if (c >= '0' && c <= '9') return static_cast<uint8_t>(c - '0');
    if (c >= 'a' && c <= 'f') return static_cast<uint8_t>(c - 'a' + 10);
    if (c >= 'A' && c <= 'F') return static_cast<uint8_t>(c - 'A' + 10);
    throw std::invalid_argument(std::string("Invalid hex character: ") + c);
}

std::vector<uint8_t> fromHex(const std::string& hex) {
    if (hex.size() % 2 != 0) {
        throw std::invalid_argument("Hex string must have even length");
    }
    std::vector<uint8_t> bytes;
    bytes.reserve(hex.size() / 2);
    for (size_t i = 0; i < hex.size(); i += 2) {
        uint8_t hi = hexCharToNibble(hex[i]);
        uint8_t lo = hexCharToNibble(hex[i + 1]);
        bytes.push_back((hi << 4) | lo);
    }
    return bytes;
}

} // namespace poc
