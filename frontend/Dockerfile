# syntax=docker/dockerfile:1
#
# Frontend image: builds the Vite + React production bundle, then serves the
# static files with nginx. nginx also reverse-proxies /api and /health to the
# backend service, so the browser only ever talks to ONE origin — no CORS, and
# the auth cookies work without cross-site complications.
#
# The docker-compose build context is ./frontend, so COPY paths are relative to
# the frontend/ directory.

# ── Stage 1: build the production bundle ────────────────────────────────────
FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
# VITE_API_URL is left empty on purpose: the bundle then uses same-origin /api
# paths, which nginx proxies to the backend. `npm run build` = tsc --noEmit
# (type-check) + vite build.
RUN npm run build

# ── Stage 2: serve with nginx ───────────────────────────────────────────────
FROM nginx:1.27-alpine
# Replace the default site with our SPA + API-proxy config.
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
# The nginx base image already runs `nginx -g 'daemon off;'` in the foreground.
