#include "SHA512.h"

#include <cstring>

namespace poc {

// ─── SHA-512 Constants (FIPS 180-4 §4.2.3) ──────────────────────────────────

static constexpr uint64_t K[80] = {
    0x428a2f98d728ae22ULL, 0x7137449123ef65cdULL, 0xb5c0fbcfec4d3b2fULL, 0xe9b5dba58189dbbcULL,
    0x3956c25bf348b538ULL, 0x59f111f1b605d019ULL, 0x923f82a4af194f9bULL, 0xab1c5ed5da6d8118ULL,
    0xd807aa98a3030242ULL, 0x12835b0145706fbeULL, 0x243185be4ee4b28cULL, 0x550c7dc3d5ffb4e2ULL,
    0x72be5d74f27b896fULL, 0x80deb1fe3b1696b1ULL, 0x9bdc06a725c71235ULL, 0xc19bf174cf692694ULL,
    0xe49b69c19ef14ad2ULL, 0xefbe4786384f25e3ULL, 0x0fc19dc68b8cd5b5ULL, 0x240ca1cc77ac9c65ULL,
    0x2de92c6f592b0275ULL, 0x4a7484aa6ea6e483ULL, 0x5cb0a9dcbd41fbd4ULL, 0x76f988da831153b5ULL,
    0x983e5152ee66dfabULL, 0xa831c66d2db43210ULL, 0xb00327c898fb213fULL, 0xbf597fc7beef0ee4ULL,
    0xc6e00bf33da88fc2ULL, 0xd5a79147930aa725ULL, 0x06ca6351e003826fULL, 0x142929670a0e6e70ULL,
    0x27b70a8546d22ffcULL, 0x2e1b21385c26c926ULL, 0x4d2c6dfc5ac42aedULL, 0x53380d139d95b3dfULL,
    0x650a73548baf63deULL, 0x766a0abb3c77b2a8ULL, 0x81c2c92e47edaee6ULL, 0x92722c851482353bULL,
    0xa2bfe8a14cf10364ULL, 0xa81a664bbc423001ULL, 0xc24b8b70d0f89791ULL, 0xc76c51a30654be30ULL,
    0xd192e819d6ef5218ULL, 0xd69906245565a910ULL, 0xf40e35855771202aULL, 0x106aa07032bbd1b8ULL,
    0x19a4c116b8d2d0c8ULL, 0x1e376c085141ab53ULL, 0x2748774cdf8eeb99ULL, 0x34b0bcb5e19b48a8ULL,
    0x391c0cb3c5c95a63ULL, 0x4ed8aa4ae3418acbULL, 0x5b9cca4f7763e373ULL, 0x682e6ff3d6b2b8a3ULL,
    0x748f82ee5defb2fcULL, 0x78a5636f43172f60ULL, 0x84c87814a1f0ab72ULL, 0x8cc702081a6439ecULL,
    0x90befffa23631e28ULL, 0xa4506cebde82bde9ULL, 0xbef9a3f7b2c67915ULL, 0xc67178f2e372532bULL,
    0xca273eceea26619cULL, 0xd186b8c721c0c207ULL, 0xeada7dd6cde0eb1eULL, 0xf57d4f7fee6ed178ULL,
    0x06f067aa72176fbaULL, 0x0a637dc5a2c898a6ULL, 0x113f9804bef90daeULL, 0x1b710b35131c471bULL,
    0x28db77f523047d84ULL, 0x32caab7b40c72493ULL, 0x3c9ebe0a15c9bebcULL, 0x431d67c49c100d4cULL,
    0x4cc5d4becb3e42b6ULL, 0x597f299cfc657e2aULL, 0x5fcb6fab3ad6faecULL, 0x6c44198c4a475817ULL,
};

// ─── Bit Manipulation ────────────────────────────────────────────────────────

static inline uint64_t rotr64(uint64_t x, int n) {
    return (x >> n) | (x << (64 - n));
}

static inline uint64_t ch(uint64_t x, uint64_t y, uint64_t z) {
    return (x & y) ^ (~x & z);
}

static inline uint64_t maj(uint64_t x, uint64_t y, uint64_t z) {
    return (x & y) ^ (x & z) ^ (y & z);
}

static inline uint64_t sigma0(uint64_t x) {
    return rotr64(x, 28) ^ rotr64(x, 34) ^ rotr64(x, 39);
}

static inline uint64_t sigma1(uint64_t x) {
    return rotr64(x, 14) ^ rotr64(x, 18) ^ rotr64(x, 41);
}

static inline uint64_t gamma0(uint64_t x) {
    return rotr64(x, 1) ^ rotr64(x, 8) ^ (x >> 7);
}

static inline uint64_t gamma1(uint64_t x) {
    return rotr64(x, 19) ^ rotr64(x, 61) ^ (x >> 6);
}

// ─── SHA512 Class Implementation ─────────────────────────────────────────────

SHA512::SHA512() : bitCount_(0), bufferLen_(0) {
    // Initial hash values (FIPS 180-4 §5.3.5)
    state_ = {
        0x6a09e667f3bcc908ULL, 0xbb67ae8584caa73bULL,
        0x3c6ef372fe94f82bULL, 0xa54ff53a5f1d36f1ULL,
        0x510e527fade682d1ULL, 0x9b05688c2b3e6c1fULL,
        0x1f83d9abfb41bd6bULL, 0x5be0cd19137e2179ULL,
    };
    buffer_.fill(0);
}

void SHA512::update(const uint8_t* data, size_t length) {
    for (size_t i = 0; i < length; ++i) {
        buffer_[bufferLen_++] = data[i];
        if (bufferLen_ == 128) {
            processBlock(buffer_.data());
            bitCount_ += 1024;
            bufferLen_ = 0;
        }
    }
}

void SHA512::update(const std::vector<uint8_t>& data) {
    update(data.data(), data.size());
}

void SHA512::update(const std::string& data) {
    update(reinterpret_cast<const uint8_t*>(data.data()), data.size());
}

Digest512 SHA512::finalize() {
    bitCount_ += bufferLen_ * 8;

    // Padding: append 1-bit
    buffer_[bufferLen_++] = 0x80;

    // If not enough room for 16-byte length, pad this block and process
    if (bufferLen_ > 112) {
        while (bufferLen_ < 128) {
            buffer_[bufferLen_++] = 0x00;
        }
        processBlock(buffer_.data());
        bufferLen_ = 0;
    }

    // Pad with zeros up to 112 bytes
    while (bufferLen_ < 112) {
        buffer_[bufferLen_++] = 0x00;
    }

    // Append 128-bit length in big-endian (upper 64 bits are 0 for our use)
    for (int i = 7; i >= 0; --i) {
        buffer_[bufferLen_++] = 0x00;  // upper 64 bits
    }
    for (int i = 7; i >= 0; --i) {
        buffer_[bufferLen_++] = static_cast<uint8_t>(bitCount_ >> (i * 8));
    }

    processBlock(buffer_.data());

    // Produce the digest (big-endian)
    Digest512 digest;
    for (int i = 0; i < 8; ++i) {
        digest[i * 8 + 0] = static_cast<uint8_t>(state_[i] >> 56);
        digest[i * 8 + 1] = static_cast<uint8_t>(state_[i] >> 48);
        digest[i * 8 + 2] = static_cast<uint8_t>(state_[i] >> 40);
        digest[i * 8 + 3] = static_cast<uint8_t>(state_[i] >> 32);
        digest[i * 8 + 4] = static_cast<uint8_t>(state_[i] >> 24);
        digest[i * 8 + 5] = static_cast<uint8_t>(state_[i] >> 16);
        digest[i * 8 + 6] = static_cast<uint8_t>(state_[i] >> 8);
        digest[i * 8 + 7] = static_cast<uint8_t>(state_[i]);
    }

    // Reset for reuse
    *this = SHA512();

    return digest;
}

void SHA512::processBlock(const uint8_t block[128]) {
    // Message schedule (80 entries)
    uint64_t W[80];
    for (int t = 0; t < 16; ++t) {
        W[t] = (static_cast<uint64_t>(block[t * 8 + 0]) << 56)
             | (static_cast<uint64_t>(block[t * 8 + 1]) << 48)
             | (static_cast<uint64_t>(block[t * 8 + 2]) << 40)
             | (static_cast<uint64_t>(block[t * 8 + 3]) << 32)
             | (static_cast<uint64_t>(block[t * 8 + 4]) << 24)
             | (static_cast<uint64_t>(block[t * 8 + 5]) << 16)
             | (static_cast<uint64_t>(block[t * 8 + 6]) << 8)
             | (static_cast<uint64_t>(block[t * 8 + 7]));
    }
    for (int t = 16; t < 80; ++t) {
        W[t] = gamma1(W[t - 2]) + W[t - 7] + gamma0(W[t - 15]) + W[t - 16];
    }

    // Working variables
    uint64_t a = state_[0];
    uint64_t b = state_[1];
    uint64_t c = state_[2];
    uint64_t d = state_[3];
    uint64_t e = state_[4];
    uint64_t f = state_[5];
    uint64_t g = state_[6];
    uint64_t h = state_[7];

    // Compression (80 rounds)
    for (int t = 0; t < 80; ++t) {
        uint64_t T1 = h + sigma1(e) + ch(e, f, g) + K[t] + W[t];
        uint64_t T2 = sigma0(a) + maj(a, b, c);
        h = g;
        g = f;
        f = e;
        e = d + T1;
        d = c;
        c = b;
        b = a;
        a = T1 + T2;
    }

    // Update hash values
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

Digest512 sha512(const uint8_t* data, size_t length) {
    SHA512 ctx;
    ctx.update(data, length);
    return ctx.finalize();
}

Digest512 sha512(const std::vector<uint8_t>& data) {
    return sha512(data.data(), data.size());
}

Digest512 sha512(const std::string& data) {
    return sha512(reinterpret_cast<const uint8_t*>(data.data()), data.size());
}

} // namespace poc
