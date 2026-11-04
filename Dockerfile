# syntax=docker/dockerfile:1
#
# Readbook — production image.
#
#   docker compose up -d --build        # recommended: see compose.yaml
#   # or
#   docker build -t readbook .
#   docker run -d --init -p 127.0.0.1:4321:4321 -v readbook-data:/data readbook
#
# Then open http://localhost:4321. Your shelf lives in the /data volume.
#
# Stages: `deps` resolves the workspace manifests with a C/C++ toolchain on hand
# (better-sqlite3 is a native module: pnpm downloads a prebuilt Linux binary,
# and falls back to compiling it); `prod-deps` keeps runtime dependencies only;
# `build` compiles the Astro server; `runtime` is a slim image with no compilers
# that runs as the unprivileged `node` user.

ARG NODE_VERSION=22

# ── base ─────────────────────────────────────────────────────────────────────
FROM node:${NODE_VERSION}-bookworm-slim AS base
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    ASTRO_TELEMETRY_DISABLED=1 \
    CI=true
WORKDIR /app
RUN corepack enable

# ── deps: manifests + toolchain ──────────────────────────────────────────────
FROM base AS deps
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*
# Only the manifests, so the dependency layers stay cached until they change.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/
COPY packages/core/package.json packages/core/
COPY packages/db/package.json packages/db/
COPY packages/extractor/package.json packages/extractor/
# Fetch the pnpm version pinned in package.json "packageManager".
RUN corepack install

# ── prod-deps: runtime dependencies only ─────────────────────────────────────
FROM deps AS prod-deps
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --prod

# ── build: full install + astro build ────────────────────────────────────────
FROM deps AS build
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile
COPY . .
RUN pnpm --filter @readbook/web run build

# ── runtime ──────────────────────────────────────────────────────────────────
FROM node:${NODE_VERSION}-bookworm-slim AS runtime
LABEL org.opencontainers.image.title="Readbook" \
      org.opencontainers.image.description="A calm, local-first read-it-later: paste any link, read it like a book." \
      org.opencontainers.image.source="https://github.com/Raandino/readbook" \
      org.opencontainers.image.licenses="MIT"

# HOST=0.0.0.0: inside a container the server must listen on all interfaces,
#   or Docker's port mapping can't reach it. compose.yaml publishes the port on
#   the host's loopback only (127.0.0.1:4321), so it is still not on your LAN.
# READBOOK_ALLOWED_HOSTS=localhost: the Host-header allowlist (DNS-rebinding
#   protection). You reach the container through the localhost port mapping, so
#   the browser still sends "Host: localhost:4321" — loopback names are always
#   allowed and this value is just explicit. To read from another device, publish
#   the port on your LAN and add that hostname/IP here (comma-separated).
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=4321 \
    READBOOK_DB_PATH=/data/readbook.db \
    READBOOK_ALLOWED_HOSTS=localhost \
    ASTRO_TELEMETRY_DISABLED=1

WORKDIR /app
# Code and dependencies stay root-owned (read-only to the app); only /data is writable.
# pnpm-workspace.yaml is kept so the app can find the repo root.
COPY --from=prod-deps /app ./
COPY --from=build /app/apps/web/dist ./apps/web/dist
RUN mkdir -p /data && chown node:node /data
VOLUME ["/data"]

USER node
WORKDIR /app/apps/web
EXPOSE 4321

# 127.0.0.1 is always an allowed Host, so the probe passes the request guard.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.PORT || 4321) + '/api/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]

CMD ["node", "./dist/server/entry.mjs"]
