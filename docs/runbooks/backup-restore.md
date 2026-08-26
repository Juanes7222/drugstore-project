# Backup & Restore — Age encrypted + R2 offsite

## Why age (asymmetric) over BACKUP_ENCRYPTION_KEY (symmetric)

- **Symmetric** (`BACKUP_ENCRYPTION_KEY`) in `.env.prod` → visible via `docker inspect`, leaks decrypt every historic backup. Rotation re-encrypts all history.
- **Age asymmetric**: `secrets/backup_age.key` (private) stays on host (`600`, `.dockerignore`, never in Infisical/GHCR). `BACKUP_AGE_PUBLIC_KEY` (`age1...`) is public and only encrypts. Stealing env or VM does NOT decrypt history. Private kept offline (1Password/vault). Required for Habeas Data pg_dump.

Decision: **age**. Symmetric is anti-pattern — never use.

## Setup (once, prod VM)

```bash
sudo apt update && sudo apt install -y age awscli  # awscli for R2 upload (or rclone)
./scripts/deploy.sh status                         # auto-generates secrets/backup_age.key
grep "public key" secrets/backup_age.key           # age1...
echo 'BACKUP_AGE_PUBLIC_KEY=age1...' >> .env.prod && chmod 600 .env.prod
cp secrets/backup_age.key ~/backup_age.key.offline # OFFLINE NOW — loss = unrecoverable
# Optional offsite: add to .env.prod or Infisical
# R2_ENDPOINT=https://<acct>.r2.cloudflarestorage.com
# R2_BACKUPS_BUCKET=pharmacy-backups-prod
# R2_BACKUPS_ACCESS_KEY_ID=...
# R2_BACKUPS_SECRET_ACCESS_KEY=...

# Always-on: systemd + cron
sudo ./scripts/deploy.sh install-systemd
./scripts/deploy.sh cron-setup   # backup 03:00, renew 04:00, prune weekly
sudo systemctl start pharmacy && systemctl is-active pharmacy
```

R2 bucket: enable **Versioning** + **Lifecycle 90d** in Cloudflare. The host uploads only `*.age` (never plaintext).

## Backup

```bash
./scripts/deploy.sh backup-db
# → backups/pg-20260827-030000.sql.gz.age (plaintext removed after header verify)
# → offsite: s3://$R2_BACKUPS_BUCKET/pharmacy-db/pg-....age (if R2 configured)
# Local rotation: 14d, keep 5 newest; R2 lifecycle handles offsite retention
ls -lh backups/
# Verify offsite:
aws s3 ls s3://$R2_BACKUPS_BUCKET/pharmacy-db/ --endpoint-url $R2_ENDPOINT
```

Cron installed by `cron-setup`:

```cron
0 3 * * * cd /opt/pharmacy && ./scripts/deploy.sh backup-db >> /var/log/pharmacy-backup.log 2>&1
0 4 * * * cd /opt/pharmacy && ./scripts/deploy.sh renew-certs >> /var/log/pharmacy-renew.log 2>&1
0 5 * * 0 docker image prune -f --filter 'until=168h' >/dev/null
```

Check logs: `tail -f /var/log/pharmacy-backup.log`; alert if no `.age` in 25h.

## Restore

```bash
# Local encrypted
./scripts/deploy.sh restore-db backups/pg-20260827-030000.sql.gz.age
# Manual:
age -d -i secrets/backup_age.key backups/pg-xxx.sql.gz.age | gunzip | docker compose -f docker-compose.prod.yml exec -T postgres psql -U pharmacy_app pharmacy_prod_db

# From R2
aws s3 cp s3://$R2_BACKUPS_BUCKET/pharmacy-db/pg-xxx.sql.gz.age /tmp/restore.age --endpoint-url $R2_ENDPOINT
age -d -i ~/backup_age.key.offline -o /tmp/restore.sql.gz /tmp/restore.age && gunzip -c /tmp/restore.sql.gz | psql ...

# Plaintext fallback (if age not installed at backup time):
./scripts/deploy.sh restore-db backups/pg-xxx.sql.gz
```

## Key rotation / compromise

- New key: `age-keygen -o secrets/backup_age.key.new && mv ...`; keep old `.key` archived — old backups need old private key.
- Update `BACKUP_AGE_PUBLIC_KEY` to new `age1...`.
- R2: old objects stay decryptable with old key (versioning preserves them).

## Always-accessible guarantees

- `restart: unless-stopped` + `init: true` + `healthcheck` on every service; `depends_on: service_healthy` prevents nginx serving before API is ready.
- `pharmacy.service` (systemd) reapplies `up -d` on boot; `chmod 600` guard in `ExecStartPre` prevents secret leak after reboot.
- `cron-setup` ensures daily probe (backup) and TLS renewal; `logrotate` caps logs at 14d.
- Disk guard in `backup-db` warns at >80% on `backups` filesystem.
- Offsite R2 means single-VM disk loss does NOT lose DB history — restore from any machine with private key + R2 creds.

## Plaintext fallback

If `age` missing or `BACKUP_AGE_PUBLIC_KEY` empty, backup stays `.gz` plaintext with WARNING. Install `age` to enable encryption + offsite (only `.age` is uploaded).
