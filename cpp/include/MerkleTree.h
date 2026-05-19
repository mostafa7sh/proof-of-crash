#pragma once

#include "SHA256.h"
#include <string>
#include <vector>

namespace poc {

/// Direction of a sibling in a Merkle proof path.
enum class ProofDirection { Left, Right };

/// A Merkle inclusion proof: sibling hashes + direction flags.
struct MerkleProof {
    std::vector<Digest> siblings;
    std::vector<ProofDirection> directions;
};

/**
 * Bitcoin-style Merkle tree.
 *
 * - Leaves are 32-byte hashes (Digest).
 * - Pairs concatenated and double-SHA256'd.
 * - Odd leaf count: last leaf duplicated (Bitcoin convention).
 * - Empty tree: hash256 of 32 zero bytes.
 */

/// Compute Merkle root from an array of 32-byte leaf hashes.
Digest computeMerkleRoot(const std::vector<Digest>& leaves);

/// Hex-string leaf hashes → hex-string root (convenience).
std::string merkleRootHex(const std::vector<std::string>& leafHexHashes);

/// Build a Merkle proof (path from leaf to root) for inclusion verification.
MerkleProof buildMerkleProof(const std::vector<Digest>& leaves, size_t leafIndex);

/// Verify a Merkle proof against a known root.
bool verifyMerkleProof(const Digest& leaf, const MerkleProof& proof, const Digest& root);

} // namespace poc
