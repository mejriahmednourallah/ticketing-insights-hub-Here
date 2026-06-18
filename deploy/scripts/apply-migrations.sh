#!/bin/sh
set -eu

until pg_isready >/dev/null 2>&1; do
  sleep 2
done

psql -v ON_ERROR_STOP=1 <<'SQL'
CREATE TABLE IF NOT EXISTS public.deployment_migrations (
  filename text PRIMARY KEY,
  checksum text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now()
);
SQL

for migration in /migrations/*.sql; do
  filename="$(basename "$migration")"
  case "$filename" in
    20260408131500_redmine_ingest_cron.sql|20260526000300_schedule_mart_refresh.sql)
      echo "[migrations] external scheduler replaces $filename"
      continue
      ;;
  esac

  checksum="$(sha256sum "$migration" | awk '{print $1}')"
  existing="$(psql -Atqc "select checksum from public.deployment_migrations where filename = '$filename'")"
  if [ -n "$existing" ]; then
    if [ "$existing" != "$checksum" ]; then
      echo "[migrations] checksum mismatch for already-applied $filename" >&2
      exit 1
    fi
    echo "[migrations] already applied: $filename"
    continue
  fi

  echo "[migrations] applying: $filename"
  psql -v ON_ERROR_STOP=1 -f "$migration"
  psql -v ON_ERROR_STOP=1 \
    --set=filename="$filename" \
    --set=checksum="$checksum" <<'SQL'
INSERT INTO public.deployment_migrations (filename, checksum)
VALUES (:'filename', :'checksum');
SQL
done

psql -v ON_ERROR_STOP=1 <<'SQL'
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT SELECT ON public.redmine_ticket_view TO anon, authenticated, service_role;
GRANT SELECT ON public.redmine_projects TO service_role;
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;
NOTIFY pgrst, 'reload schema';
SQL

echo "[migrations] complete"
