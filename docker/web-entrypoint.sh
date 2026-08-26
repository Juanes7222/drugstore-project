#!/bin/sh
# Runtime env injection for Vite SPAs (optional, no rebuild).
# If /usr/share/nginx/html/env.template.js exists, envsubst it to env.js.
# Vite build can import /env.js as `window.__ENV__` fallback.
set -eu
TEMPLATE="/usr/share/nginx/html/env.template.js"
TARGET="/usr/share/nginx/html/env.js"
if [ -f "$TEMPLATE" ]; then
  envsubst < "$TEMPLATE" > "$TARGET"
  chown nginx:nginx "$TARGET" 2>/dev/null || true
  chmod 644 "$TARGET"
  echo "[web-entrypoint] Generated $TARGET from template"
fi
