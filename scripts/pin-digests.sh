#!/usr/bin/env bash
# Refresh pinned digests in Dockerfiles and compose (amd64).
# Usage: ./scripts/pin-digests.sh
# Requires: curl + jq (or python) on the VM; no docker daemon needed.
set -Eeuo pipefail

get_digest() {
  local repo="$1" tag="$2"
  # Hub API: returns per-arch digests; we take amd64
  local url="https://hub.docker.com/v2/repositories/${repo}/tags/${tag}"
  if command -v jq >/dev/null 2>&1; then
    curl -sL "$url" | jq -r '.images[] | select(.architecture=="amd64") | .digest' | head -n1
  else
    python3 -c "import json,sys,urllib.request;u='https://hub.docker.com/v2/repositories/${repo}/tags/${tag}';d=json.load(urllib.request.urlopen(u));print(next(i['digest'] for i in d['images'] if i['architecture']=='amd64'))"
  fi
}

echo "[pin] Fetching digests (amd64)..."
NODE_DIGEST="$(get_digest "library/node" "22.13-bookworm-slim")"
NGINX_DIGEST="$(get_digest "library/nginx" "1.27-alpine")"
POSTGRES_DIGEST="$(get_digest "library/postgres" "16-alpine")"
REDIS_DIGEST="$(get_digest "library/redis" "7-alpine")"
CERTBOT_DIGEST="$(get_digest "certbot/certbot" "latest")"

echo "node:22.13-bookworm-slim@$NODE_DIGEST"
echo "nginx:1.27-alpine@$NGINX_DIGEST"
echo "postgres:16-alpine@$POSTGRES_DIGEST"
echo "redis:7-alpine@$REDIS_DIGEST"
echo "certbot/certbot:latest@$CERTBOT_DIGEST"

# Patch files in place (GNU sed)
sed -i -E "s|node:22\.13-bookworm-slim@sha256:[a-f0-9]+|node:22.13-bookworm-slim@${NODE_DIGEST}|g" docker/*.Dockerfile
sed -i -E "s|nginx:1\.27-alpine@sha256:[a-f0-9]+|nginx:1.27-alpine@${NGINX_DIGEST}|g" docker/*.Dockerfile docker-compose.prod.yml
sed -i -E "s|postgres:16-alpine@sha256:[a-f0-9]+|postgres:16-alpine@${POSTGRES_DIGEST}|g" docker-compose.prod.yml
sed -i -E "s|redis:7-alpine@sha256:[a-f0-9]+|redis:7-alpine@${REDIS_DIGEST}|g" docker-compose.prod.yml
sed -i -E "s|certbot/certbot:latest@sha256:[a-f0-9]+|certbot/certbot:latest@${CERTBOT_DIGEST}|g" docker-compose.prod.yml

echo "[pin] Done. Verify with: git diff --stat"
