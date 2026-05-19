#include "MerkleTree.h"
#include "Hash.h"

#include <cstring>

namespace poc {

// hash256 of 32 zero bytes (empty tree root)
static Digest computeEmptyRoot() {
    std::vector<uint8_t> zeros(32, 0);
    return hash256(zeros);
}

static const Digest EMPTY_ROOT = computeEmptyRoot();

// ─── Compute Merkle Root ─────────────────────────────────────────────────────

Digest computeMerkleRoot(const std::vector<Digest>& leaves) {
    if (leaves.empty()) {
        return EMPTY_ROOT;
    }

    // Copy leaves into working level
    std::vector<Digest> level = leaves;

    while (level.size() > 1) {
        std::vector<Digest> next;

        for (size_t i = 0; i < level.size(); i += 2) {
            const Digest& left = level[i];
            // Bitcoin convention: duplicate last leaf if odd count
            const Digest& right = (i + 1 < level.size()) ? level[i + 1] : left;

            // Concatenate left + right (64 bytes) and double-hash
            std::vector<uint8_t> combined(64);
            std::memcpy(combined.data(), left.data(), 32);
            std::memcpy(combined.data() + 32, right.data(), 32);
            next.push_back(hash256(combined));
        }

        level = std::move(next);
    }

    return level[0];
}

// ─── Hex Convenience ─────────────────────────────────────────────────────────

std::string merkleRootHex(const std::vector<std::string>& leafHexHashes) {
    std::vector<Digest> bufs;
    bufs.reserve(leafHexHashes.size());

    for (const auto& h : leafHexHashes) {
        auto bytes = fromHex(h);
        Digest d;
        if (bytes.size() != 32) {
            // Pad or truncate to 32 bytes (shouldn't happen with valid input)
            std::memset(d.data(), 0, 32);
            std::memcpy(d.data(), bytes.data(), std::min(bytes.size(), size_t(32)));
        } else {
            std::memcpy(d.data(), bytes.data(), 32);
        }
        bufs.push_back(d);
    }

    return toHex(computeMerkleRoot(bufs));
}

// ─── Build Merkle Proof ──────────────────────────────────────────────────────

MerkleProof buildMerkleProof(const std::vector<Digest>& leaves, size_t leafIndex) {
    MerkleProof proof;

    if (leaves.empty() || leafIndex >= leaves.size()) {
        return proof;
    }

    std::vector<Digest> level = leaves;
    size_t idx = leafIndex;

    while (level.size() > 1) {
        std::vector<Digest> next;

        for (size_t i = 0; i < level.size(); i += 2) {
            const Digest& left = level[i];
            const Digest& right = (i + 1 < level.size()) ? level[i + 1] : left;

            if (i == idx || i + 1 == idx) {
                if (idx % 2 == 0) {
                    // Target is left child, sibling is right
                    proof.siblings.push_back(right);
                    proof.directions.push_back(ProofDirection::Right);
                } else {
                    // Target is right child, sibling is left
                    proof.siblings.push_back(left);
                    proof.directions.push_back(ProofDirection::Left);
                }
            }

            std::vector<uint8_t> combined(64);
            std::memcpy(combined.data(), left.data(), 32);
            std::memcpy(combined.data() + 32, right.data(), 32);
            next.push_back(hash256(combined));
        }

        idx /= 2;
        level = std::move(next);
    }

    return proof;
}

// ─── Verify Merkle Proof ─────────────────────────────────────────────────────

bool verifyMerkleProof(const Digest& leaf, const MerkleProof& proof, const Digest& root) {
    Digest current = leaf;

    for (size_t i = 0; i < proof.siblings.size(); ++i) {
        const Digest& sibling = proof.siblings[i];
        std::vector<uint8_t> combined(64);

        if (proof.directions[i] == ProofDirection::Right) {
            // Sibling is on the right
            std::memcpy(combined.data(), current.data(), 32);
            std::memcpy(combined.data() + 32, sibling.data(), 32);
        } else {
            // Sibling is on the left
            std::memcpy(combined.data(), sibling.data(), 32);
            std::memcpy(combined.data() + 32, current.data(), 32);
        }

        current = hash256(combined);
    }

    return current == root;
}

} // namespace poc
