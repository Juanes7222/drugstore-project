#!/usr/bin/env bash
# =============================================================================
# Production operations for the single-VM pharmacy deployment.
#
# Usage: ./scripts/deploy.sh <command>
#   init        first-time setup: secrets check, TLS certificate, full up
#   deploy      build images -> migrate -> rolling restart -> health gate
#   migrate     apply pending migrations (docker compose --profile tools)
#   status      service + health summary
#   logs        follow logs (pass service as $1, default server)
#   backup-db   pg_dump | gzip into ./backups
#   renew-certs certbot renewal + nginx reload (host cron: twice daily)
#   shell       shell into a running service container ($1, default server)
# =============================================================================
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [[ -f .env.prod ]]; then
  set -a; source .env.prod; set +a
fi

COMPOSE=(docker compose -f docker-compose.prod.yml)

log()  { printf '\033[1;34m[deploy]\033[0m %s\n' "$*"; }
die()  { printf '\033[1;31m[deploy] ERROR:\033[0m %s\n' "$*" >&2; exit 1; }

require_env() {
  [[ -f .env.prod ]] || die ".env.prod missing — copy .env.prod.example and fill it in."
  [[ -d secrets ]] || mkdir -p secrets
  [[ -s secrets/postgres_password ]] || {
    log "Generating secrets/postgres_password"
    openssl rand -base64 32 > secrets/postgres_password
    chmod 600 secrets/postgres_password
  }
  [[ -s secrets/redis_password ]] || {
    log "Generating secrets/redis_password"
    openssl rand -base64 32 > secrets/redis_password
    chmod 600 secrets/redis_password
  }
}

wait_healthy() {
  local container="$1" timeout="${2:-180}" elapsed=0 status=""
  log "Waiting for ${container} to become healthy (timeout ${timeout}s)..."
  while true; do
    status="$(docker inspect -f '{{.State.Health.Status}}' "$container" 2>/dev/null || echo missing)"
    case "$status" in
      healthy)  log "${container} is healthy"; return 0 ;;
      missing)  die "container ${container} not found" ;;
    esac
    elapsed=$((elapsed + 5))
    if (( elapsed >= timeout )); then
      docker logs --tail 50 "$container" || true
      die "${container} did not become healthy within ${timeout}s"
    fi
    sleep 5
  done
}

cmd_init() {
  require_env
  : "${DOMAIN:?set DOMAIN in .env.prod}" 
  : "${ACME_EMAIL:?set ACME_EMAIL in .env.prod}"
  log "Starting datastores..."
  "${COMPOSE[@]}" up -d postgres redis
  log "Issuing initial TLS certificate for ${DOMAIN} (standalone mode, port 80)..."
  "${COMPOSE[@]}" run --rm certbot \
    certonly --standalone \
    -d "$DOMAIN" \
    --email "$ACME_EMAIL" \
    --agree-tos --no-eff-email --non-interactive
  log "Starting full stack..."
  "${COMPOSE[@]}" up -d
  wait_healthy pharmacy-server-1 240
  cmd_status
}

cmd_deploy() {
  require_env
  log "Building images (--pull base images)..."
  "${COMPOSE[@]}" build --pull
  log "Applying database migrations..."
  "${COMPOSE[@]}" --profile tools run --rm migrate
  log "Rolling services..."
  "${COMPOSE[@]}" up -d
  wait_healthy pharmacy-server-1 240
  wait_healthy pharmacy-fiscal-engine-1 120
  log "Pruning dangling images..."
  docker image prune -f >/dev/null
  cmd_status
}

cmd_migrate() {
  require_env
  "${COMPOSE[@]}" --profile tools run --rm migrate
}

cmd_status() {
  "${COMPOSE[@]}" ps
  echo
  docker ps --filter "name=pharmacy-" \
    --format 'table {{.Names}}\t{{.Status}}\t{{.Image}}'
}

cmd_logs() {
  "${COMPOSE[@]}" logs -f --tail 100 "${1:-server}"
}

cmd_backup-db() {
  local dest="backups/pg-$(date +%Y%m%d-%H%M%S).sql.gz"
  mkdir -p backups
  "${COMPOSE[@]}" exec -T postgres \
    sh -c 'pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB"' | gzip > "$dest"
  log "Backup written: ${dest}"
}

cmd_renew_certs() {
  log "Attempting certificate renewal..."
  "${COMPOSE[@]}" run --rm certbot renew --webroot -w /var/www/certbot
  log "Reloading nginx..."
  "${COMPOSE[@]}" exec nginx nginx -s reload
}

cmd_shell() {
  "${COMPOSE[@]}" exec "${1:-server}" sh
}

case "${1:-}" in
  init)         cmd_init ;;
  deploy)       cmd_deploy ;;
  migrate)      cmd_migrate ;;
  status)       cmd_status ;;
  logs)         shift; cmd_logs "$@" ;;
  backup-db)    cmd_backup_db ;;
  renew-certs)  cmd_renew_certs ;;
  shell)        shift; cmd_shell "$@" ;;
  *)            sed -n '2,20p' "${BASH_SOURCE[0]}"; exit 1 ;;
esac
