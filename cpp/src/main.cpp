#include "SHA256.h"
#include "SHA512.h"
#include "Hash.h"
#include "MerkleTree.h"
#include "Transaction.h"
#include "Block.h"
#include "Consensus.h"
#include "Blockchain.h"
#include "Mempool.h"
#include "Ed25519.h"
#include "MiniJson.h"
#include "TxValidation.h"

#include <cassert>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <iostream>
#include <iomanip>

using namespace poc;

// ─── Test Helpers ────────────────────────────────────────────────────────────

static int passed = 0;
static int failed = 0;

#define TEST(name) \
    std::cout << "  " << name << "... "; \
    try {

#define PASS() \
    std::cout << "PASS" << std::endl; \
    ++passed; \
    } catch (const std::exception& e) { \
        std::cout << "FAIL: " << e.what() << std::endl; \
        ++failed; \
    }

#define EXPECT(cond) \
    if (!(cond)) throw std::runtime_error("Assertion failed: " #cond)

#define EXPECT_EQ(a, b) \
    if ((a) != (b)) throw std::runtime_error( \
        std::string("Expected ") + #a + " == " + #b)

// ─── SHA256 Tests ────────────────────────────────────────────────────────────

void testSHA256() {
    std::cout << "\n[SHA256]" << std::endl;

    TEST("empty string")
        auto d = sha256(std::string(""));
        EXPECT_EQ(toHex(d), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    PASS()

    TEST("abc")
        auto d = sha256(std::string("abc"));
        EXPECT_EQ(toHex(d), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    PASS()

    TEST("longer input (448-bit boundary)")
        auto d = sha256(std::string("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq"));
        EXPECT_EQ(toHex(d), "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1");
    PASS()

    TEST("double SHA256 (hash256)")
        // hash256("") = SHA256(SHA256(""))
        std::vector<uint8_t> empty;
        auto d = hash256(empty);
        // SHA256("") = e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
        // SHA256(SHA256("")) = 5df6e0e2761359d30a8275058e299fcc0381534545f55cf43e41983f5d4c9456
        EXPECT_EQ(toHex(d), "5df6e0e2761359d30a8275058e299fcc0381534545f55cf43e41983f5d4c9456");
    PASS()
}

// ─── SHA512 Tests ───────────────────────────────────────────────────────────

void testSHA512() {
    std::cout << "\n[SHA512]" << std::endl;

    TEST("empty string")
        auto d = sha512(std::string(""));
        std::string hex;
        for (auto b : d) { char buf[3]; snprintf(buf, sizeof(buf), "%02x", b); hex += buf; }
        EXPECT_EQ(hex, "cf83e1357eefb8bdf1542850d66d8007d620e4050b5715dc83f4a921d36ce9ce47d0d13c5d85f2b0ff8318d2877eec2f63b931bd47417a81a538327af927da3e");
    PASS()

    TEST("abc")
        auto d = sha512(std::string("abc"));
        std::string hex;
        for (auto b : d) { char buf[3]; snprintf(buf, sizeof(buf), "%02x", b); hex += buf; }
        EXPECT_EQ(hex, "ddaf35a193617abacc417349ae20413112e6fa4e89a97ea20a9eeee64b55d39a2192992a274fc1a836ba3c23a3feebbd454d4423643ce80e2a9ac94fa54ca49f");
    PASS()
}

// ─── Hex Utility Tests ───────────────────────────────────────────────────────

void testHex() {
    std::cout << "\n[Hex Utilities]" << std::endl;

    TEST("roundtrip")
        std::string hex = "deadbeef01020304";
        auto bytes = fromHex(hex);
        EXPECT_EQ(toHex(bytes), hex);
    PASS()

    TEST("fromHex invalid char throws")
        bool threw = false;
        try { fromHex("zz"); } catch (...) { threw = true; }
        EXPECT(threw);
    PASS()
}

// ─── Serialization Tests ─────────────────────────────────────────────────────

void testSerialization() {
    std::cout << "\n[Serialization]" << std::endl;

    TEST("serializeString length prefix")
        auto buf = serializeString("abc");
        EXPECT_EQ(buf.size(), size_t(5));  // 2 length + 3 chars
        EXPECT_EQ(buf[0], 0);
        EXPECT_EQ(buf[1], 3);
        EXPECT_EQ(buf[2], 'a');
    PASS()

    TEST("serializeAmount fixed-point")
        auto buf = serializeAmount(1.5);
        EXPECT_EQ(buf.size(), size_t(8));
        // 1.5 * 10^8 = 150000000 = 0x08F0D180
        uint64_t val = 0;
        for (int i = 0; i < 8; ++i) {
            val = (val << 8) | buf[i];
        }
        EXPECT_EQ(val, uint64_t(150000000));
    PASS()
}

// ─── Merkle Tree Tests ───────────────────────────────────────────────────────

void testMerkleTree() {
    std::cout << "\n[Merkle Tree]" << std::endl;

    TEST("empty tree")
        std::vector<Digest> empty;
        auto root = computeMerkleRoot(empty);
        // Should be hash256 of 32 zero bytes
        std::vector<uint8_t> zeros(32, 0);
        auto expected = hash256(zeros);
        EXPECT(root == expected);
    PASS()

    TEST("single leaf")
        Digest leaf = sha256(std::string("leaf1"));
        auto root = computeMerkleRoot({leaf});
        // With one leaf, Bitcoin convention duplicates it: hash256(leaf || leaf)
        std::vector<uint8_t> combined(64);
        std::memcpy(combined.data(), leaf.data(), 32);
        std::memcpy(combined.data() + 32, leaf.data(), 32);
        // Actually single leaf should return itself... Let me check.
        // For a single leaf, the loop condition `level.size() > 1` is false,
        // so it returns the leaf directly.
        EXPECT(root == leaf);
    PASS()

    TEST("two leaves")
        Digest a = sha256(std::string("a"));
        Digest b = sha256(std::string("b"));
        auto root = computeMerkleRoot({a, b});

        std::vector<uint8_t> combined(64);
        std::memcpy(combined.data(), a.data(), 32);
        std::memcpy(combined.data() + 32, b.data(), 32);
        auto expected = hash256(combined);
        EXPECT(root == expected);
    PASS()

    TEST("proof build + verify")
        Digest a = sha256(std::string("tx0"));
        Digest b = sha256(std::string("tx1"));
        Digest c = sha256(std::string("tx2"));
        std::vector<Digest> leaves = {a, b, c};
        auto root = computeMerkleRoot(leaves);

        // Build and verify proof for index 1
        auto proof = buildMerkleProof(leaves, 1);
        EXPECT(verifyMerkleProof(b, proof, root));

        // Wrong leaf should fail
        EXPECT(!verifyMerkleProof(a, proof, root));
    PASS()
}

// ─── Transaction Tests ───────────────────────────────────────────────────────

void testTransaction() {
    std::cout << "\n[Transaction]" << std::endl;

    TEST("coinbase txId is deterministic")
        std::vector<TxOutput> outputs = {
            {"addr_finder", 294.0, RewardReason::BugBounty},
            {"addr_v1", 126.0, RewardReason::VerificationReward},
        };
        CoinbaseTransaction tx1("proof_abc", outputs);
        CoinbaseTransaction tx2("proof_abc", outputs);
        EXPECT_EQ(tx1.txId(), tx2.txId());
    PASS()

    TEST("different proofId gives different txId")
        std::vector<TxOutput> outputs = {
            {"addr1", 100.0, RewardReason::BugBounty},
        };
        CoinbaseTransaction tx1("proof_a", outputs);
        CoinbaseTransaction tx2("proof_b", outputs);
        EXPECT(tx1.txId() != tx2.txId());
    PASS()

    TEST("totalMinted sums outputs")
        std::vector<TxOutput> outputs = {
            {"a", 100.0, RewardReason::BugBounty},
            {"b", 50.5, RewardReason::VerificationReward},
        };
        CoinbaseTransaction tx("p1", outputs);
        EXPECT(std::abs(tx.totalMinted() - 150.5) < 0.001);
    PASS()

    // ─── TransferTransaction tests ──────────────────────────────────────

    TEST("transfer txId is deterministic")
        std::vector<TxInput> inputs = {
            {"aabbccdd", 0, "sig_placeholder"},
        };
        std::vector<TransferTxOutput> outputs = {
            {"recipient_addr", 50.0},
        };
        TransferTransaction tx1(inputs, outputs);
        TransferTransaction tx2(inputs, outputs);
        EXPECT_EQ(tx1.txId(), tx2.txId());
    PASS()

    TEST("transfer txId ignores signatures (malleability prevention)")
        std::vector<TxInput> inputs1 = {
            {"aabbccdd", 0, "signature_A"},
        };
        std::vector<TxInput> inputs2 = {
            {"aabbccdd", 0, "signature_B"},
        };
        std::vector<TransferTxOutput> outputs = {
            {"recipient_addr", 50.0},
        };
        TransferTransaction tx1(inputs1, outputs);
        TransferTransaction tx2(inputs2, outputs);
        EXPECT_EQ(tx1.txId(), tx2.txId());
    PASS()

    TEST("different inputs give different txId")
        std::vector<TxInput> inputs1 = {{"tx_aaa", 0, "sig"}};
        std::vector<TxInput> inputs2 = {{"tx_bbb", 0, "sig"}};
        std::vector<TransferTxOutput> outputs = {{"addr", 10.0}};
        TransferTransaction tx1(inputs1, outputs);
        TransferTransaction tx2(inputs2, outputs);
        EXPECT(tx1.txId() != tx2.txId());
    PASS()

    TEST("transfer totalOutput sums correctly")
        std::vector<TxInput> inputs = {{"tx_aaa", 0, "sig"}};
        std::vector<TransferTxOutput> outputs = {
            {"addr1", 30.0},
            {"addr2", 20.5},
        };
        TransferTransaction tx(inputs, outputs);
        EXPECT(std::abs(tx.totalOutput() - 50.5) < 0.001);
    PASS()

    TEST("transfer serialize includes signatures")
        std::vector<TxInput> inputs = {{"tx_aaa", 0, "sig_data"}};
        std::vector<TransferTxOutput> outputs = {{"addr1", 10.0}};
        TransferTransaction tx(inputs, outputs);
        auto full = tx.serialize();
        auto forSigning = tx.serializeForSigning();
        EXPECT(full.size() > forSigning.size());
    PASS()

    TEST("getTxId works for both variant types")
        CoinbaseTransaction cbTx("proof_x", {{"addr", 100.0, RewardReason::BugBounty}});
        TransferTransaction trTx({{"tx_ref", 0, "sig"}}, {{"addr2", 50.0}});
        Transaction v1 = cbTx;
        Transaction v2 = trTx;
        EXPECT_EQ(getTxId(v1), cbTx.txId());
        EXPECT_EQ(getTxId(v2), trTx.txId());
    PASS()
}

// ─── Block Tests ─────────────────────────────────────────────────────────────

void testBlock() {
    std::cout << "\n[Block]" << std::endl;

    TEST("genesis block validates")
        auto genesis = Block::createGenesis(1000);
        auto v = genesis.validate(nullptr);
        EXPECT(v.valid);
        EXPECT_EQ(genesis.blockNumber(), uint32_t(0));
        EXPECT(genesis.transactions().empty());
    PASS()

    TEST("genesis hash is deterministic")
        auto g1 = Block::createGenesis(1000);
        auto g2 = Block::createGenesis(1000);
        EXPECT_EQ(g1.hash(), g2.hash());
    PASS()

    TEST("block header is 72 bytes")
        auto genesis = Block::createGenesis(1000);
        EXPECT_EQ(genesis.header().serialize().size(), size_t(72));
    PASS()

    TEST("block with transactions")
        auto genesis = Block::createGenesis(1000);
        std::vector<TxOutput> outputs = {
            {"finder", 294.0, RewardReason::BugBounty},
            {"v1", 126.0, RewardReason::VerificationReward},
        };
        CoinbaseTransaction tx("proof1", outputs);
        auto block1 = Block::build(1, genesis.hash(), {tx}, 2000);
        auto v = block1.validate(&genesis);
        EXPECT(v.valid);
        EXPECT_EQ(block1.blockNumber(), uint32_t(1));
        EXPECT(std::abs(block1.totalMinted() - 420.0) < 0.001);
    PASS()

    TEST("block fails with wrong previous hash")
        auto genesis = Block::createGenesis(1000);
        auto block1 = Block::build(1, std::string(64, 'a'), {}, 2000);
        auto v = block1.validate(&genesis);
        EXPECT(!v.valid);
    PASS()

    TEST("block fails with non-monotonic timestamp")
        auto genesis = Block::createGenesis(1000);
        auto block1 = Block::build(1, genesis.hash(), {}, 500);
        auto v = block1.validate(&genesis);
        EXPECT(!v.valid);
    PASS()
}

// ─── Consensus Tests ─────────────────────────────────────────────────────────

void testConsensus() {
    std::cout << "\n[Consensus]" << std::endl;

    TEST("computeMedian odd count")
        EXPECT(std::abs(computeMedian({3.0, 1.0, 2.0}) - 2.0) < 0.001);
    PASS()

    TEST("computeMedian even count")
        EXPECT(std::abs(computeMedian({1.0, 2.0, 3.0, 4.0}) - 2.5) < 0.001);
    PASS()

    TEST("calculateRewards fixed split")
        std::vector<VerifierVote> votes = {
            {"v1", 4.2},
            {"v2", 4.1},
            {"v3", 3.1},
        };
        auto r = calculateRewards(votes);
        EXPECT(std::abs(r.medianScore - 4.1) < 0.001);
        // The block reward is fixed: finder 70%, validators 30% — independent
        // of the median score (the median only shapes the validator split).
        EXPECT(std::abs(r.baseReward - 1000.0) < 0.001);
        EXPECT(std::abs(r.finderReward - 700.0) < 0.001);
        EXPECT(std::abs(r.verifierPool - 300.0) < 0.001);
    PASS()

    TEST("reward distribution always sums to the full block reward")
        // Even with an outlier and uneven distances, finder + validators must
        // equal BLOCK_REWARD exactly (no minted dust, no over-mint).
        std::vector<VerifierVote> votes = {
            {"v1", 4.2},
            {"v2", 4.1},
            {"v3", 2.0},   // far from the median
            {"v4", 4.0},
        };
        auto r = calculateRewards(votes);
        double verifierTotal = 0.0;
        for (const auto& p : r.payouts) verifierTotal += p.reward;
        EXPECT(std::abs(verifierTotal - 300.0) < 0.001);
        EXPECT(std::abs(r.totalMinted - 1000.0) < 0.001);
    PASS()

    TEST("closer-to-median validators earn a larger share")
        std::vector<VerifierVote> votes = {
            {"v1", 4.1},   // exactly the median — should earn the most
            {"v2", 4.1},
            {"v3", 2.0},   // an outlier — still paid, but the least
        };
        auto r = calculateRewards(votes);
        double onMedian = 0.0, outlier = 0.0;
        for (const auto& p : r.payouts) {
            if (p.address == "v1") onMedian = p.reward;
            if (p.address == "v3") outlier = p.reward;
        }
        EXPECT(outlier > 0.0);          // every validator gets a proportional share
        EXPECT(onMedian > outlier);     // closer to the median ⇒ larger share
    PASS()

    TEST("too few votes throws")
        bool threw = false;
        try {
            calculateRewards({{"v1", 4.0}, {"v2", 4.0}});
        } catch (...) { threw = true; }
        EXPECT(threw);
    PASS()

    TEST("checkFinalization not enough votes")
        auto r = checkFinalization(2, 1000, 2000);
        EXPECT(!r.canFinalize);
    PASS()

    TEST("checkFinalization before deadline")
        auto r = checkFinalization(5, 2000, 1000);
        EXPECT(!r.canFinalize);
    PASS()

    TEST("checkFinalization ready")
        auto r = checkFinalization(5, 1000, 2000);
        EXPECT(r.canFinalize);
    PASS()

    TEST("buildCoinbaseTransaction outputs")
        std::vector<VerifierVote> votes = {
            {"v1", 4.2}, {"v2", 4.2}, {"v3", 4.2},
        };
        auto rewards = calculateRewards(votes);
        auto tx = buildCoinbaseTransaction("proof_x", "finder_addr", rewards);
        EXPECT(!tx.outputs().empty());
        EXPECT_EQ(tx.outputs()[0].address, std::string("finder_addr"));
        EXPECT_EQ(tx.outputs()[0].reason, RewardReason::BugBounty);
    PASS()
}

// ─── Blockchain Tests ────────────────────────────────────────────────────────

void testBlockchain() {
    std::cout << "\n[Blockchain]" << std::endl;

    TEST("initialize creates genesis")
        Blockchain chain;
        chain.initialize(1000);
        EXPECT_EQ(chain.tipHeight(), 0);
        EXPECT(!chain.tipHash().empty());
    PASS()

    TEST("add blocks and track supply")
        Blockchain chain;
        chain.initialize(1000);

        std::vector<TxOutput> outputs = {
            {"finder", 294.0, RewardReason::BugBounty},
            {"v1", 126.0, RewardReason::VerificationReward},
        };
        CoinbaseTransaction tx("proof1", outputs);
        chain.addBlock({tx}, 2000);

        EXPECT_EQ(chain.tipHeight(), 1);
        EXPECT(std::abs(chain.getTotalSupply() - 420.0) < 0.001);
        EXPECT(std::abs(chain.getBalance("finder") - 294.0) < 0.001);
        EXPECT(std::abs(chain.getBalance("v1") - 126.0) < 0.001);
        EXPECT(std::abs(chain.getBalance("unknown") - 0.0) < 0.001);
    PASS()

    TEST("chain validation passes")
        Blockchain chain;
        chain.initialize(1000);
        chain.addBlock({}, 2000);
        chain.addBlock({}, 3000);
        auto v = chain.validateChain();
        EXPECT(v.valid);
        EXPECT_EQ(v.height, 2);
    PASS()

    TEST("getBlockByNumber")
        Blockchain chain;
        chain.initialize(1000);
        chain.addBlock({}, 2000);
        auto b = chain.getBlockByNumber(0);
        EXPECT(b != nullptr);
        EXPECT_EQ(b->blockNumber(), uint32_t(0));
        auto b1 = chain.getBlockByNumber(1);
        EXPECT(b1 != nullptr);
        EXPECT_EQ(b1->blockNumber(), uint32_t(1));
        auto b2 = chain.getBlockByNumber(99);
        EXPECT(b2 == nullptr);
    PASS()

    TEST("getBlockByHash")
        Blockchain chain;
        chain.initialize(1000);
        auto hash = chain.tipHash();
        auto b = chain.getBlockByHash(hash);
        EXPECT(b != nullptr);
        EXPECT_EQ(b->hash(), hash);
        auto b2 = chain.getBlockByHash("nonexistent");
        EXPECT(b2 == nullptr);
    PASS()

    TEST("block with mixed transaction types")
        Blockchain chain;
        chain.initialize(1000);

        // Block 1: coinbase mints 100 to Alice
        CoinbaseTransaction cbTx("proof_mix", {{"alice", 100.0, RewardReason::BugBounty}});
        chain.addBlock({cbTx}, 2000);

        EXPECT(std::abs(chain.getBalance("alice") - 100.0) < 0.001);

        // Block 2: Alice sends 40 to Bob (transfer) + another coinbase
        TransferTransaction trTx(
            {{cbTx.txId(), 0, "sig_placeholder"}},
            {{"bob", 40.0}, {"alice", 60.0}}  // 40 to Bob, 60 change to Alice
        );
        CoinbaseTransaction cbTx2("proof_mix2", {{"carol", 50.0, RewardReason::BugBounty}});

        std::vector<Transaction> mixedTxs = {cbTx2, trTx};
        chain.addBlock(mixedTxs, 3000);

        EXPECT_EQ(chain.tipHeight(), 2);
        EXPECT(std::abs(chain.getBalance("alice") - 60.0) < 0.001);
        EXPECT(std::abs(chain.getBalance("bob") - 40.0) < 0.001);
        EXPECT(std::abs(chain.getBalance("carol") - 50.0) < 0.001);
    PASS()

    TEST("totalMinted only counts coinbase in mixed blocks")
        Blockchain chain;
        chain.initialize(1000);

        CoinbaseTransaction cbTx("proof_m1", {{"alice", 200.0, RewardReason::BugBounty}});
        chain.addBlock({cbTx}, 2000);

        // Block 2: transfer (no minting) + coinbase (mints 75)
        TransferTransaction trTx(
            {{cbTx.txId(), 0, "sig"}},
            {{"bob", 200.0}}
        );
        CoinbaseTransaction cbTx2("proof_m2", {{"carol", 75.0, RewardReason::BugBounty}});
        chain.addBlock({Transaction(cbTx2), Transaction(trTx)}, 3000);

        // Total supply = 200 (block 1) + 75 (block 2) = 275
        // Transfer moves tokens, doesn't create new ones
        EXPECT(std::abs(chain.getTotalSupply() - 275.0) < 0.001);
    PASS()

    TEST("UTXO spending removes spent outputs")
        Blockchain chain;
        chain.initialize(1000);

        CoinbaseTransaction cbTx("proof_s1", {
            {"alice", 100.0, RewardReason::BugBounty},
            {"bob", 50.0, RewardReason::VerificationReward},
        });
        chain.addBlock({cbTx}, 2000);

        // Alice spends her 100 → 70 to carol, 30 back to alice
        TransferTransaction trTx(
            {{cbTx.txId(), 0, "sig"}},
            {{"carol", 70.0}, {"alice", 30.0}}
        );
        chain.addBlock({trTx}, 3000);

        // Alice's original UTXO (100) is spent, new one (30) exists
        EXPECT(std::abs(chain.getBalance("alice") - 30.0) < 0.001);
        // Bob's UTXO untouched
        EXPECT(std::abs(chain.getBalance("bob") - 50.0) < 0.001);
        // Carol has new UTXO
        EXPECT(std::abs(chain.getBalance("carol") - 70.0) < 0.001);
    PASS()

    TEST("chain validates with mixed transaction types")
        Blockchain chain;
        chain.initialize(1000);

        CoinbaseTransaction cbTx("proof_cv", {{"alice", 100.0, RewardReason::BugBounty}});
        chain.addBlock({cbTx}, 2000);

        TransferTransaction trTx(
            {{cbTx.txId(), 0, "sig"}},
            {{"bob", 100.0}}
        );
        chain.addBlock({trTx}, 3000);

        auto v = chain.validateChain();
        EXPECT(v.valid);
        EXPECT_EQ(v.height, 2);
    PASS()
}

// ─── Mempool Tests ──────────────────────────────────────────────────────────

void testMempool() {
    std::cout << "\n[Mempool]" << std::endl;

    TEST("add and retrieve transaction")
        Mempool mempool;
        TransferTransaction tx({{"tx_aaa", 0, "sig"}}, {{"bob", 50.0}});
        auto result = mempool.addTransaction(tx);
        EXPECT(result.success);
        EXPECT_EQ(mempool.size(), size_t(1));
        auto* found = mempool.getTransaction(tx.txId());
        EXPECT(found != nullptr);
        EXPECT_EQ(found->txId(), tx.txId());
    PASS()

    TEST("reject duplicate transaction")
        Mempool mempool;
        TransferTransaction tx({{"tx_aaa", 0, "sig"}}, {{"bob", 50.0}});
        mempool.addTransaction(tx);
        auto r = mempool.addTransaction(tx);
        EXPECT(!r.success);
        EXPECT_EQ(mempool.size(), size_t(1));
    PASS()

    TEST("reject double-spend within mempool")
        Mempool mempool;
        TransferTransaction tx1({{"tx_aaa", 0, "sig1"}}, {{"bob", 50.0}});
        TransferTransaction tx2({{"tx_aaa", 0, "sig2"}}, {{"carol", 50.0}});
        auto r1 = mempool.addTransaction(tx1);
        EXPECT(r1.success);
        auto r2 = mempool.addTransaction(tx2);
        EXPECT(!r2.success);
    PASS()

    TEST("isSpentInMempool tracks claimed UTXOs")
        Mempool mempool;
        TransferTransaction tx({{"tx_aaa", 0, "sig"}}, {{"bob", 50.0}});
        EXPECT(!mempool.isSpentInMempool("tx_aaa", 0));
        mempool.addTransaction(tx);
        EXPECT(mempool.isSpentInMempool("tx_aaa", 0));
        EXPECT(!mempool.isSpentInMempool("tx_aaa", 1));
    PASS()

    TEST("drainTransactions removes from mempool")
        Mempool mempool;
        TransferTransaction tx1({{"tx_aaa", 0, "sig"}}, {{"bob", 30.0}});
        TransferTransaction tx2({{"tx_bbb", 0, "sig"}}, {{"carol", 40.0}});
        mempool.addTransaction(tx1);
        mempool.addTransaction(tx2);
        EXPECT_EQ(mempool.size(), size_t(2));

        auto drained = mempool.drainTransactions(1);
        EXPECT_EQ(drained.size(), size_t(1));
        EXPECT_EQ(mempool.size(), size_t(1));

        // The drained tx's UTXO key should no longer be in spentInMempool
        EXPECT(!mempool.isSpentInMempool("tx_aaa", 0));
        EXPECT(mempool.isSpentInMempool("tx_bbb", 0));
    PASS()

    TEST("removeTransaction cleans up spent keys")
        Mempool mempool;
        TransferTransaction tx({{"tx_ccc", 0, "sig"}}, {{"dave", 25.0}});
        mempool.addTransaction(tx);
        EXPECT(mempool.isSpentInMempool("tx_ccc", 0));
        mempool.removeTransaction(tx.txId());
        EXPECT(!mempool.isSpentInMempool("tx_ccc", 0));
        EXPECT_EQ(mempool.size(), size_t(0));
    PASS()

    TEST("getPending returns insertion order")
        Mempool mempool;
        TransferTransaction tx1({{"tx_111", 0, "sig"}}, {{"a", 10.0}});
        TransferTransaction tx2({{"tx_222", 0, "sig"}}, {{"b", 20.0}});
        TransferTransaction tx3({{"tx_333", 0, "sig"}}, {{"c", 30.0}});
        mempool.addTransaction(tx1);
        mempool.addTransaction(tx2);
        mempool.addTransaction(tx3);

        auto pending = mempool.getPending();
        EXPECT_EQ(pending.size(), size_t(3));
        EXPECT_EQ(pending[0]->txId(), tx1.txId());
        EXPECT_EQ(pending[1]->txId(), tx2.txId());
        EXPECT_EQ(pending[2]->txId(), tx3.txId());
    PASS()
}

// ─── Blockchain Extended Tests (isUTXOUnspent, getUTXOs) ────────────────────

void testBlockchainExtended() {
    std::cout << "\n[Blockchain Extended]" << std::endl;

    TEST("isUTXOUnspent returns true for unspent")
        Blockchain chain;
        chain.initialize(1000);
        CoinbaseTransaction cbTx("proof_u1", {{"alice", 100.0, RewardReason::BugBounty}});
        chain.addBlock({cbTx}, 2000);
        EXPECT(chain.isUTXOUnspent(cbTx.txId(), 0));
        EXPECT(!chain.isUTXOUnspent(cbTx.txId(), 1));  // doesn't exist
        EXPECT(!chain.isUTXOUnspent("nonexistent", 0));
    PASS()

    TEST("isUTXOUnspent returns false after spending")
        Blockchain chain;
        chain.initialize(1000);
        CoinbaseTransaction cbTx("proof_u2", {{"alice", 100.0, RewardReason::BugBounty}});
        chain.addBlock({cbTx}, 2000);
        EXPECT(chain.isUTXOUnspent(cbTx.txId(), 0));

        TransferTransaction trTx({{cbTx.txId(), 0, "sig"}}, {{"bob", 100.0}});
        chain.addBlock({trTx}, 3000);
        EXPECT(!chain.isUTXOUnspent(cbTx.txId(), 0));  // spent
        EXPECT(chain.isUTXOUnspent(trTx.txId(), 0));   // new UTXO
    PASS()

    TEST("getUTXOs returns correct entries for address")
        Blockchain chain;
        chain.initialize(1000);
        CoinbaseTransaction cbTx("proof_u3", {
            {"alice", 100.0, RewardReason::BugBounty},
            {"alice", 50.0, RewardReason::VerificationReward},
        });
        chain.addBlock({cbTx}, 2000);

        auto utxos = chain.getUTXOs("alice");
        EXPECT_EQ(utxos.size(), size_t(2));
        double total = 0;
        for (const auto& u : utxos) total += u.amount;
        EXPECT(std::abs(total - 150.0) < 0.001);

        auto none = chain.getUTXOs("nobody");
        EXPECT_EQ(none.size(), size_t(0));
    PASS()
}

// ─── Ed25519 Tests ───────────────────────────────────────────────────────────
// RFC 8032 test vectors: https://www.rfc-editor.org/rfc/rfc8032#section-6

void testEd25519() {
    std::cout << "\n[Ed25519]" << std::endl;

    // RFC 8032 §6 TEST 1 — empty message
    const std::string pub1 = "d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a";
    const std::string sig1 = "e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e065224901555fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b";

    TEST("RFC 8032 vector 1: empty message verifies")
        EXPECT(verifyEd25519Hex("", sig1, pub1));
    PASS()

    // RFC 8032 §6 TEST 2 — 1-byte message 0x72
    const std::string pub2 = "3d4017c3e843895a92b70aa74d1b7ebc9c982ccf2ec4968cc0cd55f12af4660c";
    const std::string sig2 = "92a009a9f0d4cab8720e820b5f642540a2b27b5416503f8fb3762223ebdb69da085ac1e43e15996e458f3613d0f11d8c387b2eaeb4302aeeb00d291612bb0c00";

    TEST("RFC 8032 vector 2: 1-byte message verifies")
        EXPECT(verifyEd25519Hex("72", sig2, pub2));
    PASS()

    TEST("wrong signature byte rejected")
        // Flip first byte of sig1
        std::string badSig = "ff" + sig1.substr(2);
        EXPECT(!verifyEd25519Hex("", badSig, pub1));
    PASS()

    TEST("wrong message content rejected")
        EXPECT(!verifyEd25519Hex("ff", sig1, pub1));
    PASS()

    TEST("mismatched key rejected")
        // sig1 was made with pub1; verify against pub2 must fail
        EXPECT(!verifyEd25519Hex("", sig1, pub2));
    PASS()

    TEST("invalid hex returns false without throwing")
        EXPECT(!verifyEd25519Hex("zz", sig1, pub1));
    PASS()

    TEST("short public key rejected")
        EXPECT(!verifyEd25519Hex("", sig1, "d75a98"));
    PASS()

    // RFC 8032 §6 TEST 3 — 2-byte message 0xaf82
    const std::string pub3 = "fc51cd8e6218a1a38da47ed00230f0580816ed13ba3303ac5deb911548908025";
    const std::string sig3 = "6291d657deec24024827e69c3abe01a30ce548a284743a445e3680d7db5ac3ac18ff9b538d16f290ae67f760984dc6594a7c15e9716ed28dc027beceea1ec40a";

    TEST("RFC 8032 vector 3: 2-byte message verifies")
        EXPECT(verifyEd25519Hex("af82", sig3, pub3));
    PASS()
}

// ─── MiniJson Tests ──────────────────────────────────────────────────────────

void testMiniJson() {
    std::cout << "\n[MiniJson]" << std::endl;
    namespace mj = poc::minijson;

    TEST("parse null")
        auto v = mj::Value::parse("null");
        EXPECT(v.isNull());
    PASS()

    TEST("parse booleans")
        EXPECT(mj::Value::parse("true").asBool() == true);
        EXPECT(mj::Value::parse("false").asBool() == false);
    PASS()

    TEST("parse integer")
        auto v = mj::Value::parse("42");
        EXPECT(v.isInt());
        EXPECT_EQ(v.asInt(), 42);
    PASS()

    TEST("parse negative integer")
        EXPECT_EQ(mj::Value::parse("-17").asInt(), -17);
    PASS()

    TEST("parse double with fraction")
        auto v = mj::Value::parse("3.14");
        EXPECT(v.isDouble());
        EXPECT(std::fabs(v.asDouble() - 3.14) < 1e-12);
    PASS()

    TEST("parse string with escapes")
        auto v = mj::Value::parse("\"a\\tb\\\"c\"");
        EXPECT_EQ(v.asString(), std::string("a\tb\"c"));
    PASS()

    TEST("parse empty array and object")
        EXPECT(mj::Value::parse("[]").isArray());
        EXPECT_EQ(mj::Value::parse("[]").size(), (size_t)0);
        EXPECT(mj::Value::parse("{}").isObject());
        EXPECT_EQ(mj::Value::parse("{}").size(), (size_t)0);
    PASS()

    TEST("parse nested object")
        auto v = mj::Value::parse("{\"a\":1,\"b\":{\"c\":[2,3]}}");
        EXPECT(v.contains("a"));
        EXPECT_EQ(v.at("a").asInt(), 1);
        EXPECT(v.at("b").contains("c"));
        EXPECT_EQ(v.at("b").at("c").size(), (size_t)2);
        EXPECT_EQ(v.at("b").at("c")[0].asInt(), 2);
        EXPECT_EQ(v.at("b").at("c")[1].asInt(), 3);
    PASS()

    TEST("dump round-trip preserves data")
        std::string original = "{\"id\":1,\"ok\":true,\"items\":[1,2,3]}";
        auto v = mj::Value::parse(original);
        std::string out = v.dump();
        auto v2 = mj::Value::parse(out);
        EXPECT_EQ(v2.at("id").asInt(), 1);
        EXPECT(v2.at("ok").asBool());
        EXPECT_EQ(v2.at("items").size(), (size_t)3);
    PASS()

    TEST("dump integer has no decimal point")
        mj::Value v(int(42));
        EXPECT_EQ(v.dump(), std::string("42"));
    PASS()

    TEST("dump double appends .0 for integral values")
        mj::Value v(525.0);
        EXPECT_EQ(v.dump(), std::string("525.0"));
    PASS()

    TEST("dump escapes special chars")
        mj::Value v(std::string("a\nb\"c"));
        EXPECT_EQ(v.dump(), std::string("\"a\\nb\\\"c\""));
    PASS()

    TEST("initializer-list object construction")
        mj::Value v = {
            {"id", 1},
            {"ok", true},
            {"name", std::string("hello")},
        };
        EXPECT(v.isObject());
        EXPECT_EQ(v.at("id").asInt(), 1);
        EXPECT(v.at("ok").asBool());
        EXPECT_EQ(v.at("name").asString(), std::string("hello"));
    PASS()

    TEST("operator[] auto-promotes null to object")
        mj::Value v;
        v["k"] = 7;
        EXPECT(v.isObject());
        EXPECT_EQ(v.at("k").asInt(), 7);
    PASS()

    TEST("push_back auto-promotes null to array")
        mj::Value v;
        v.push_back(1);
        v.push_back(2);
        EXPECT(v.isArray());
        EXPECT_EQ(v.size(), (size_t)2);
    PASS()

    TEST("value<T>() returns default for missing key")
        auto v = mj::Value::parse("{}");
        EXPECT_EQ(v.value<int>("missing", 99), 99);
        EXPECT_EQ(v.value<std::string>("missing", std::string("def")), std::string("def"));
    PASS()

    TEST("value<T>() returns parsed value when present")
        auto v = mj::Value::parse("{\"n\":5}");
        EXPECT_EQ(v.value<int>("n", 99), 5);
    PASS()

    TEST("contains returns false on non-object")
        auto v = mj::Value::parse("[1,2,3]");
        EXPECT(!v.contains("anything"));
    PASS()

    TEST("at on missing key throws")
        auto v = mj::Value::parse("{}");
        bool threw = false;
        try { (void)v.at("nope"); } catch (const mj::ParseError&) { threw = true; }
        EXPECT(threw);
    PASS()

    TEST("range-for iterates array elements")
        auto v = mj::Value::parse("[10,20,30]");
        long long sum = 0;
        for (const auto& item : v) sum += item.asInt();
        EXPECT_EQ(sum, 60);
    PASS()

    TEST("parse error on malformed input")
        bool threw = false;
        try { (void)mj::Value::parse("{not valid}"); } catch (const mj::ParseError&) { threw = true; }
        EXPECT(threw);
    PASS()

    TEST("parse rejects \\u escapes (closed grammar)")
        bool threw = false;
        try { (void)mj::Value::parse("\"\\u0041\""); } catch (const mj::ParseError&) { threw = true; }
        EXPECT(threw);
    PASS()

    TEST("typed get<uint16_t> casts correctly")
        auto v = mj::Value::parse("65535");
        EXPECT_EQ(v.get<uint16_t>(), (uint16_t)65535);
    PASS()

    TEST("nested initializer-list with arrays")
        mj::Value v = {
            {"items", mj::Value::array()},
        };
        v["items"].push_back(1);
        v["items"].push_back(2);
        std::string s = v.dump();
        EXPECT_EQ(s, std::string("{\"items\":[1,2]}"));
    PASS()
}

// ─── Transaction Validation Tests ─────────────────────────────────────────────
//
// The happy-path fixture below is generated by
//   frontend/scripts/gen-validation-vector.mjs
// because the C++ side has Ed25519 *verification* only — a known-good signature
// must be produced with a real signer using the same wallet + serialization the
// frontend uses. fundedChain() recomputes the coinbase txId and each test
// asserts the transfer txId, so any serialization drift fails loudly instead of
// silently invalidating the signature.

static const char* VEC_PUBLIC_KEY    = "fc51cd8e6218a1a38da47ed00230f0580816ed13ba3303ac5deb911548908025";
static const char* VEC_ADDRESS       = "dac073e0123bdea59dd9b3bda9cf6037f63aca82627d7abcd5c4ac29dd74003e";
static const char* VEC_PROOF_ID      = "test-proof-vector";
static constexpr double VEC_AMOUNT   = 5.0;
static const char* VEC_COINBASE_TXID = "2cf72279c148940fc8a2aa3281ae32ca758bda1ea7ddea582660c84f22c52bdc";
static const char* VEC_TRANSFER_TXID = "00e654687c9f00ccdfa0340ca70c03aed18bf0639bff2c2dc16f64ce11445dbb";
static const char* VEC_SIGNATURE     =
    "3dbf14d4491c8c9a47e12b55618996e7b67aa4ec8fbcb1cd45b003e8b766ec2d"
    "31a5612578e69aaa8c4e171f71b682741212c40b0e7a6b4028f31c7907eaeb02";

// Chain with one coinbase output funding VEC_ADDRESS with VEC_AMOUNT.
static Blockchain fundedChain() {
    Blockchain chain;
    chain.initialize(1000);
    CoinbaseTransaction cb(VEC_PROOF_ID, {{VEC_ADDRESS, VEC_AMOUNT, RewardReason::BugBounty}});
    if (cb.txId() != std::string(VEC_COINBASE_TXID)) {
        throw std::runtime_error("coinbase serialization drift: got " + cb.txId());
    }
    chain.addBlock({Transaction(cb)}, 2000);
    return chain;
}

// The canonical valid transfer: spends the funded UTXO back to its owner.
static TransferTransaction validTransfer() {
    return TransferTransaction(
        {{VEC_COINBASE_TXID, 0, VEC_SIGNATURE, VEC_PUBLIC_KEY}},
        {{VEC_ADDRESS, VEC_AMOUNT}});
}

void testTxValidation() {
    std::cout << "\n[TxValidation]" << std::endl;

    TEST("valid signed transfer is accepted")
        Blockchain chain = fundedChain();
        TransferTransaction tx = validTransfer();
        EXPECT_EQ(tx.txId(), std::string(VEC_TRANSFER_TXID));   // serialization sanity
        auto r = validateTransferTransaction(tx, chain);
        EXPECT(r.valid);
    PASS()

    TEST("rejects spend with a non-owner public key")
        Blockchain chain = fundedChain();
        std::string otherPk(64, 'a');   // valid 32-byte hex, but SHA256 != owner
        TransferTransaction tx(
            {{VEC_COINBASE_TXID, 0, VEC_SIGNATURE, otherPk}},
            {{VEC_ADDRESS, VEC_AMOUNT}});
        auto r = validateTransferTransaction(tx, chain);
        EXPECT(!r.valid);
        EXPECT(r.error.find("does not own") != std::string::npos);
    PASS()

    TEST("rejects an invalid signature from the rightful owner")
        Blockchain chain = fundedChain();
        std::string badSig(128, '0');   // correct length, wrong signature
        TransferTransaction tx(
            {{VEC_COINBASE_TXID, 0, badSig, VEC_PUBLIC_KEY}},
            {{VEC_ADDRESS, VEC_AMOUNT}});
        auto r = validateTransferTransaction(tx, chain);
        EXPECT(!r.valid);
        EXPECT(r.error.find("signature") != std::string::npos);
    PASS()

    TEST("rejects double-spending one input within a single tx")
        Blockchain chain = fundedChain();
        TransferTransaction tx(
            {
              {VEC_COINBASE_TXID, 0, VEC_SIGNATURE, VEC_PUBLIC_KEY},
              {VEC_COINBASE_TXID, 0, VEC_SIGNATURE, VEC_PUBLIC_KEY},
            },
            {{VEC_ADDRESS, VEC_AMOUNT * 2}});   // tries to count the coin twice
        auto r = validateTransferTransaction(tx, chain);
        EXPECT(!r.valid);
        EXPECT(r.error.find("Duplicate input") != std::string::npos);
    PASS()

    TEST("rejects spending a non-existent UTXO")
        Blockchain chain = fundedChain();
        std::string ghost(64, 'b');
        TransferTransaction tx(
            {{ghost, 0, VEC_SIGNATURE, VEC_PUBLIC_KEY}},
            {{VEC_ADDRESS, VEC_AMOUNT}});
        auto r = validateTransferTransaction(tx, chain);
        EXPECT(!r.valid);
        EXPECT(r.error.find("existing unspent UTXO") != std::string::npos);
    PASS()

    TEST("rejects value creation (outputs exceed inputs)")
        Blockchain chain = fundedChain();
        TransferTransaction tx(
            {{VEC_COINBASE_TXID, 0, VEC_SIGNATURE, VEC_PUBLIC_KEY}},
            {{VEC_ADDRESS, VEC_AMOUNT + 1.0}});   // mints 1 from nothing
        auto r = validateTransferTransaction(tx, chain);
        EXPECT(!r.valid);
        EXPECT(r.error.find("Conservation") != std::string::npos);
    PASS()

    TEST("rejects a non-positive output amount")
        Blockchain chain = fundedChain();
        TransferTransaction tx(
            {{VEC_COINBASE_TXID, 0, VEC_SIGNATURE, VEC_PUBLIC_KEY}},
            {{VEC_ADDRESS, 0.0}});
        auto r = validateTransferTransaction(tx, chain);
        EXPECT(!r.valid);
        EXPECT(r.error.find("positive") != std::string::npos);
    PASS()

    TEST("rejects empty inputs or outputs")
        Blockchain chain = fundedChain();
        TransferTransaction noIn({}, {{VEC_ADDRESS, VEC_AMOUNT}});
        EXPECT(!validateTransferTransaction(noIn, chain).valid);
        TransferTransaction noOut(
            {{VEC_COINBASE_TXID, 0, VEC_SIGNATURE, VEC_PUBLIC_KEY}}, {});
        EXPECT(!validateTransferTransaction(noOut, chain).valid);
    PASS()

    TEST("rejects spending an already-spent UTXO")
        Blockchain chain = fundedChain();
        TransferTransaction tx = validTransfer();
        chain.addBlock({Transaction(tx)}, 3000);   // mine it → consumes the UTXO
        auto r = validateTransferTransaction(tx, chain);   // spend it again
        EXPECT(!r.valid);
        EXPECT(r.error.find("existing unspent UTXO") != std::string::npos);
    PASS()
}

// ─── Main ────────────────────────────────────────────────────────────────────

int main() {
    std::cout << "═══════════════════════════════════════════" << std::endl;
    std::cout << "  Proof-of-Crash Blockchain (C++) Tests" << std::endl;
    std::cout << "═══════════════════════════════════════════" << std::endl;

    testSHA256();
    testSHA512();
    testHex();
    testSerialization();
    testMerkleTree();
    testTransaction();
    testBlock();
    testConsensus();
    testBlockchain();
    testMempool();
    testBlockchainExtended();
    testEd25519();
    testTxValidation();
    testMiniJson();

    std::cout << "\n═══════════════════════════════════════════" << std::endl;
    std::cout << "  Results: " << passed << " passed, " << failed << " failed" << std::endl;
    std::cout << "═══════════════════════════════════════════" << std::endl;

    return failed > 0 ? 1 : 0;
}
