# syntax=docker/dockerfile:1
#
# Production image for the Proof-of-Crash backend — everything is compiled from
# source inside the image; no host build artifacts are used.
#
#   Stage 1 (engine-builder): compiles the C++ blockchain engine -> poc_engine
#   Stage 2 (node-builder):    installs deps and compiles TypeScript (tsc -> dist)
#   Stage 3 (runtime):         lean image with prod deps + dist + engine binary,
#                              runs `node dist/index.js`
#
# The docker-compose build context is the repository ROOT, so COPY paths below
# are relative to the repo root (cpp/, backend/), not to backend/.

# ── Stage 1: compile the C++ engine ─────────────────────────────────────────
FROM alpine:3.20 AS engine-builder
RUN apk add --no-cache g++ cmake make
WORKDIR /cpp
COPY cpp/ ./
# Build only the engine target (skip the test binary). build/ is excluded by
# .dockerignore so this is a clean configure against the in-container musl
# toolchain that the runtime stage also uses.
RUN cmake -S . -B build -DCMAKE_BUILD_TYPE=Release \
 && cmake --build build --target poc_engine --parallel

# ── Stage 2: compile the TypeScript backend ─────────────────────────────────
FROM node:22-alpine AS node-builder
WORKDIR /app
COPY backend/package*.json ./
RUN npm ci
COPY backend/ .
# tsc emits dist/. It does NOT copy non-.ts assets, so bring the SQL schema
# (read at runtime via dist/db/schema.sql) along explicitly.
RUN npm run build \
 && cp -r src/db dist/db

# ── Stage 3: lean runtime ───────────────────────────────────────────────────
FROM node:22-alpine
WORKDIR /app

# Runtime libraries the C++ engine dynamically links against (musl + libstdc++).
RUN apk add --no-cache libstdc++ libgcc

# Production dependencies only (devDeps like typescript/ts-node-dev dropped).
COPY backend/package*.json ./
RUN npm ci --omit=dev

# Compiled JS + SQL assets from the build stage.
COPY --from=node-builder /app/dist ./dist

# Compiled engine + the stable path the backend spawns it from.
COPY --from=engine-builder /cpp/build/poc_engine /engine/poc_engine
ENV CPP_ENGINE_PATH=/engine/poc_engine

EXPOSE 3000
CMD ["node", "dist/index.js"]
