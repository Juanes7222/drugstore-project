# syntax=docker/dockerfile:1

# =============================================================================
# Production image for @pharmacy/web-landing (Vite SPA marketing site).
# Same pattern as web-backoffice: pnpm build -> nginx static.
# =============================================================================

ARG NODE_VERSION=22.13
# Pinned 2026-08-26 amd64
# node:22.13-bookworm-slim@sha256:e71b848e62e2c32bf5572b327b032a0da79b6a390bc924cdb827249c81e13a88
# nginx:1.27-alpine@sha256:62223d644fa234c3a1cc785ee14242ec47a77364226f1c811d2f669f96dc2ac8

FROM node:${NODE_VERSION}-bookworm-slim@sha256:e71b848e62e2c32bf5572b327b032a0da79b6a390bc924cdb827249c81e13a88 AS base
ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

FROM base AS deps
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/web-landing/package.json apps/web-landing/
COPY packages/shared-types/package.json packages/shared-types/
COPY packages/shared-validation/package.json packages/shared-validation/
RUN --mount=type=cache,id=pnpm-web-landing,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter @pharmacy/web-landing...

FROM deps AS build
ARG VITE_API_URL
ENV VITE_API_URL=$VITE_API_URL
COPY . .
RUN --mount=type=cache,id=pnpm-web-landing,target=/pnpm/store \
    --mount=type=cache,target=/repo/.turbo,sharing=locked \
    pnpm turbo run build --filter=@pharmacy/web-landing

FROM nginx:1.27-alpine@sha256:62223d644fa234c3a1cc785ee14242ec47a77364226f1c811d2f669f96dc2ac8 AS runtime
COPY docker/nginx/snippets/spa.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/apps/web-landing/dist /usr/share/nginx/html
COPY docker/web-entrypoint.sh /docker-entrypoint.d/99-env.sh
RUN chmod +x /docker-entrypoint.d/99-env.sh \
    && chown -R nginx:nginx /usr/share/nginx/html \
    && chmod -R 755 /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=5s --retries=3 --start-period=10s \
    CMD wget -qO- http://127.0.0.1/ || exit 1
