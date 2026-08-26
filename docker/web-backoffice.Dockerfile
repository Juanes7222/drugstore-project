# syntax=docker/dockerfile:1

# =============================================================================
# Production image for @pharmacy/web-backoffice (Vite SPA).
#
# Targets: single stage runtime (nginx) after pnpm build.
# Build context MUST be the repository root.
# VITE_* vars are build-time (Vite embeds them). Provide via --build-arg or
# compose args. For runtime override without rebuild, mount env.js (see entrypoint).
# =============================================================================

ARG NODE_VERSION=22.13
# Pinned 2026-08-26 amd64 digests
# node:22.13-bookworm-slim@sha256:e71b848e62e2c32bf5572b327b032a0da79b6a390bc924cdb827249c81e13a88
# nginx:1.27-alpine@sha256:62223d644fa234c3a1cc785ee14242ec47a77364226f1c811d2f669f96dc2ac8

# ---------- base: pnpm ----------
FROM node:${NODE_VERSION}-bookworm-slim@sha256:e71b848e62e2c32bf5572b327b032a0da79b6a390bc924cdb827249c81e13a88 AS base
ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

# ---------- deps: manifests only ----------
FROM base AS deps
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/web-backoffice/package.json apps/web-backoffice/
COPY packages/shared-types/package.json packages/shared-types/
COPY packages/shared-validation/package.json packages/shared-validation/
# Filtered install: only web-backoffice closure (avoids server/fiscal Tauri deps)
RUN --mount=type=cache,id=pnpm-web-backoffice,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter @pharmacy/web-backoffice...

# ---------- build: Vite SPA ----------
FROM deps AS build
ARG VITE_API_URL
ARG VITE_LANDING_URL
ENV VITE_API_URL=$VITE_API_URL
ENV VITE_LANDING_URL=$VITE_LANDING_URL
COPY . .
RUN --mount=type=cache,id=pnpm-web-backoffice,target=/pnpm/store \
    --mount=type=cache,target=/repo/.turbo,sharing=locked \
    pnpm turbo run build --filter=@pharmacy/web-backoffice

# ---------- runtime: nginx SPA ----------
FROM nginx:1.27-alpine@sha256:62223d644fa234c3a1cc785ee14242ec47a77364226f1c811d2f669f96dc2ac8 AS runtime
COPY docker/nginx/snippets/spa.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/apps/web-backoffice/dist /usr/share/nginx/html
# Optional runtime env injection: if /usr/share/nginx/html/env.js exists as template,
# entrypoint will envsubst it. No secrets baked.
COPY docker/web-entrypoint.sh /docker-entrypoint.d/99-env.sh
RUN chmod +x /docker-entrypoint.d/99-env.sh \
    && chown -R nginx:nginx /usr/share/nginx/html \
    && chmod -R 755 /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=5s --retries=3 --start-period=10s \
    CMD wget -qO- http://127.0.0.1/ || exit 1
