# One-shot demo-data seeder. Waits for the backend, drives the real API to
# populate the chain with users, apps, proofs, blocks and transfers, then exits.
# It signs everything client-side (Ed25519) exactly like the SPA, so the data is
# fully consistent with the C++ engine's rules.
FROM node:22-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY seed.mjs ./
CMD ["node", "seed.mjs"]
