# syntax=docker/dockerfile:1

# =============================================================================
# Production image for @pharmacy/fiscal-engine (BullMQ worker, no HTTP).
#
# Single target: fiscal. It publishes no ports and talks to Postgres/Redis on
# the internal compose network only.
#
# Build context MUST be the repository root:
#   docker build -f docker/fiscal-engine.Dockerfile --target fiscal .
# =============================================================================

ARG NODE_VERSION=22

# ---------- base: shared OS tooling + pnpm ----------
FROM node:${NODE_VERSION}-bookworm-slim AS base
# openssl is required by Prisma engines on debian-slim; ca-certificates for
# outbound HTTPS (Infisical, DIAN transmission endpoints).
RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl ca-certificates \
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
# Filtered install for the fiscal-engine closure only (server manifest is
# required by the lockfile graph but its dev tooling stays out).
RUN --mount=type=cache,id=pnpm-fiscal,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter @pharmacy/fiscal-engine...

# ---------- build: compile workspace packages + worker ----------
FROM deps AS build
COPY . .
RUN pnpm turbo run build --filter=@pharmacy/fiscal-engine...
# Self-contained production tree with workspace packages injected as files.
# The find guard fails the build on dangling symlinks instead of failing at 3am.
RUN pnpm --filter @pharmacy/fiscal-engine deploy --prod /out \
    && test -z "$(find -L /out/node_modules -maxdepth 6 -type l 2>/dev/null)"

# ---------- target: worker runtime ----------
FROM base AS fiscal
ENV NODE_ENV=production \
    TZ=America/Bogota
RUN groupadd --system app && useradd --system --gid app --home-dir /app app
WORKDIR /app
COPY --from=build --chown=app:app /out/package.json ./package.json
COPY --from=build --chown=app:app /out/node_modules ./node_modules
COPY --from=build --chown=app:app /out/dist ./dist
USER app
# No EXPOSE: this service is a queue consumer, never an HTTP listener.
CMD ["node", "dist/apps/fiscal-engine/src/main.js"]
