#!/bin/sh
set -eu

daily_retention="${BACKUP_DAILY_RETENTION:-14}"
weekly_retention="${BACKUP_WEEKLY_RETENTION:-8}"
mkdir -p /backups/daily /backups/weekly /backups/manifests

run_backup() {
  date_stamp="$(date -u +%Y-%m-%d)"
  timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
  dump="/backups/daily/postgres-$timestamp.dump"
  manifest="/backups/manifests/config-$timestamp.tar.gz"

  echo "[backup] creating $dump"
  pg_dump --format=custom --compress=9 --file="$dump"
  sha256sum "$dump" > "$dump.sha256"
  tar -czf "$manifest" -C /config migrations docker-compose.production.yml
  sha256sum "$manifest" > "$manifest.sha256"

  if [ "$(date -u +%u)" = "7" ]; then
    cp "$dump" "/backups/weekly/postgres-$timestamp.dump"
    cp "$dump.sha256" "/backups/weekly/postgres-$timestamp.dump.sha256"
  fi

  find /backups/daily -type f -mtime "+$daily_retention" -delete
  find /backups/manifests -type f -mtime "+$daily_retention" -delete
  find /backups/weekly -type f -mtime "+$((weekly_retention * 7))" -delete

  printf '%s\n' "$date_stamp" > /backups/.last-date
  touch /backups/.last-success
}

verify_monthly_restore() {
  month="$(date -u +%Y-%m)"
  [ "$(cat /backups/.last-restore-month 2>/dev/null || true)" != "$month" ] || return 0
  latest="$(find /backups/daily -name '*.dump' -type f | sort | tail -n1)"
  [ -n "$latest" ] || return 0

  database="ticketing_restore_verify"
  echo "[backup] verifying restore from $latest"
  dropdb --if-exists "$database"
  createdb "$database"
  pg_restore --dbname="$database" --no-owner --no-privileges "$latest"

  source_count="$(psql -Atqc 'select count(*) from public.redmine_issues')"
  restored_count="$(psql --dbname="$database" -Atqc 'select count(*) from public.redmine_issues')"
  dropdb "$database"
  [ "$source_count" = "$restored_count" ] || {
    echo "[backup] restore verification failed: source=$source_count restored=$restored_count" >&2
    exit 1
  }
  printf '%s\n' "$month" > /backups/.last-restore-month
  echo "[backup] monthly restore verification passed"
}

while true; do
  today="$(date -u +%Y-%m-%d)"
  if [ "$(cat /backups/.last-date 2>/dev/null || true)" != "$today" ]; then
    run_backup
    verify_monthly_restore
  fi
  sleep 3600
done
