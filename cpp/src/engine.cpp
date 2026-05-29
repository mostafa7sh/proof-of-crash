/**
 * poc_engine — C++ blockchain engine daemon (stdio IPC).
 *
 * Protocol: newline-delimited JSON on stdin/stdout.
 * Request:  {"id": N, "cmd": "...", "params": {...}}
 * Response: {"id": N, "ok": true, "result": {...}}
 *       or: {"id": N, "ok": false, "error": "..."}
 *
 * All diagnostic logging goes to stderr. stdout is ONLY for protocol.
 */

#include "Blockchain.h"
#include "Consensus.h"
#include "Ed25519.h"
#include "Hash.h"
#include "Mempool.h"
#include "MiniJson.h"
#include "SHA256.h"
#include "TxValidation.h"

#include <cmath>
#include <cstdint>
#include <ctime>
#include <iostream>
#include <string>
#include <variant>

using json = poc::minijson::Value;
using namespace poc;

// ─── Helpers ─────────────────────────────────────────────────────────────────

static uint32_t nowSeconds() {
    return static_cast<uint32_t>(std::time(nullptr));
}

static uint32_t parseTimestamp(const json& params) {
    uint32_t ts = params.value("timestamp", 0u);
    return ts == 0 ? nowSeconds() : ts;
}

static json blockToJson(const Block& block) {
    json txArr = json::array();
    for (const auto& tx : block.transactions()) {
        std::visit([&txArr](const auto& t) {
            using T = std::decay_t<decltype(t)>;
            if constexpr (std::is_same_v<T, CoinbaseTransaction>) {
                json outputs = json::array();
                for (const auto& out : t.outputs()) {
                    outputs.push_back({
                        {"address", out.address},
                        {"amount", out.amount},
                        {"reason", rewardReasonToString(out.reason)}
                    });
                }
                txArr.push_back({
                    {"type", "coinbase"},
                    {"tx_id", t.txId()},
                    {"proof_id", t.proofId()},
                    {"outputs", outputs}
                });
            } else if constexpr (std::is_same_v<T, TransferTransaction>) {
                json inputs = json::array();
                for (const auto& inp : t.inputs()) {
                    inputs.push_back({
                        {"prev_tx_id", inp.prevTxId},
                        {"output_index", inp.outputIndex},
                        {"signature", inp.signature}
                    });
                }
                json outputs = json::array();
                for (const auto& out : t.outputs()) {
                    outputs.push_back({
                        {"address", out.address},
                        {"amount", out.amount}
                    });
                }
                txArr.push_back({
                    {"type", "transfer"},
                    {"tx_id", t.txId()},
                    {"inputs", inputs},
                    {"outputs", outputs}
                });
            }
        }, tx);
    }

    return {
        {"block_number", block.blockNumber()},
        {"block_hash", block.hash()},
        {"previous_hash", block.header().previousBlockHash()},
        {"merkle_root", block.header().merkleRoot()},
        {"version", block.header().version()},
        {"timestamp", block.header().timestamp()},
        {"total_minted", block.totalMinted()},
        {"transactions", txArr}
    };
}

// ─── Build Transaction objects from JSON ─────────────────────────────────────

static CoinbaseTransaction coinbaseFromJson(const json& j) {
    std::string proofId = j.at("proof_id").get<std::string>();
    std::vector<TxOutput> outputs;
    for (const auto& out : j.at("outputs")) {
        RewardReason reason = RewardReason::BugBounty;
        std::string reasonStr = out.at("reason").get<std::string>();
        if (reasonStr == "verification_reward") {
            reason = RewardReason::VerificationReward;
        }
        outputs.push_back({
            out.at("address").get<std::string>(),
            out.at("amount").get<double>(),
            reason
        });
    }
    return CoinbaseTransaction(proofId, outputs);
}

static TransferTransaction transferFromJson(const json& j) {
    std::vector<TxInput> inputs;
    for (const auto& inp : j.at("inputs")) {
        inputs.push_back({
            inp.at("prev_tx_id").get<std::string>(),
            inp.at("output_index").get<uint16_t>(),
            inp.value<std::string>("signature", ""),
            inp.value<std::string>("public_key", "")
        });
    }
    std::vector<TransferTxOutput> outputs;
    for (const auto& out : j.at("outputs")) {
        outputs.push_back({
            out.at("address").get<std::string>(),
            out.at("amount").get<double>()
        });
    }
    return TransferTransaction(inputs, outputs);
}

// ─── Command Handlers ────────────────────────────────────────────────────────

static json handleInitialize(const json& params, Blockchain& chain, Mempool&) {
    uint32_t ts = parseTimestamp(params);
    chain.initialize(ts);
    const Block* genesis = chain.getBlockByNumber(0);
    json result = {
        {"tip_hash", chain.tipHash()},
        {"tip_height", chain.tipHeight()}
    };
    if (genesis) {
        result["genesis_block"] = blockToJson(*genesis);
    }
    return result;
}

static json handleGetTip(const json&, Blockchain& chain, Mempool&) {
    return {
        {"hash", chain.tipHash()},
        {"height", chain.tipHeight()}
    };
}

static json handleAddBlock(const json& params, Blockchain& chain, Mempool& mempool) {
    uint32_t ts = parseTimestamp(params);
    int maxTransferTxs = params.value("max_transfer_txs", 100);

    // 1. Build coinbase transactions from params
    std::vector<Transaction> txs;
    if (params.contains("coinbase_txs")) {
        for (const auto& cbJson : params.at("coinbase_txs")) {
            txs.emplace_back(coinbaseFromJson(cbJson));
        }
    }

    // 2. Drain mempool
    auto transfers = mempool.drainTransactions(maxTransferTxs);

    // 3. Re-validate each transfer against current UTXO set
    json drainedIds = json::array();
    for (auto& transfer : transfers) {
        bool valid = true;
        for (const auto& inp : transfer.inputs()) {
            if (!chain.isUTXOUnspent(inp.prevTxId, inp.outputIndex)) {
                valid = false;
                std::cerr << "[engine] Dropping transfer " << transfer.txId().substr(0, 16)
                          << "... — input " << inp.prevTxId.substr(0, 8)
                          << ":" << inp.outputIndex << " no longer unspent\n";
                break;
            }
        }
        if (valid) {
            drainedIds.push_back(transfer.txId());
            txs.emplace_back(std::move(transfer));
        }
    }

    // 4. Nothing to mine
    if (txs.empty()) {
        return {{"block", nullptr}, {"drained_tx_ids", json::array()}};
    }

    // 5. Build and add block
    Block block = chain.addBlock(txs, ts);
    return {
        {"block", blockToJson(block)},
        {"drained_tx_ids", drainedIds}
    };
}

static json handleLoadBlock(const json& params, Blockchain& chain, Mempool&) {
    uint32_t ts = parseTimestamp(params);

    std::vector<Transaction> txs;

    if (params.contains("coinbase_txs")) {
        for (const auto& cbJson : params.at("coinbase_txs")) {
            txs.emplace_back(coinbaseFromJson(cbJson));
        }
    }

    if (params.contains("transfer_txs")) {
        for (const auto& trJson : params.at("transfer_txs")) {
            txs.emplace_back(transferFromJson(trJson));
        }
    }

    Block block = chain.addBlock(txs, ts);

    return {
        {"block_hash", block.hash()},
        {"tip_height", chain.tipHeight()}
    };
}

static json handleMempoolAdd(const json& params, Blockchain& chain, Mempool& mempool) {
    TransferTransaction tx = transferFromJson(params);

    // Verify txId matches if provided
    if (params.contains("tx_id")) {
        std::string expectedId = params.at("tx_id").get<std::string>();
        if (tx.txId() != expectedId) {
            return json{{"error", "txId mismatch: computed " + tx.txId().substr(0, 16) + "..., expected " + expectedId.substr(0, 16) + "..."}};
        }
    }

    // Full consensus validation — the single authority for whether a transfer
    // may spend coins. Covers structure, duplicate inputs, txId integrity, input
    // existence + unspent state, ownership (SHA256(publicKey) == UTXO owner),
    // Ed25519 signatures over the txId, and input/output conservation. The engine
    // does NOT trust the Node layer to have performed any of these checks.
    TxValidationResult validation = validateTransferTransaction(tx, chain);
    if (!validation.valid) {
        return json{{"error", validation.error}};
    }

    // Mempool admission adds the orthogonal intra-mempool rules: not already
    // pending, and no other pending transaction claims the same outpoint.
    auto result = mempool.addTransaction(tx);
    if (!result.success) {
        return json{{"error", result.error}};
    }

    return {
        {"tx_id", tx.txId()},
        {"mempool_size", mempool.size()}
    };
}

// ─── New: pure crypto and consensus commands ─────────────────────────────────

static json handleSha256(const json& params, Blockchain&, Mempool&) {
    // Input is hex-encoded byte data (binary payloads round-trip through hex
    // because JSON has no native binary representation).
    std::string dataHex = params.at("data_hex").get<std::string>();
    std::vector<uint8_t> bytes = fromHex(dataHex);
    Digest d = sha256(bytes);
    return {{"hash", toHex(d)}};
}

static json handleVerifyEd25519(const json& params, Blockchain&, Mempool&) {
    std::string messageHex = params.at("message_hex").get<std::string>();
    std::string signatureHex = params.at("signature_hex").get<std::string>();
    std::string publicKeyHex = params.at("public_key_hex").get<std::string>();
    bool ok = verifyEd25519Hex(messageHex, signatureHex, publicKeyHex);
    return {{"valid", ok}};
}

static json handleBuildCoinbase(const json& params, Blockchain&, Mempool&) {
    // Compute median-based reward distribution for a finalized proof and
    // return a coinbase spec that the caller can hand to add_block. Single
    // source of truth: all consensus math lives in poc::calculateRewards.
    std::string proofId = params.at("proof_id").get<std::string>();
    std::string finderAddress = params.at("finder_address").get<std::string>();

    std::vector<VerifierVote> votes;
    for (const auto& v : params.at("votes")) {
        votes.push_back({
            v.at("address").get<std::string>(),
            v.at("score").get<double>(),
        });
    }

    if (votes.size() < static_cast<size_t>(MIN_VERIFICATIONS)) {
        return json{{"error", "Need at least " + std::to_string(MIN_VERIFICATIONS) +
                              " votes, got " + std::to_string(votes.size())}};
    }

    RewardCalculation rewards = calculateRewards(votes);
    CoinbaseTransaction cb = buildCoinbaseTransaction(proofId, finderAddress, rewards);

    json outputs = json::array();
    for (const auto& out : cb.outputs()) {
        outputs.push_back({
            {"address", out.address},
            {"amount", out.amount},
            {"reason", rewardReasonToString(out.reason)},
        });
    }

    json payouts = json::array();
    for (const auto& p : rewards.payouts) {
        payouts.push_back({
            {"address", p.address},
            {"score", p.score},
            {"distance", p.distance},
            {"reward", p.reward},
        });
    }

    return {
        {"coinbase_tx", {
            {"proof_id", proofId},
            {"outputs", outputs},
        }},
        {"tx_id", cb.txId()},
        {"median_score", rewards.medianScore},
        {"base_reward", rewards.baseReward},
        {"finder_reward", rewards.finderReward},
        {"verifier_max_per", rewards.verifierMaxPer},
        {"total_minted", rewards.totalMinted},
        {"payouts", payouts},
    };
}

static json handleCheckFinalization(const json& params, Blockchain&, Mempool&) {
    int voteCount = params.at("vote_count").get<int>();
    int votingDeadline = params.at("voting_deadline").get<int>();
    int nowSeconds = params.value("now_seconds", 0);
    if (nowSeconds == 0) nowSeconds = static_cast<int>(std::time(nullptr));
    auto check = checkFinalization(voteCount, votingDeadline, nowSeconds);
    return {{"can_finalize", check.canFinalize}, {"reason", check.reason}};
}

// Deterministic agreement status for a proof's votes. "Consensus reached" =
// a quorum (>= MIN_VERIFICATIONS) AND a strict majority of votes agree with
// the median (within OUTLIER_THRESHOLD — the same band the reward engine uses
// to decide who gets paid). Pure function of the vote set; no time component.
static json handleConsensusStatus(const json& params, Blockchain&, Mempool&) {
    std::vector<double> scores;
    if (params.contains("votes")) {
        for (const auto& v : params.at("votes")) {
            scores.push_back(v.at("score").get<double>());
        }
    }

    int voteCount = static_cast<int>(scores.size());

    if (voteCount == 0) {
        return {
            {"vote_count", 0},
            {"median", nullptr},
            {"agreeing_count", 0},
            {"dissenting_count", 0},
            {"consensus_reached", false},
            {"outlier_threshold", OUTLIER_THRESHOLD},
            {"min_verifications", MIN_VERIFICATIONS},
        };
    }

    double median = computeMedian(scores);
    int agreeing = 0;
    for (double s : scores) {
        if (std::abs(s - median) <= OUTLIER_THRESHOLD) ++agreeing;
    }
    int dissenting = voteCount - agreeing;

    bool quorum = voteCount >= MIN_VERIFICATIONS;
    bool majorityAgree = agreeing * 2 > voteCount;  // strict majority

    return {
        {"vote_count", voteCount},
        {"median", median},
        {"agreeing_count", agreeing},
        {"dissenting_count", dissenting},
        {"consensus_reached", quorum && majorityAgree},
        {"outlier_threshold", OUTLIER_THRESHOLD},
        {"min_verifications", MIN_VERIFICATIONS},
    };
}

static json handleMempoolGetPending(const json&, Blockchain&, Mempool& mempool) {
    auto pending = mempool.getPending();
    json txArr = json::array();
    for (const auto* tx : pending) {
        txArr.push_back({
            {"tx_id", tx->txId()},
            {"input_count", tx->inputs().size()},
            {"output_count", tx->outputs().size()},
            {"total_amount", tx->totalOutput()}
        });
    }
    return {
        {"pending_count", pending.size()},
        {"transactions", txArr}
    };
}

static json handleMempoolGetTx(const json& params, Blockchain&, Mempool& mempool) {
    std::string txId = params.at("tx_id").get<std::string>();
    const auto* tx = mempool.getTransaction(txId);
    if (!tx) {
        return {{"found", false}};
    }

    json inputs = json::array();
    for (const auto& inp : tx->inputs()) {
        inputs.push_back({
            {"prev_tx_id", inp.prevTxId},
            {"output_index", inp.outputIndex},
            {"signature", inp.signature}
        });
    }
    json outputs = json::array();
    for (const auto& out : tx->outputs()) {
        outputs.push_back({
            {"address", out.address},
            {"amount", out.amount}
        });
    }

    return {
        {"found", true},
        {"tx_id", tx->txId()},
        {"inputs", inputs},
        {"outputs", outputs},
        {"total_amount", tx->totalOutput()}
    };
}

static json handleMempoolIsSpent(const json& params, Blockchain&, Mempool& mempool) {
    std::string prevTxId = params.at("prev_tx_id").get<std::string>();
    uint16_t outputIndex = params.at("output_index").get<uint16_t>();
    return {{"is_spent", mempool.isSpentInMempool(prevTxId, outputIndex)}};
}

static json handleGetBalance(const json& params, Blockchain& chain, Mempool&) {
    std::string address = params.at("address").get<std::string>();
    return {
        {"address", address},
        {"balance", chain.getBalance(address)}
    };
}

static json handleGetUTXOs(const json& params, Blockchain& chain, Mempool&) {
    std::string address = params.at("address").get<std::string>();
    auto utxos = chain.getUTXOs(address);
    json arr = json::array();
    for (const auto& u : utxos) {
        arr.push_back({
            {"tx_id", u.txId},
            {"output_index", u.outputIndex},
            {"amount", u.amount}
        });
    }
    return {
        {"address", address},
        {"utxos", arr}
    };
}

static json handleGetTotalSupply(const json&, Blockchain& chain, Mempool&) {
    return {{"total_supply", chain.getTotalSupply()}};
}

static json handleValidateChain(const json&, Blockchain& chain, Mempool&) {
    auto v = chain.validateChain();
    return {
        {"valid", v.valid},
        {"height", v.height},
        {"error", v.error}
    };
}

static json handleGetBlockByHash(const json& params, Blockchain& chain, Mempool&) {
    std::string hash = params.at("hash").get<std::string>();
    const Block* block = chain.getBlockByHash(hash);
    if (!block) {
        return {{"found", false}};
    }
    json result = blockToJson(*block);
    result["found"] = true;
    return result;
}

static json handleGetBlockByNumber(const json& params, Blockchain& chain, Mempool&) {
    uint32_t number = params.at("number").get<uint32_t>();
    const Block* block = chain.getBlockByNumber(number);
    if (!block) {
        return {{"found", false}};
    }
    json result = blockToJson(*block);
    result["found"] = true;
    return result;
}

// ─── Main Loop ───────────────────────────────────────────────────────────────

int main() {
    // Force line-buffered stdout for pipe communication
    std::cout << std::unitbuf;

    Blockchain chain;
    Mempool mempool;

    using HandlerFn = json(*)(const json&, Blockchain&, Mempool&);

    struct CmdEntry { const char* name; HandlerFn handler; };
    static const CmdEntry commands[] = {
        {"initialize",          handleInitialize},
        {"get_tip",             handleGetTip},
        {"add_block",           handleAddBlock},
        {"load_block",          handleLoadBlock},
        {"mempool_add",         handleMempoolAdd},
        {"mempool_get_pending", handleMempoolGetPending},
        {"mempool_get_tx",      handleMempoolGetTx},
        {"mempool_is_spent",    handleMempoolIsSpent},
        {"get_balance",         handleGetBalance},
        {"get_utxos",           handleGetUTXOs},
        {"get_total_supply",    handleGetTotalSupply},
        {"validate_chain",      handleValidateChain},
        {"get_block_by_hash",   handleGetBlockByHash},
        {"get_block_by_number", handleGetBlockByNumber},
        {"sha256",              handleSha256},
        {"verify_ed25519",      handleVerifyEd25519},
        {"build_coinbase",      handleBuildCoinbase},
        {"check_finalization",  handleCheckFinalization},
        {"consensus_status",    handleConsensusStatus},
    };

    std::cerr << "[engine] poc_engine started, awaiting commands on stdin\n";

    std::string line;
    while (std::getline(std::cin, line)) {
        if (line.empty()) continue;

        json response;
        int reqId = 0;

        try {
            json request = json::parse(line);
            reqId = request.value("id", 0);
            std::string cmd = request.at("cmd").get<std::string>();
            json params = request.value("params", json::object());

            // Shutdown command
            if (cmd == "shutdown") {
                response = {{"id", reqId}, {"ok", true}, {"result", json::object()}};
                std::cout << response.dump() << '\n' << std::flush;
                std::cerr << "[engine] Shutdown requested, exiting\n";
                return 0;
            }

            // Find handler
            HandlerFn handler = nullptr;
            for (const auto& entry : commands) {
                if (cmd == entry.name) {
                    handler = entry.handler;
                    break;
                }
            }

            if (!handler) {
                response = {
                    {"id", reqId},
                    {"ok", false},
                    {"error", "Unknown command: " + cmd}
                };
            } else {
                json result = handler(params, chain, mempool);

                // Check if handler returned an error directly (mempool_add pattern)
                if (result.contains("error") && !result.contains("valid")) {
                    response = {
                        {"id", reqId},
                        {"ok", false},
                        {"error", result["error"].get<std::string>()}
                    };
                } else {
                    response = {
                        {"id", reqId},
                        {"ok", true},
                        {"result", result}
                    };
                }
            }
        } catch (const poc::minijson::ParseError& e) {
            response = {
                {"id", reqId},
                {"ok", false},
                {"error", std::string("JSON parse error: ") + e.what()}
            };
        } catch (const std::exception& e) {
            response = {
                {"id", reqId},
                {"ok", false},
                {"error", std::string("Engine error: ") + e.what()}
            };
        }

        std::cout << response.dump() << '\n' << std::flush;
    }

    std::cerr << "[engine] stdin closed, exiting\n";
    return 0;
}
