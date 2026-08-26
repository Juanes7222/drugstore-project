# syntax=docker/dockerfile:1

# =============================================================================
# Production image for @pharmacy/server (NestJS API).
#
# Targets:
#   server    — runtime image (non-root, prod-only dependency tree, tini init)
#   migrator  — one-shot image running `prisma migrate deploy`, resolving
#               secrets through the same Infisical loader the app uses.
#
# Build context MUST be the repository root:
#   docker build -f docker/server.Dockerfile --target server .
#
# Secret policy: nothing secret is baked in. NODE_ENV=production makes the
# process refuse to start without Infisical Machine Identity credentials,
# which are provided at runtime via env_file (.env.prod).
# Prisma 7 requires openssl on debian-slim and @prisma/adapter-pg.
# =============================================================================

ARG NODE_VERSION=22.13
# Pinned digests 2026-08-26 (amd64) — update via scripts/pin-digests.sh
# node:22.13-bookworm-slim@sha256:e71b848e62e2c32bf5572b327b032a0da79b6a390bc924cdb827249c81e13a88

# ---------- base: shared OS tooling + pnpm ----------
FROM node:${NODE_VERSION}-bookworm-slim@sha256:e71b848e62e2c32bf5572b327b032a0da79b6a390bc924cdb827249c81e13a88 AS base
# openssl is required by Prisma engines on debian-slim; ca-certificates is
# needed for outbound HTTPS (Infisical, DIAN providers, Firebase, Wompi).
# tini handles PID 1 signal forwarding and zombie reaping.
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    apt-get update \
    && apt-get install -y --no-install-recommends openssl ca-certificates tini \
    && rm -rf /var/lib/apt/lists/*
ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
# pnpm version comes from the root package.json `packageManager` field.
RUN corepack enable

# ---------- deps: manifests only, cached independently of source ----------
FROM base AS deps
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/server/package.json apps/server/
COPY apps/fiscal-engine/package.json apps/fiscal-engine/
COPY apps/pos-desktop/package.json apps/pos-desktop/
COPY apps/web-backoffice/package.json apps/web-backoffice/
COPY apps/web-landing/package.json apps/web-landing/
COPY packages/database/package.json packages/database/
COPY packages/shared-types/package.json packages/shared-types/
COPY packages/shared-validation/package.json packages/shared-validation/
COPY packages/infisical-config/package.json packages/infisical-config/
# Filtered install: only the dependency closure of server (skips desktop/web
# deps such as Tauri or Electron-adjacent packages). All manifests are still
# present because pnpm needs them to resolve the workspace graph.
RUN --mount=type=cache,id=pnpm-server,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter @pharmacy/server...

# ---------- build: compile workspace packages + server ----------
FROM deps AS build
COPY . .
RUN --mount=type=cache,id=pnpm-server,target=/pnpm/store \
    --mount=type=cache,target=/repo/.turbo,sharing=locked \
    pnpm turbo run build --filter=@pharmacy/server...
# Self-contained production tree: prod dependencies with workspace packages
# injected as real files (their compiled dist included). The find guard fails
# the build if any symlink dangles — that would break at runtime otherwise.
RUN pnpm --filter @pharmacy/server deploy --prod /out \
    && test -z "$(find -L /out/node_modules -maxdepth 6 -type l 2>/dev/null)"

# ---------- target: server runtime (slim, no pnpm) ----------
FROM node:${NODE_VERSION}-bookworm-slim@sha256:e71b848e62e2c32bf5572b327b032a0da79b6a390bc924cdb827249c81e13a88 AS server
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    apt-get update \
    && apt-get install -y --no-install-recommends openssl ca-certificates tini \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system app && useradd --system --gid app --home-dir /app --shell /usr/sbin/nologin app
ENV NODE_ENV=production \
    TZ=America/Bogota
WORKDIR /app
COPY --from=build --chown=app:app /out/package.json ./package.json
COPY --from=build --chown=app:app /out/node_modules ./node_modules
COPY --from=build --chown=app:app /out/dist ./dist
USER app
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --retries=3 --start-period=40s \
    CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/').then(()=>process.exit(0)).catch(()=>process.exit(1))"
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "dist/apps/server/src/main.js"]

# ---------- target: migrator (one-shot `prisma migrate deploy`) ----------
FROM node:${NODE_VERSION}-bookworm-slim@sha256:e71b848e62e2c32bf5572b327b032a0da79b6a390bc924cdb827249c81e13a88 AS migrator
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    apt-get update \
    && apt-get install -y --no-install-recommends openssl ca-certificates tini \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system app && useradd --system --gid app --home-dir /tmp --shell /usr/sbin/nologin app
ENV NODE_ENV=production \
    TZ=America/Bogota \
    HOME=/tmp
WORKDIR /app
# Same prod dependency tree as the runtime image; it carries the compiled
# @pharmacy/infisical-config loader used by docker/migrate.mjs.
COPY --from=build --chown=app:app /out/package.json ./package.json
COPY --from=build --chown=app:app /out/node_modules ./node_modules
# Assembled schema directory (schema.prisma + fragments) and applied migrations,
# both produced by assemble-schema.mjs during the build stage.
COPY --from=build --chown=app:app /repo/packages/database/prisma ./prisma
COPY --from=build --chown=app:app /repo/packages/database/prisma.full.config.ts ./
# Prisma CLI via pnpm — deterministic, no npm. Version pinned from pnpm-lock.yaml (7.8.0).
# Uses isolated pnpm store cache to avoid polluting the prod tree.
RUN --mount=type=cache,id=pnpm-migrator,target=/pnpm/store \
    corepack enable \
    && pnpm --version >/dev/null \
    && PNPM_HOME=/tmp/pnpm HOME=/tmp pnpm add --global prisma@7.8.0 --store-dir /tmp/pnpm-store \
    && ln -sf /tmp/pnpm/global/5/node_modules/.bin/prisma /usr/local/bin/prisma \
    && prisma --version
COPY --chown=app:app docker/migrate.mjs /app/migrate.mjs
USER app
ENTRYPOINT ["/usr/bin/tini", "--", "node", "/app/migrate.mjs"]
