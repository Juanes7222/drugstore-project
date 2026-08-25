# syntax=docker/dockerfile:1

# =============================================================================
# Production image for @pharmacy/server (NestJS API).
#
# Targets:
#   server    — runtime image (non-root, prod-only dependency tree)
#   migrator  — one-shot image running `prisma migrate deploy`, resolving
#               secrets through the same Infisical loader the app uses.
#
# Build context MUST be the repository root:
#   docker build -f docker/server.Dockerfile --target server .
#
# Secret policy: nothing secret is baked in. NODE_ENV=production makes the
# process refuse to start without Infisical Machine Identity credentials,
# which are provided at runtime via env_file (.env.prod).
# =============================================================================

ARG NODE_VERSION=22

# ---------- base: shared OS tooling + pnpm ----------
FROM node:${NODE_VERSION}-bookworm-slim AS base
# openssl is required by Prisma engines on debian-slim; ca-certificates is
# needed for outbound HTTPS (Infisical, DIAN providers, Firebase, Wompi).
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
# Filtered install: only the dependency closure of server (skips desktop/web
# deps such as Tauri or Electron-adjacent packages). All manifests are still
# present because pnpm needs them to resolve the workspace graph.
RUN --mount=type=cache,id=pnpm-server,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter @pharmacy/server...

# ---------- build: compile workspace packages + server ----------
FROM deps AS build
COPY . .
RUN pnpm turbo run build --filter=@pharmacy/server...
# Self-contained production tree: prod dependencies with workspace packages
# injected as real files (their compiled dist included). The find guard fails
# the build if any symlink dangles — that would break at runtime otherwise.
RUN pnpm --filter @pharmacy/server deploy --prod /out \
    && test -z "$(find -L /out/node_modules -maxdepth 6 -type l 2>/dev/null)"

# ---------- target: server runtime ----------
FROM base AS server
ENV NODE_ENV=production \
    TZ=America/Bogota
RUN groupadd --system app && useradd --system --gid app --home-dir /app app
WORKDIR /app
COPY --from=build --chown=app:app /out/package.json ./package.json
COPY --from=build --chown=app:app /out/node_modules ./node_modules
COPY --from=build --chown=app:app /out/dist ./dist
USER app
EXPOSE 3000
CMD ["node", "dist/apps/server/src/main.js"]

# ---------- target: migrator (one-shot `prisma migrate deploy`) ----------
FROM base AS migrator
ENV NODE_ENV=production \
    TZ=America/Bogota \
    HOME=/tmp
RUN groupadd --system app && useradd --system --gid app --home-dir /tmp app
WORKDIR /app
# Same prod dependency tree as the runtime image; it carries the compiled
# @pharmacy/infisical-config loader used by docker/migrate.mjs.
COPY --from=build --chown=app:app /out/package.json ./package.json
COPY --from=build --chown=app:app /out/node_modules ./node_modules
# Assembled schema directory (schema.prisma + fragments) and applied migrations,
# both produced by assemble-schema.mjs during the build stage.
COPY --from=build --chown=app:app /repo/packages/database/prisma ./prisma
COPY --from=build --chown=app:app /repo/packages/database/prisma.full.config.ts ./
# Prisma CLI only — it is a devDependency of the workspace, not shipped in the
# prod tree. Version range mirrors the workspace pin.
RUN cd /tmp \
    && npm init -y >/dev/null \
    && npm install --no-audit --no-fund "prisma@^7.8.0"
COPY --chown=app:app docker/migrate.mjs /app/migrate.mjs
USER app
ENTRYPOINT ["node", "/app/migrate.mjs"]
