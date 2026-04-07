/**
 * Pure C++ Ed25519 signature verification — no external crypto libraries.
 *
 * Implements RFC 8032 §5.1 verification using:
 *   - SHA-512 (FIPS 180-4)
 *   - Arithmetic on the Edwards curve  -x² + y² = 1 + d·x²·y²  (mod p = 2²⁵⁵ − 19)
 *   - Extended twisted Edwards coordinates (Hisil et al. 2008)
 *
 * Field elements use 16 × int64_t limbs (≈16 bits each), following the
 * representation used by TweetNaCl.
 */

#include "Ed25519.h"
#include "SHA256.h"  // for fromHex()
#include "SHA512.h"  // for sha512()

#include <array>
#include <cstdint>
#include <cstring>
#include <vector>

namespace poc {
namespace {

using i64 = int64_t;

// ═════════════════════════════════════════════════════════════════════════════
// Field arithmetic  (mod p = 2^255 − 19)
// 16 limbs of ≈16 bits each, stored in int64_t to absorb carries.
// ═════════════════════════════════════════════════════════════════════════════

using Gf = std::array<i64, 16>;

static const Gf GF0 = {};
static const Gf GF1 = {1};

// Curve constant  d = −121665 / 121666  (mod p)
static const Gf D = {
    0x78a3, 0x1359, 0x4dca, 0x75eb, 0xd8ab, 0x4141, 0x0a4d, 0x0070,
    0xe898, 0x7779, 0x4079, 0x8cc7, 0xfe73, 0x2b6f, 0x6cee, 0x5203
};

// 2·d
static const Gf D2 = {
    0xf159, 0x26b2, 0x9b94, 0xebd6, 0xb156, 0x8283, 0x149a, 0x00e0,
    0xd130, 0xeef3, 0x80f2, 0x198e, 0xfce7, 0x56df, 0xd9dc, 0x2406
};

// √(−1) mod p
static const Gf SQRTM1 = {
    0xa0b0, 0x4a0e, 0x1b27, 0xc4ee, 0xe478, 0xad2f, 0x1806, 0x2f43,
    0xd7a7, 0x3dfb, 0x0099, 0x2b4d, 0xdf0b, 0x4fc1, 0x2480, 0x2b83
};

// Base point x-coordinate
static const Gf GX = {
    0xd51a, 0x8f25, 0x2d60, 0xc956, 0xa7b2, 0x9525, 0xc760, 0x692c,
    0xdc5c, 0xfdd6, 0xe231, 0xc0a4, 0x53fe, 0xcd6e, 0x36d3, 0x2169
};

// Base point y-coordinate (4/5 mod p)
static const Gf GY = {
    0x6658, 0x6666, 0x6666, 0x6666, 0x6666, 0x6666, 0x6666, 0x6666,
    0x6666, 0x6666, 0x6666, 0x6666, 0x6666, 0x6666, 0x6666, 0x6666
};

static void gf_set(Gf& o, const Gf& a) { o = a; }

static void gf_add(Gf& o, const Gf& a, const Gf& b) {
    for (int i = 0; i < 16; i++) o[i] = a[i] + b[i];
}

static void gf_sub(Gf& o, const Gf& a, const Gf& b) {
    for (int i = 0; i < 16; i++) o[i] = a[i] - b[i];
}

static void gf_mul(Gf& o, const Gf& a, const Gf& b) {
    i64 t[32] = {};
    for (int i = 0; i < 16; i++)
        for (int j = 0; j < 16; j++)
            t[i + j] += a[i] * b[j];
    for (int i = 15; i >= 0; i--)
        t[i] += 38 * t[i + 16];         // 2^256 ≡ 38 (mod p)
    for (int i = 0; i < 16; i++) o[i] = t[i];

    // Two rounds of carry propagation to tighten limbs
    for (int round = 0; round < 2; round++) {
        for (int i = 0; i < 16; i++) {
            i64 c = (o[i] + (1LL << 15)) >> 16;
            o[i] -= c << 16;
            if (i < 15) o[i + 1] += c;
            else         o[0]     += 38 * c;
        }
    }
}

static void gf_sq(Gf& o, const Gf& a) { gf_mul(o, a, a); }

// Conditional swap: if b == 1, swap p and q; if b == 0, no-op.
static void gf_cswap(Gf& p, Gf& q, int b) {
    i64 mask = ~(static_cast<i64>(b) - 1);
    for (int i = 0; i < 16; i++) {
        i64 t = mask & (p[i] ^ q[i]);
        p[i] ^= t;
        q[i] ^= t;
    }
}

// Carry propagation (TweetNaCl's car25519): ensure each limb is in [0, 2^16).
static void gf_car(Gf& o) {
    for (int i = 0; i < 16; i++) {
        o[i] += (1LL << 16);
        i64 c = o[i] >> 16;
        o[i] -= c << 16;
        if (i < 15)
            o[i + 1] += c - 1;
        else
            o[0] += 38 * (c - 1);
    }
}

// Canonical packing: field element → 32 little-endian bytes.
// Follows TweetNaCl's pack25519 exactly.
static void gf_pack(uint8_t o[32], Gf n) {
    Gf m;
    // Three rounds of carry to produce non-negative limbs
    gf_car(n);
    gf_car(n);
    gf_car(n);

    // Two rounds of conditional subtraction of p = 2^255 − 19
    for (int j = 0; j < 2; j++) {
        m[0] = n[0] - 0xffed;
        for (int i = 1; i < 15; i++) {
            m[i] = n[i] - 0xffff - ((m[i - 1] >> 16) & 1);
            m[i - 1] &= 0xffff;
        }
        m[15] = n[15] - 0x7fff - ((m[14] >> 16) & 1);
        m[14] &= 0xffff;
        int b = static_cast<int>((m[15] >> 16) & 1);
        m[15] &= 0xffff;
        gf_cswap(n, m, 1 - b);
    }

    for (int i = 0; i < 16; i++) {
        o[2 * i]     = static_cast<uint8_t>(n[i] & 0xff);
        o[2 * i + 1] = static_cast<uint8_t>(n[i] >> 8);
    }
}

// Unpack 32 little-endian bytes → field element (clear bit 255).
static void gf_unpack(Gf& o, const uint8_t n[32]) {
    for (int i = 0; i < 16; i++)
        o[i] = static_cast<i64>(n[2 * i]) | (static_cast<i64>(n[2 * i + 1]) << 8);
    o[15] &= 0x7fff;  // clear bit 255
}

// Compare packed forms for inequality. Returns 0 if equal.
static int gf_neq(const Gf& a, const Gf& b) {
    uint8_t pa[32], pb[32];
    Gf ca = a, cb = b;
    gf_pack(pa, ca);
    gf_pack(pb, cb);
    uint32_t d = 0;
    for (int i = 0; i < 32; i++) d |= pa[i] ^ pb[i];
    return (d != 0) ? 1 : 0;
}

// Parity of the field element (least significant bit of canonical form).
static int gf_par(const Gf& a) {
    uint8_t d[32];
    Gf t = a;
    gf_pack(d, t);
    return d[0] & 1;
}

// a^(p−2) — modular inverse via Fermat's little theorem.
// p−2 = 2^255 − 21, binary: all 1s except bits 2 and 4 are 0.
static void gf_inv(Gf& o, const Gf& a) {
    Gf c;
    gf_set(c, a);
    for (int i = 253; i >= 0; i--) {
        gf_sq(c, c);
        if (i != 2 && i != 4) gf_mul(c, c, a);
    }
    gf_set(o, c);
}

// a^((p−5)/8) = a^(2^252 − 3) — used for square-root computation.
// 2^252 − 3 in binary: all 1s except bit 1 is 0.
static void gf_pow2523(Gf& o, const Gf& a) {
    Gf c;
    gf_set(c, a);
    for (int i = 250; i >= 0; i--) {
        gf_sq(c, c);
        if (i != 1) gf_mul(c, c, a);
    }
    gf_set(o, c);
}

// ═════════════════════════════════════════════════════════════════════════════
// Curve operations — extended twisted Edwards coordinates (X, Y, Z, T)
//   where  x = X/Z,  y = Y/Z,  x·y = T/Z
// ═════════════════════════════════════════════════════════════════════════════

struct Ge { Gf X, Y, Z, T; };

// Point addition: r = p + q  (unified formula, works for doubling too)
static void ge_add(Ge& r, const Ge& p, const Ge& q) {
    Gf a, b, c, d, e, f, g, h, t;

    gf_sub(a, p.Y, p.X);       // a = Y1 − X1
    gf_sub(t, q.Y, q.X);       // t = Y2 − X2
    gf_mul(a, a, t);            // a = (Y1−X1)(Y2−X2)

    gf_add(b, p.X, p.Y);       // b = X1 + Y1
    gf_add(t, q.X, q.Y);       // t = X2 + Y2
    gf_mul(b, b, t);            // b = (X1+Y1)(X2+Y2)

    gf_mul(c, p.T, q.T);
    gf_mul(c, c, D2);           // c = T1 · T2 · 2d

    gf_mul(d, p.Z, q.Z);
    gf_add(d, d, d);            // d = 2 · Z1 · Z2

    gf_sub(e, b, a);            // e = b − a
    gf_sub(f, d, c);            // f = d − c
    gf_add(g, d, c);            // g = d + c
    gf_add(h, b, a);            // h = b + a

    gf_mul(r.X, e, f);          // X3 = e · f
    gf_mul(r.Y, h, g);          // Y3 = h · g
    gf_mul(r.Z, g, f);          // Z3 = g · f
    gf_mul(r.T, e, h);          // T3 = e · h
}

// Scalar multiplication: r = [s] · P  (variable-time, fine for verification)
static void ge_scalarmult(Ge& r, const Ge& P, const uint8_t s[32]) {
    Ge p, q;
    // p = identity = (0, 1, 1, 0)
    gf_set(p.X, GF0);
    gf_set(p.Y, GF1);
    gf_set(p.Z, GF1);
    gf_set(p.T, GF0);
    // q = P
    q = P;

    for (int i = 255; i >= 0; i--) {
        uint8_t bit = (s[i / 8] >> (i & 7)) & 1;
        gf_cswap(p.X, q.X, bit);
        gf_cswap(p.Y, q.Y, bit);
        gf_cswap(p.Z, q.Z, bit);
        gf_cswap(p.T, q.T, bit);

        ge_add(q, q, p);       // q = q + p
        ge_add(p, p, p);       // p = 2·p

        gf_cswap(p.X, q.X, bit);
        gf_cswap(p.Y, q.Y, bit);
        gf_cswap(p.Z, q.Z, bit);
        gf_cswap(p.T, q.T, bit);
    }
    r = p;
}

// Encode point to 32 bytes: pack y, then set high bit to sign of x.
static void ge_tobytes(uint8_t s[32], const Ge& p) {
    Gf tx, ty, zi;
    gf_inv(zi, p.Z);
    gf_mul(tx, p.X, zi);
    gf_mul(ty, p.Y, zi);
    gf_pack(s, ty);
    s[31] ^= static_cast<uint8_t>(gf_par(tx) << 7);
}

// Decode 32 bytes → point in extended coordinates, negating x for verification.
// Returns 0 on success, −1 if not a valid curve point.
static int ge_frombytes_negate(Ge& r, const uint8_t s[32]) {
    Gf num, den, den2, den4, den6, t, chk;

    gf_set(r.Z, GF1);
    gf_unpack(r.Y, s);

    gf_sq(num, r.Y);            // num = y²
    gf_mul(den, num, D);        // den = d · y²
    gf_sub(num, num, r.Z);      // num = y² − 1
    gf_add(den, r.Z, den);      // den = 1 + d · y²

    gf_sq(den2, den);            // den²
    gf_sq(den4, den2);           // den⁴
    gf_mul(den6, den4, den2);    // den⁶

    gf_mul(t, den6, num);        // num · den⁶
    gf_mul(t, t, den);           // num · den⁷
    gf_pow2523(t, t);            // (num · den⁷)^((p−5)/8)

    gf_mul(t, t, num);           // · num
    gf_mul(t, t, den);           // · den
    gf_mul(t, t, den);           // · den²
    gf_mul(r.X, t, den);         // · den³  →  candidate x

    gf_sq(chk, r.X);
    gf_mul(chk, chk, den);       // x² · den
    if (gf_neq(chk, num))        // if x² · den ≠ num
        gf_mul(r.X, r.X, SQRTM1); //   try x · √(−1)

    gf_sq(chk, r.X);
    gf_mul(chk, chk, den);
    if (gf_neq(chk, num))        // still doesn't match → invalid point
        return -1;

    // Negate x: we want −A, so if parity(x) matches the sign bit, negate.
    if (gf_par(r.X) == (s[31] >> 7))
        gf_sub(r.X, GF0, r.X);

    gf_mul(r.T, r.X, r.Y);
    return 0;
}

// ═════════════════════════════════════════════════════════════════════════════
// Scalar arithmetic  (mod l, the group order)
//   l = 2^252 + 27742317777372353535851937790883648493
// ═════════════════════════════════════════════════════════════════════════════

static const uint8_t L[32] = {
    0xed, 0xd3, 0xf5, 0x5c, 0x1a, 0x63, 0x12, 0x58,
    0xd6, 0x9c, 0xf7, 0xa2, 0xde, 0xf9, 0xde, 0x14,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x10
};

// Reduce a 64-byte scalar (SHA-512 output) mod l → 32 bytes.
static void sc_reduce(uint8_t r[32], const uint8_t h[64]) {
    i64 x[64];
    for (int i = 0; i < 64; i++) x[i] = static_cast<i64>(h[i]);

    for (int i = 63; i >= 32; i--) {
        i64 carry = 0;
        for (int j = i - 32; j < i - 12; j++) {
            x[j] += carry - 16 * x[i] * static_cast<i64>(L[j - (i - 32)]);
            carry = (x[j] + 128) >> 8;
            x[j] -= carry << 8;
        }
        x[i - 12] += carry;
        x[i] = 0;
    }

    i64 carry = 0;
    for (int j = 0; j < 32; j++) {
        x[j] += carry - (x[31] >> 4) * static_cast<i64>(L[j]);
        carry = x[j] >> 8;
        x[j] &= 0xff;
    }
    for (int j = 0; j < 32; j++)
        x[j] -= carry * static_cast<i64>(L[j]);
    for (int i = 0; i < 32; i++)
        r[i] = static_cast<uint8_t>(x[i]);
}

// ═════════════════════════════════════════════════════════════════════════════
// Ed25519 verification  (RFC 8032 §5.1.7)
// ═════════════════════════════════════════════════════════════════════════════

static bool ed25519_verify(const uint8_t* msg, size_t msgLen,
                           const uint8_t sig[64], const uint8_t pk[32]) {
    // 1. Quick-reject: if top 3 bits of S are set → S ≥ l
    if (sig[63] & 0xe0) return false;

    // 2. Decode public key as point, negate for R = [S]B − [h]A
    Ge A;
    if (ge_frombytes_negate(A, pk) != 0) return false;

    // 3.  h = SHA-512(R‖pk‖msg)  reduced mod l
    //    Build the hash input incrementally:
    size_t totalLen = 32 + 32 + msgLen;
    std::vector<uint8_t> hashInput(totalLen);
    std::memcpy(hashInput.data(),      sig, 32);       // R
    std::memcpy(hashInput.data() + 32, pk,  32);       // pk
    if (msgLen > 0)
        std::memcpy(hashInput.data() + 64, msg, msgLen);

    auto hFull = sha512(hashInput.data(), totalLen);
    uint8_t h[32];
    sc_reduce(h, hFull.data());

    // 4.  Compute  [S]B + [h](−A)
    //     where S = sig[32..63] (little-endian scalar)
    Ge sB, hA, result;

    //  [S]B
    Ge B;
    gf_set(B.X, GX);
    gf_set(B.Y, GY);
    gf_set(B.Z, GF1);
    gf_mul(B.T, GX, GY);
    ge_scalarmult(sB, B, sig + 32);

    //  [h](−A)
    ge_scalarmult(hA, A, h);

    //  result = [S]B + [h](−A)
    ge_add(result, sB, hA);

    // 5. Encode result and compare with R (first 32 bytes of signature)
    uint8_t check[32];
    ge_tobytes(check, result);

    uint32_t diff = 0;
    for (int i = 0; i < 32; i++) diff |= check[i] ^ sig[i];
    return diff == 0;
}

} // anonymous namespace

// ═════════════════════════════════════════════════════════════════════════════
// Public API
// ═════════════════════════════════════════════════════════════════════════════

bool verifyEd25519Hex(const std::string& messageHex,
                      const std::string& signatureHex,
                      const std::string& publicKeyHex) {
    std::vector<uint8_t> msg, sig, pk;
    try {
        msg = fromHex(messageHex);
        sig = fromHex(signatureHex);
        pk  = fromHex(publicKeyHex);
    } catch (...) {
        return false;
    }

    if (pk.size() != 32 || sig.size() != 64) return false;

    return ed25519_verify(msg.data(), msg.size(), sig.data(), pk.data());
}

} // namespace poc
