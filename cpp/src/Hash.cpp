#include "Hash.h"

#include <cmath>
#include <cstring>

namespace poc {

// ─── Core Hash Functions ─────────────────────────────────────────────────────

std::string sha256Hex(const std::string& data) {
    return toHex(sha256(data));
}

std::string hash256Hex(const std::string& data) {
    std::vector<uint8_t> bytes(data.begin(), data.end());
    return toHex(hash256(bytes));
}

// ─── Serialization Helpers ───────────────────────────────────────────────────

std::vector<uint8_t> serializeString(const std::string& value) {
    std::vector<uint8_t> result;
    uint16_t len = static_cast<uint16_t>(value.size());
    // 2-byte big-endian length prefix
    result.push_back(static_cast<uint8_t>(len >> 8));
    result.push_back(static_cast<uint8_t>(len & 0xFF));
    // UTF-8 string bytes
    result.insert(result.end(), value.begin(), value.end());
    return result;
}

std::vector<uint8_t> serializeAmount(double amount) {
    // Fixed-point: amount × 10^8 as 8-byte big-endian
    uint64_t units = static_cast<uint64_t>(std::llround(amount * 1e8));
    std::vector<uint8_t> buf(8);
    for (int i = 7; i >= 0; --i) {
        buf[7 - i] = static_cast<uint8_t>(units >> (i * 8));
    }
    return buf;
}

std::vector<uint8_t> concat(const std::vector<std::vector<uint8_t>>& parts) {
    size_t total = 0;
    for (const auto& p : parts) total += p.size();
    std::vector<uint8_t> result;
    result.reserve(total);
    for (const auto& p : parts) {
        result.insert(result.end(), p.begin(), p.end());
    }
    return result;
}

std::vector<uint8_t> serializeUint16BE(uint16_t value) {
    return { static_cast<uint8_t>(value >> 8), static_cast<uint8_t>(value & 0xFF) };
}

std::vector<uint8_t> serializeUint32LE(uint32_t value) {
    return {
        static_cast<uint8_t>(value & 0xFF),
        static_cast<uint8_t>((value >> 8) & 0xFF),
        static_cast<uint8_t>((value >> 16) & 0xFF),
        static_cast<uint8_t>((value >> 24) & 0xFF),
    };
}

} // namespace poc
