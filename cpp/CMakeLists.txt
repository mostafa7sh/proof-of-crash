cmake_minimum_required(VERSION 3.16)
project(proof-of-crash-blockchain CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_EXPORT_COMPILE_COMMANDS ON)

# ─── Library: blockchain core ────────────────────────────────────────────────
add_library(poc_blockchain
    src/SHA256.cpp
    src/SHA512.cpp
    src/Hash.cpp
    src/MerkleTree.cpp
    src/Transaction.cpp
    src/Block.cpp
    src/Consensus.cpp
    src/Blockchain.cpp
    src/Mempool.cpp
    src/Ed25519.cpp
    src/MiniJson.cpp
    src/TxValidation.cpp
)

target_include_directories(poc_blockchain PUBLIC include)

# ─── Demo / test executable ──────────────────────────────────────────────────
add_executable(poc_demo src/main.cpp)
target_link_libraries(poc_demo poc_blockchain)

# ─── Engine daemon (stdio IPC) ───────────────────────────────────────────────
add_executable(poc_engine src/engine.cpp)
target_link_libraries(poc_engine poc_blockchain)
