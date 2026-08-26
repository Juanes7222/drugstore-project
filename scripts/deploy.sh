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
#   backup-db   pg_dump | gzip into ./backups (with 14d rotation)
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
  # Enforce 600 on .env.prod (contains Infisical bootstrap secrets)
  local perms
  perms="$(stat -c %a .env.prod 2>/dev/null || stat -f %Lp .env.prod 2>/dev/null || echo unknown)"
  if [[ "$perms" != "600" ]]; then
    log "Fixing .env.prod permissions to 600 (was $perms)"
    chmod 600 .env.prod
  fi
  [[ -d secrets ]] || mkdir -p secrets
  chmod 700 secrets 2>/dev/null || true
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
  # Validate perms on secrets
  for f in secrets/postgres_password secrets/redis_password; do
    perms="$(stat -c %a "$f" 2>/dev/null || stat -f %Lp "$f" 2>/dev/null || echo unknown)"
    [[ "$perms" == "600" ]] || chmod 600 "$f"
  done
  # Age keypair for DB backup encryption (asymmetric — public encrypts, private decrypts offline)
  # Private key NEVER leaves this host; public key can be in .env.prod/Infisical.
  ensure_backup_age_key() {
    if [[ -s secrets/backup_age.key ]]; then
      perms="$(stat -c %a secrets/backup_age.key 2>/dev/null || stat -f %Lp secrets/backup_age.key 2>/dev/null || echo unknown)"
      [[ "$perms" == "600" ]] || chmod 600 secrets/backup_age.key
      return 0
    fi
    if ! command -v age-keygen >/dev/null 2>&1 && ! command -v age >/dev/null 2>&1; then
      log "age not installed — skipping backup Age key generation (install 'age' via apt: sudo apt install age)"
      return 1
    fi
    local keygen="age-keygen"
    command -v age-keygen >/dev/null 2>&1 || keygen="age"
    log "Generating age keypair for DB backup encryption (secrets/backup_age.key)"
    if [[ "$keygen" == "age-keygen" ]]; then
      age-keygen -o secrets/backup_age.key 2>&1 | tee /tmp/age-keygen.out || true
    else
      # Fallback: generate via openssl + age format (age 1.2+ can generate with `age-keygen` only)
      die "age-keygen not found but age is installed — install age-keygen (package 'age')"
    fi
    chmod 600 secrets/backup_age.key
    local pub
    pub="$(grep -E '^# public key: ' secrets/backup_age.key | cut -d' ' -f4 || grep -E '^age1' secrets/backup_age.key | head -n1)"
    if [[ -n "$pub" ]]; then
      log "Age public key: $pub"
      log "Add to .env.prod: BACKUP_AGE_PUBLIC_KEY=$pub  (and to Infisical if you sync prod secrets)"
      # Also write pub file for convenience
      echo "$pub" > secrets/backup_age.pub
      chmod 600 secrets/backup_age.pub
    fi
  }
  ensure_backup_age_key || true
}

resolve_container() {
  local service="$1"
  local cid
  cid="$("${COMPOSE[@]}" ps -q "$service" 2>/dev/null | head -n1)"
  if [[ -z "$cid" ]]; then
    # Fallback to name pattern
    cid="$(docker ps -q --filter "name=pharmacy-${service}-" | head -n1)"
  fi
  echo "$cid"
}

wait_healthy() {
  local service="$1" timeout="${2:-180}" elapsed=0 status="" cid=""
  log "Waiting for ${service} to become healthy (timeout ${timeout}s)..."
  while true; do
    cid="$(resolve_container "$service")"
    if [[ -z "$cid" ]]; then
      status="missing"
    else
      status="$(docker inspect -f '{{.State.Health.Status}}' "$cid" 2>/dev/null || echo missing)"
      # If no healthcheck defined, fall back to running state
      if [[ "$status" == "" || "$status" == "<no value>" ]]; then
        status="$(docker inspect -f '{{.State.Status}}' "$cid" 2>/dev/null || echo missing)"
        [[ "$status" == "running" ]] && status="healthy"
      fi
    fi
    case "$status" in
      healthy)  log "${service} (${cid:-unknown}) is healthy"; return 0 ;;
      missing)  die "container for service ${service} not found" ;;
    esac
    elapsed=$((elapsed + 5))
    if (( elapsed >= timeout )); then
      [[ -n "$cid" ]] && docker logs --tail 50 "$cid" || true
      die "${service} did not become healthy within ${timeout}s (last status: $status)"
    fi
    sleep 5
  done
}

cmd_init() {
  require_env
  : "${DOMAIN:?set DOMAIN in .env.prod}"
  : "${ACME_EMAIL:?set ACME_EMAIL in .env.prod}"
  local domains=("$DOMAIN")
  [[ -n "${DOMAIN_API:-}" && "${DOMAIN_API}" != "$DOMAIN" ]] && domains+=("$DOMAIN_API")
  [[ -n "${DOMAIN_BACKOFFICE:-}" ]] && domains+=("$DOMAIN_BACKOFFICE")
  [[ -n "${DOMAIN_LANDING:-}" ]] && domains+=("$DOMAIN_LANDING")
  # Deduplicate
  mapfile -t domains < <(printf '%s\n' "${domains[@]}" | awk '!seen[$0]++')
  log "Starting datastores..."
  "${COMPOSE[@]}" up -d postgres redis
  log "Issuing initial TLS certificate for ${domains[*]} (standalone mode, port 80)..."
  local cert_args=()
  for d in "${domains[@]}"; do cert_args+=(-d "$d"); done
  "${COMPOSE[@]}" run --rm certbot \
    certonly --standalone \
    "${cert_args[@]}" \
    --email "$ACME_EMAIL" \
    --agree-tos --no-eff-email --non-interactive
  log "Starting full stack..."
  "${COMPOSE[@]}" up -d
  wait_healthy server 240
  cmd_status
}

cmd_deploy() {
  require_env
  log "Building images (--pull base images, parallel)..."
  "${COMPOSE[@]}" build --pull --parallel
  log "Applying database migrations..."
  "${COMPOSE[@]}" --profile tools run --rm migrate
  log "Rolling services..."
  "${COMPOSE[@]}" up -d
  wait_healthy server 240
  wait_healthy fiscal-engine 120
  # Frontends are optional — only wait if they are defined
  if "${COMPOSE[@]}" config --services | grep -qx "web-backoffice"; then
    wait_healthy web-backoffice 60 || log "web-backoffice healthcheck skipped/failed"
  fi
  if "${COMPOSE[@]}" config --services | grep -qx "web-landing"; then
    wait_healthy web-landing 60 || log "web-landing healthcheck skipped/failed"
  fi
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
  local enc_dest="${dest}.age"
  mkdir -p backups
  chmod 700 backups 2>/dev/null || true
  "${COMPOSE[@]}" exec -T postgres \
    sh -c 'pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB"' | gzip > "$dest"
  chmod 600 "$dest"
  log "Backup written: ${dest} ($(du -h "$dest" | cut -f1))"

  # --- Age asymmetric encryption (recommended) ---
  # Encrypts with public key; private key (secrets/backup_age.key) stays offline.
  # If server is compromised, backups remain unreadable without the private key.
  # Symmetric BACKUP_ENCRYPTION_KEY is intentionally NOT used — it would be
  # visible via `docker inspect`/`env` and rotation would re-encrypt all history.
  local age_pub="${BACKUP_AGE_PUBLIC_KEY:-}"
  if [[ -z "$age_pub" && -s secrets/backup_age.pub ]]; then
    age_pub="$(cat secrets/backup_age.pub)"
  fi
  if [[ -z "$age_pub" && -s secrets/backup_age.key ]]; then
    age_pub="$(grep -E '^# public key: ' secrets/backup_age.key | cut -d' ' -f4 || true)"
  fi
  if [[ -n "$age_pub" ]]; then
    if command -v age >/dev/null 2>&1; then
      if echo "test" | age -r "$age_pub" -o /tmp/age-probe.age 2>/dev/null && rm -f /tmp/age-probe.age; then
        age -r "$age_pub" -o "$enc_dest" "$dest"
        chmod 600 "$enc_dest"
        # Verify round-trip header
        if head -c 20 "$enc_dest" | grep -q "age-encryption"; then
          # Remove plaintext only after successful encryption
          rm -f "$dest"
          log "Backup encrypted: ${enc_dest} (plaintext removed, decrypt with: age -d -i secrets/backup_age.key $enc_dest | gunzip | psql)"
          dest="$enc_dest"
        else
          log "Age encryption produced unexpected output — keeping plaintext"
          rm -f "$enc_dest"
        fi
      else
        log "WARNING: BACKUP_AGE_PUBLIC_KEY invalid or age encrypt failed — keeping plaintext ${dest}"
      fi
    else
      log "WARNING: age not installed — backup left as plaintext ${dest} (install: sudo apt install age)"
      log "         Decrypt not possible until age is installed; plaintext is your only copy"
    fi
  else
    log "WARNING: No BACKUP_AGE_PUBLIC_KEY / secrets/backup_age.key found — backup left as plaintext"
    log "         Generate: ./scripts/deploy.sh will auto-generate on next require_env, or run: age-keygen -o secrets/backup_age.key"
  fi

  # Rotation: keep 14 days, keep at least 5 most recent regardless of age (covers both .gz and .gz.age)
  for pattern in "pg-*.sql.gz" "pg-*.sql.gz.age"; do
    if compgen -G "backups/$pattern" > /dev/null; then
      local to_delete
      to_delete="$(find backups -name "$pattern" -mtime +14 | sort)"
      if [[ -n "$to_delete" ]]; then
        local keep
        keep="$(ls -t backups/$pattern 2>/dev/null | head -n 5 || true)"
        while IFS= read -r f; do
          if ! grep -qxF "$f" <<< "$keep"; then
            rm -f "$f" && log "Rotated old backup: $f"
          fi
        done <<< "$to_delete"
      fi
    fi
  done

  # --- Offsite to R2 (encrypted .age only) — always-on, never plaintext ---
  local final_file="$dest"
  if [[ -f "$enc_dest" ]]; then
    final_file="$enc_dest"
  fi
  if [[ "$final_file" == *.age ]]; then
    cmd_upload-backup-to-r2 "$final_file" || log "Offsite upload skipped/failed — local encrypted backup retained at $final_file"
  else
    log "Skipping offsite upload: backup is plaintext (no .age) — install age and set BACKUP_AGE_PUBLIC_KEY to enable offsite"
  fi
  # Disk pressure guard: warn if /var/lib/docker or backups >80%
  local usage
  usage="$(df -h backups 2>/dev/null | awk 'NR==2{print $5}' | tr -d '%' || echo 0)"
  if (( usage > 80 )); then
    log "WARNING: backups filesystem ${usage}% full — consider pruning or expanding disk"
  fi
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

cmd_restore-db() {
  local src="${1:-}"
  [[ -n "$src" ]] || die "Usage: $0 restore-db <backups/pg-xxx.sql.gz[.age]>"
  [[ -f "$src" ]] || die "File not found: $src"
  local tmp="/tmp/restore-$(date +%s).sql.gz"
  if [[ "$src" == *.age ]]; then
    local key="secrets/backup_age.key"
    [[ -s "$key" ]] || die "Private key $key not found — cannot decrypt $src (restore requires offline key)"
    command -v age >/dev/null 2>&1 || die "age not installed — sudo apt install age"
    log "Decrypting $src → $tmp"
    age -d -i "$key" -o "$tmp" "$src"
  else
    log "WARNING: Restoring plaintext backup (not age-encrypted) — $src"
    cp "$src" "$tmp"
  fi
  # Pre-flight: confirm gzip valid and contains SQL
  gzip -t "$tmp" || die "Backup gzip integrity check failed"
  log "Restoring to postgres (this will overwrite pharmacy_prod_db — Ctrl+C within 5s to abort)..."
  sleep 5
  gunzip -c "$tmp" | "${COMPOSE[@]}" exec -T postgres sh -c 'psql -U "$POSTGRES_USER" "$POSTGRES_DB"'
  local rc=$?
  rm -f "$tmp"
  if (( rc == 0 )); then
    log "Restore complete from $src"
  else
    die "Restore failed (psql exit $rc)"
  fi
}

cmd_upload-backup-to-r2() {
  local file="$1"
  # Prefer host env (from .env.prod or shell), fallback to Infisical via server container if available
  local endpoint="${R2_ENDPOINT:-}"
  local bucket="${R2_BACKUPS_BUCKET:-}"
  local access_key="${R2_BACKUPS_ACCESS_KEY_ID:-}"
  local secret_key="${R2_BACKUPS_SECRET_ACCESS_KEY:-}"
  if [[ -z "$endpoint" || -z "$bucket" || -z "$access_key" || -z "$secret_key" ]]; then
    # Try to fetch from running server's Infisical-resolved env (best-effort, no secrets in logs)
    local cid
    cid="$(resolve_container server)"
    if [[ -n "$cid" ]]; then
      endpoint="${endpoint:-$(docker exec "$cid" printenv R2_ENDPOINT 2>/dev/null || true)}"
      bucket="${bucket:-$(docker exec "$cid" printenv R2_BACKUPS_BUCKET 2>/dev/null || true)}"
      access_key="${access_key:-$(docker exec "$cid" printenv R2_BACKUPS_ACCESS_KEY_ID 2>/dev/null || true)}"
      secret_key="${secret_key:-$(docker exec "$cid" printenv R2_BACKUPS_SECRET_ACCESS_KEY 2>/dev/null || true)}"
    fi
  fi
  if [[ -z "$endpoint" || -z "$bucket" || -z "$access_key" || -z "$secret_key" ]]; then
    log "R2 offsite not configured — skipping upload (set R2_ENDPOINT/R2_BACKUPS_BUCKET/R2_BACKUPS_* in .env.prod or Infisical)"
    return 0
  fi
  local r2_file="pharmacy-db/$(basename "$file")"
  # Prefer rclone if available (better for R2), fallback to aws cli, fallback to server's @aws-sdk via one-shot helper
  if command -v rclone >/dev/null 2>&1 && rclone listremotes 2>/dev/null | grep -q "r2:"; then
    log "Uploading $file → r2:$bucket/$r2_file (rclone)"
    rclone copyto "$file" "r2:$bucket/$r2_file" --s3-provider Cloudflare --s3-endpoint "$endpoint" 2>&1 | head -n 20 || log "rclone upload failed"
  elif command -v aws >/dev/null 2>&1; then
    log "Uploading $file → s3://$bucket/$r2_file (aws cli, endpoint $endpoint)"
    AWS_ACCESS_KEY_ID="$access_key" AWS_SECRET_ACCESS_KEY="$secret_key" \
      aws s3 cp "$file" "s3://$bucket/$r2_file" --endpoint-url "$endpoint" --only-show-errors 2>&1 | head -n 20 || log "aws s3 cp failed"
  else
    # Fallback: use a throwaway aws-cli container with secrets via env (never logged)
    log "Uploading $file → s3://$bucket/$r2_file (ephemeral aws-cli container)"
    docker run --rm -i \
      -e AWS_ACCESS_KEY_ID="$access_key" -e AWS_SECRET_ACCESS_KEY="$secret_key" \
      -v "$(pwd)/$file:/tmp/backup.age:ro" \
      amazon/aws-cli:2.15.0 s3 cp /tmp/backup.age "s3://$bucket/$r2_file" --endpoint-url "$endpoint" --only-show-errors 2>&1 | head -n 20 || log "ephemeral aws-cli upload failed"
  fi
  # Verify remote exists (HEAD)
  if command -v rclone >/dev/null 2>&1; then
    rclone ls "r2:$bucket/$r2_file" 2>/dev/null | grep -q "$(basename "$file")" && log "Offsite verified: r2:$bucket/$r2_file"
  fi
}

cmd_install-systemd() {
  local src="docker/pharmacy.service"
  local dst="/etc/systemd/system/pharmacy.service"
  [[ -f "$src" ]] || die "$src not found"
  # Ensure WorkingDirectory matches current deploy path
  local wd
  wd="$(pwd)"
  log "Installing systemd unit $dst (WorkingDirectory=$wd)"
  # Patch WorkingDirectory if repo not at /opt/pharmacy
  sed "s|WorkingDirectory=.*|WorkingDirectory=$wd|" "$src" > /tmp/pharmacy.service.tmp
  sudo cp /tmp/pharmacy.service.tmp "$dst"
  rm -f /tmp/pharmacy.service.tmp
  sudo systemctl daemon-reload
  sudo systemctl enable pharmacy.service
  log "Installed. Enable on boot: sudo systemctl enable pharmacy.service"
  log "Start now: sudo systemctl start pharmacy.service"
  # Install logrotate if present
  if [[ -f docker/logrotate-pharmacy ]]; then
    sudo cp docker/logrotate-pharmacy /etc/logrotate.d/pharmacy
    log "Installed logrotate /etc/logrotate.d/pharmacy"
  fi
}

cmd_cron-setup() {
  local cron_backup="0 3 * * * cd $(pwd) && ./scripts/deploy.sh backup-db >> /var/log/pharmacy-backup.log 2>&1"
  local cron_renew="0 4 * * * cd $(pwd) && ./scripts/deploy.sh renew-certs >> /var/log/pharmacy-renew.log 2>&1"
  local cron_prune="0 5 * * 0 docker image prune -f --filter 'until=168h' >/dev/null 2>&1"
  log "Installing cron jobs (backup daily 03:00, renew 04:00, prune weekly):"
  echo "  $cron_backup"
  echo "  $cron_renew"
  echo "  $cron_prune"
  (crontab -l 2>/dev/null | grep -v "pharmacy.*deploy.sh"; echo "$cron_backup"; echo "$cron_renew"; echo "$cron_prune") | crontab -
  sudo mkdir -p /var/log
  sudo touch /var/log/pharmacy-backup.log /var/log/pharmacy-renew.log
  sudo chmod 640 /var/log/pharmacy-*.log 2>/dev/null || true
  log "Crontab installed. Verify: crontab -l"
}

case "${1:-}" in
  init)            cmd_init ;;
  deploy)          cmd_deploy ;;
  migrate)         cmd_migrate ;;
  status)          cmd_status ;;
  logs)            shift; cmd_logs "$@" ;;
  backup-db)       cmd_backup-db ;;
  restore-db)      shift; cmd_restore-db "$@" ;;
  renew-certs)     cmd_renew_certs ;;
  shell)           shift; cmd_shell "$@" ;;
  install-systemd) cmd_install-systemd ;;
  cron-setup)      cmd_cron-setup ;;
  *)               sed -n '2,30p' "${BASH_SOURCE[0]}"; exit 1 ;;
esac
