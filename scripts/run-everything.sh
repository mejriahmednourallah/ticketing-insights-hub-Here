#!/usr/bin/env bash
# =============================================================================
# run-everything.sh — Complete setup from nuke to a named Cloudflare Tunnel
#
# Usage:
#   chmod +x scripts/run-everything.sh
#   ./scripts/run-everything.sh
#
# What it does:
#   1. Cleanup (kill processes, stop Docker, wipe volumes)
#   2. Load secrets from deploy/secrets/runtime.env
#   3. Write local environment
#   4. Start Supabase (npx supabase start)
#   5. Grant DB permissions
#   6. Serve edge functions
#   7. Ingest all Redmine data (loop batches)
#   8. Build DuckDB analytics warehouse
#   9. Start analytics API
#  10. Start frontend
#  11. Start Caddy, Prometheus, Grafana, and exporters
#  12. Start named Cloudflare Tunnel
#  13. Run health checks
#  14. Print deployment summary
# =============================================================================

set -euo pipefail

# ── Config ────────────────────────────────────────────────────────────────────
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT_DIR}"

SECRETS_FILE="${ROOT_DIR}/deploy/secrets/runtime.env"
CREDENTIALS_FILE="${ROOT_DIR}/deploy/secrets/initial-admin-credentials.txt"
ENV_LOCAL="${ROOT_DIR}/.env.local"
VENV_DIR="${ROOT_DIR}/.venv"
DUCKDB_PATH="/tmp/warehouse-current.duckdb"
RUNTIME_DIR="${ROOT_DIR}/runtime"
TUNNEL_URL_FILE="${RUNTIME_DIR}/tunnel-url.txt"
OBSERVABILITY_COMPOSE="${ROOT_DIR}/docker-compose.run-everything.yml"
TUNNEL_NAME="${CLOUDFLARE_TUNNEL_NAME:-projectdock}"
DOMAIN="${PUBLIC_DOMAIN:-projectdock.studio}"
SUPABASE_URL="http://127.0.0.1:54321"
PG_URL="postgresql://postgres:postgres@127.0.0.1:54322/postgres"
ANON_KEY="${ANON_KEY:-}"
SERVICE_KEY="${SERVICE_ROLE_KEY:-}"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# ── Helpers ───────────────────────────────────────────────────────────────────
log()   { echo -e "${BLUE}[$(date +%H:%M:%S)]${NC} $*"; }
ok()    { echo -e "${GREEN}[OK]${NC} $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $*"; }
err()   { echo -e "${RED}[ERROR]${NC} $*"; }
step()  { echo -e "\n${GREEN}═══ PHASE: $* ═══${NC}"; }

die() {
  err "$*"
  exit 1
}

check_deps() {
  for dep in docker curl npm npx openssl psql python3; do
    command -v "$dep" >/dev/null 2>&1 || die "Missing dependency: $dep"
  done
}

compose_monitoring() {
  if [ -f "$SECRETS_FILE" ]; then
    docker compose --env-file "$SECRETS_FILE" -f "$OBSERVABILITY_COMPOSE" "$@"
  else
    docker compose -f "$OBSERVABILITY_COMPOSE" "$@"
  fi
}

kill_pid_file() {
  local file="$1"
  local label="$2"
  local pid
  pid="$(cat "$file" 2>/dev/null || true)"
  if [[ "$pid" =~ ^[0-9]+$ ]] && kill -0 "$pid" 2>/dev/null; then
    log "Stopping $label (PID $pid)..."
    kill "$pid" 2>/dev/null || true
    for _ in $(seq 1 10); do
      kill -0 "$pid" 2>/dev/null || break
      sleep 0.5
    done
    kill -9 "$pid" 2>/dev/null || true
  fi
  rm -f "$file"
}

kill_port() {
  local port="$1"
  if ! command -v lsof >/dev/null 2>&1; then
    warn "lsof not installed; cannot proactively clean port $port"
    return
  fi

  local pids
  pids="$(lsof -ti ":$port" 2>/dev/null || true)"
  if [ -n "$pids" ]; then
    log "Killing stale process(es) on port $port: $pids"
    kill -9 $pids 2>/dev/null || true
  fi
}

refresh_runtime_config() {
  TUNNEL_NAME="${CLOUDFLARE_TUNNEL_NAME:-projectdock}"
  DOMAIN="${PUBLIC_DOMAIN:-projectdock.studio}"
  ANON_KEY="${ANON_KEY:-}"
  SERVICE_KEY="${SERVICE_ROLE_KEY:-}"
}

ensure_python_env() {
  if [ ! -f "${VENV_DIR}/bin/python3" ]; then
    log "Creating Python venv..."
    python3 -m venv "$VENV_DIR"
  fi
}

read_credential_value() {
  local section="$1"
  local key="$2"
  awk -v wanted_section="$section" -v wanted_key="$key" '
    /^Temporary admin gateway$/ { current = "gateway"; next }
    /^Grafana$/ { current = "grafana"; next }
    current == wanted_section && $1 == wanted_key ":" { print $2; exit }
  ' "$CREDENTIALS_FILE"
}

grafana_form_login() {
  local base_url="$1"
  local username="$2"
  local password="$3"
  local payload
  payload="$(printf '{"user":"%s","password":"%s"}' "$username" "$password")"
  curl -fsS \
    -H "Content-Type: application/json" \
    --data "$payload" \
    "${base_url}/admin/grafana/login" >/dev/null
}

sync_credentials_file() {
  if [ ! -f "$CREDENTIALS_FILE" ]; then
    die "$CREDENTIALS_FILE is missing. Run deploy/scripts/rotate-admin-credentials.sh to regenerate gateway and Grafana credentials."
  fi

  local gateway_user gateway_password grafana_user grafana_password tmp
  gateway_user="$(read_credential_value gateway username)"
  gateway_password="$(read_credential_value gateway password)"
  grafana_user="$(read_credential_value grafana username)"
  grafana_password="$(read_credential_value grafana password)"

  [ -n "$gateway_user" ] && [ -n "$gateway_password" ] \
    || die "Gateway credentials are missing from $CREDENTIALS_FILE"
  grafana_user="${grafana_user:-admin}"

  if [ "$grafana_password" != "$GRAFANA_ADMIN_PASSWORD" ]; then
    warn "Grafana password in credentials file differed from runtime.env; synchronizing credentials file."
    tmp="${CREDENTIALS_FILE}.tmp"
    cat > "$tmp" <<EOF
Temporary admin gateway
username: ${gateway_user}
password: ${gateway_password}

Grafana
username: ${grafana_user}
password: ${GRAFANA_ADMIN_PASSWORD}
EOF
    chmod 600 "$tmp"
    mv "$tmp" "$CREDENTIALS_FILE"
  fi

  chmod 600 "$SECRETS_FILE" "$CREDENTIALS_FILE"
}

# ── Phase 1: Cleanup ──────────────────────────────────────────────────────────
cleanup() {
  step "CLEANUP"

  log "Stopping Supabase..."
  npx supabase stop --no-backup 2>/dev/null || true

  log "Stopping gateway and monitoring containers, removing run-everything volumes..."
  compose_monitoring down --remove-orphans -v 2>/dev/null || true

  log "Stopping stale local service processes..."
  kill_pid_file /tmp/supabase-functions.pid "Supabase functions"
  kill_pid_file /tmp/analytics-api.pid "Analytics API"
  kill_pid_file /tmp/frontend.pid "Frontend"
  kill_pid_file /tmp/tunnel.pid "Cloudflare tunnel"

  log "Killing stale processes on service ports..."
  for port in 8080 8081 8000 3000 9090; do
    kill_port "$port"
  done

  log "Removing Docker networks..."
  docker network ls --filter "name=supabase" -q 2>/dev/null | xargs -r docker network rm 2>/dev/null || true

  log "Removing Docker volumes..."
  docker volume rm -f \
    supabase_db_jfkqwvrqtespwjczpwwc \
    ticketing-insights-hub_postgres_data \
    ticketing-insights-hub_duckdb_warehouse \
    ticketing-insights-hub_deno_cache \
    supabase_config_jfkqwvrqtespwjczpwwc 2>/dev/null || true

  docker volume ls --format '{{.Name}}' \
    | grep -E '^ticketing-run-everything_run_everything_' \
    | xargs -r docker volume rm -f 2>/dev/null || true

  log "Cleaning temp files..."
  rm -f "$DUCKDB_PATH" "${DUCKDB_PATH}.wal"
  rm -f "$TUNNEL_URL_FILE" "${TUNNEL_URL_FILE}.tmp"

  log "Killing old cloudflared tunnels..."
  pkill -f "^cloudflared tunnel run.* ${TUNNEL_NAME}$" 2>/dev/null || true

  ok "Cleanup complete"
}

# ── Phase 2: Load Secrets ─────────────────────────────────────────────────────
load_secrets() {
  step "LOADING SECRETS"

  if [ ! -f "$SECRETS_FILE" ]; then
    warn "$SECRETS_FILE not found, running init-secrets.sh..."
    bash "${ROOT_DIR}/deploy/scripts/init-secrets.sh"
  fi

  # Source secrets file
  set -a
  source "$SECRETS_FILE"
  set +a
  refresh_runtime_config

  # Verify required keys
  if [ "${REDMINE_API_KEY:-}" = "CHANGE_ME_ROTATE_THE_EXPOSED_KEY" ] || [ -z "${REDMINE_API_KEY:-}" ]; then
    die "REDMINE_API_KEY not set in $SECRETS_FILE"
  fi
  if [ -z "${GRAFANA_ADMIN_PASSWORD:-}" ]; then
    die "GRAFANA_ADMIN_PASSWORD not set in $SECRETS_FILE"
  fi
  sync_credentials_file

  ok "Required runtime secrets loaded"
}

# ── Phase 3: Write .env.local ─────────────────────────────────────────────────
write_env_local() {
  step "WRITING .env.local"

  ensure_python_env
  "${VENV_DIR}/bin/python3" "${ROOT_DIR}/scripts/write_env_local.py" \
    "$SECRETS_FILE" "$ENV_LOCAL" 2>&1 || die "Failed to write .env.local"
  ok "Written: $ENV_LOCAL"
}

# ── Phase 4: Start Supabase ───────────────────────────────────────────────────
start_supabase() {
  step "STARTING SUPABASE"

  log "Starting supabase (this may take 60-90s)..."
  npx supabase start > /tmp/supabase-start.log 2>&1 \
    || die "Supabase failed to start. See /tmp/supabase-start.log"

  # Verify containers are healthy
  log "Checking container health..."
  local attempts=0
  while [ $attempts -lt 30 ]; do
    local unhealthy
    unhealthy=$(docker ps --filter "name=supabase" --filter "health=unhealthy" --format "{{.Names}}" 2>/dev/null || true)
    if [ -z "$unhealthy" ]; then
      local total
      total=$(docker ps --filter "name=supabase" -q 2>/dev/null | wc -l)
      if [ "$total" -ge 8 ]; then
        ok "Supabase healthy ($total containers running)"
        break
      fi
    fi
    sleep 3
    attempts=$((attempts + 1))
  done

  if [ $attempts -ge 30 ]; then
    die "Supabase didn't become healthy in time"
  fi
}

# ── Phase 5: Grant DB Permissions ─────────────────────────────────────────────
grant_permissions() {
  step "GRANTING DB PERMISSIONS"

  log "Granting table permissions to roles..."
  psql "$PG_URL" -q -c "GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO service_role, anon, authenticated;" 2>&1 || true
  psql "$PG_URL" -q -c "GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO service_role, anon, authenticated;" 2>&1 || true
  psql "$PG_URL" -q -c "GRANT ALL ON SCHEMA public TO service_role, anon, authenticated;" 2>&1 || true

  ok "Permissions granted"
}

# ── Phase 6: Serve Edge Functions ─────────────────────────────────────────────
serve_functions() {
  step "SERVING EDGE FUNCTIONS"

  log "Starting supabase functions serve..."
  npx supabase functions serve --env-file "$ENV_LOCAL" --no-verify-jwt \
    > /tmp/supabase-functions.log 2>&1 &

  local pid=$!
  echo "$pid" > /tmp/supabase-functions.pid

  # Wait for functions to be ready
  log "Waiting for functions to be ready..."
  sleep 5

  for i in $(seq 1 20); do
    local status
    status=$(curl -s -o /dev/null -w '%{http_code}' "${SUPABASE_URL}/functions/v1/chat" \
      -H "Content-Type: application/json" \
      -d '{"messages":[{"role":"user","content":"ping"}],"ticketSummary":"test"}' 2>/dev/null || echo "000")
    if [ "$status" != "000" ] && [ "$status" != "502" ]; then
      ok "Edge functions ready"
      return
    fi
    sleep 2
  done
  warn "Functions may not be fully ready, continuing anyway..."
}

# ── Phase 7: Ingest Redmine Data ──────────────────────────────────────────────
ingest_redmine() {
  step "REDMINE DATA INGESTION"

  log "Starting ingestion batches..."
  local batch=1
  local max_batches=15
  local total_issues=0

  while [ $batch -le $max_batches ]; do
    log "Batch $batch..."

    local result
    local AUTH="Bearer ${SERVICE_ROLE_KEY}"
    result=$(curl -s -X POST "${SUPABASE_URL}/functions/v1/redmine-ingest" \
      -H "Authorization: ${AUTH}" \
      -H "Content-Type: application/json" \
      -d '{"mode":"full"}' 2>/dev/null || true)

    if [ -z "$result" ]; then
      warn "Batch $batch: empty response, retrying..."
      sleep 5
      continue
    fi

    local ok_status
    ok_status=$(echo "$result" | python3 -c "import sys,json; print(json.load(sys.stdin).get('ok', False))" 2>/dev/null || echo "False")

    if [ "$ok_status" != "True" ]; then
      echo "$result" | head -c 200
      echo
      warn "Batch $batch: non-OK response, retrying in 10s..."
      sleep 10
      continue
    fi

    local issues
    issues=$(echo "$result" | python3 -c "import sys,json; print(json.load(sys.stdin).get('issuesUpserted', 0))" 2>/dev/null || echo "0")
    total_issues=$((total_issues + issues))
    log "  Batch $batch: $issues issues upserted"

    local cycle_complete
    cycle_complete=$(echo "$result" | python3 -c "import sys,json; print(json.load(sys.stdin).get('cycleCompleted', False))" 2>/dev/null || echo "False")

    if [ "$cycle_complete" = "True" ]; then
      ok "Ingestion complete! Total issues: $total_issues"
      break
    fi

    sleep 10
    batch=$((batch + 1))
  done

  # Verify data
  local db_count
  db_count=$(psql "$PG_URL" -t -c "SELECT COUNT(*) FROM redmine_issues;" 2>/dev/null | tr -d ' ' || echo "0")
  local proj_count
  proj_count=$(psql "$PG_URL" -t -c "SELECT COUNT(*) FROM redmine_projects;" 2>/dev/null | tr -d ' ' || echo "0")
  ok "Database: $db_count issues, $proj_count projects"
}

# ── Phase 8: Build DuckDB Warehouse ───────────────────────────────────────────
build_warehouse() {
  step "BUILDING DUCKDB WAREHOUSE"

  # Ensure venv
  if [ ! -f "${VENV_DIR}/bin/python3" ]; then
    log "Creating Python venv..."
    python3 -m venv "$VENV_DIR"
    "${VENV_DIR}/bin/pip" install -q duckdb 2>&1 | tail -1 || die "Failed to install duckdb"
  fi

  log "Copying Postgres data to DuckDB..."
  "${VENV_DIR}/bin/python3" -c "
import duckdb, os
os.environ['HOME'] = '/tmp'
conn = duckdb.connect('${DUCKDB_PATH}', config={'extension_directory': '/tmp/duckdb_extensions'})
conn.execute('install postgres')
conn.execute('load postgres')
conn.execute(\"attach 'host=127.0.0.1 port=54322 dbname=postgres user=postgres password=postgres' as supabase_db (type postgres)\")
conn.execute('create schema if not exists public')
for table in ['redmine_projects', 'redmine_issues']:
    conn.execute(f'create or replace table public.{table} as select * from supabase_db.public.{table}')
r = conn.execute('select count(*) from public.redmine_issues').fetchone()[0]
p = conn.execute('select count(*) from public.redmine_projects').fetchone()[0]
print(f'Warehouse: {p} projects, {r} issues')
conn.close()
" 2>&1 || die "Warehouse build failed"

  # Build analytics views
  log "Building analytics views..."
  export DUCKDB_PATH="${DUCKDB_PATH}"
  "${VENV_DIR}/bin/python3" "${ROOT_DIR}/scripts/build_warehouse.py" "$DUCKDB_PATH" 2>&1
  ok "Analytics views built"
  ok "Warehouse built at $DUCKDB_PATH"
}

# ── Phase 9: Start Analytics API ──────────────────────────────────────────────
start_analytics() {
  step "STARTING ANALYTICS API"

  # Install deps if needed
  if ! "${VENV_DIR}/bin/python3" -c "import fastapi" 2>/dev/null; then
    log "Installing analytics dependencies..."
    "${VENV_DIR}/bin/pip" install -q -r analytics_service/requirements.txt 2>&1 | tail -1
  fi

  log "Starting uvicorn on port 8000..."
  DUCKDB_PATH="$DUCKDB_PATH" \
  ANALYTICS_AUTH_DISABLED=true \
  nohup "${VENV_DIR}/bin/uvicorn" analytics_service.app:app \
    --host 0.0.0.0 --port 8000 \
    > /tmp/analytics-api.log 2>&1 &
  local pid=$!
  echo "$pid" > /tmp/analytics-api.pid

  # Wait for it to be ready
  log "Waiting for analytics API..."
  for i in $(seq 1 15); do
    local status
    status=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8000/v1/health 2>/dev/null || echo "000")
    if [ "$status" = "200" ] || [ "$status" = "503" ]; then
      ok "Analytics API ready (HTTP $status)"
      return
    fi
    sleep 2
  done
  warn "Analytics API may not be ready"
}

# ── Phase 10: Start Frontend ──────────────────────────────────────────────────
start_frontend() {
  step "STARTING FRONTEND"

  cd "$ROOT_DIR"

  # Install deps if needed
  if [ ! -d "node_modules" ]; then
    log "Installing npm dependencies..."
    npm install --silent 2>&1 | tail -1
  fi

  log "Starting Vite dev server on internal port 8081..."
  # IMPORTANT: VITE_ANALYTICS_API_URL must NOT be set when behind tunnel.
  # The frontend defaults to relative '/api/analytics' which is proxied by Vite
  # and forwarded through the tunnel correctly. Direct http://127.0.0.1:8000
  # causes CORS/mixed-content errors on HTTPS pages.
  VITE_SUPABASE_PUBLISHABLE_KEY="${ANON_KEY}" \
  nohup npx vite --host 0.0.0.0 --port 8081 \
    > /tmp/frontend.log 2>&1 &
  local pid=$!
  echo "$pid" > /tmp/frontend.pid

  # Wait for it
  log "Waiting for frontend..."
  for i in $(seq 1 15); do
    local status
    status=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8081 2>/dev/null || echo "000")
    if [ "$status" = "200" ]; then
      ok "Frontend ready"
      return
    fi
    sleep 2
  done
  warn "Frontend may not be ready"
}

# ── Phase 11: Gateway and Monitoring ──────────────────────────────────────────
start_monitoring() {
  step "STARTING GATEWAY, PROMETHEUS, AND GRAFANA"

  compose_monitoring config --quiet \
    || die "Monitoring Compose configuration is invalid"

  compose_monitoring up -d --force-recreate \
    || die "Failed to start gateway and monitoring containers"

  log "Waiting for Caddy gateway..."
  for _ in $(seq 1 30); do
    if curl -fsS http://127.0.0.1:8080/healthz >/dev/null 2>&1; then
      ok "Caddy gateway ready"
      break
    fi
    sleep 2
  done
  curl -fsS http://127.0.0.1:8080/healthz >/dev/null 2>&1 \
    || die "Caddy gateway did not become healthy"

  log "Waiting for Grafana..."
  for _ in $(seq 1 30); do
    if curl -fsS http://127.0.0.1:3000/api/health >/dev/null 2>&1; then
      ok "Grafana ready"
      break
    fi
    sleep 2
  done
  curl -fsS http://127.0.0.1:3000/api/health >/dev/null 2>&1 \
    || die "Grafana did not become healthy"

  log "Synchronizing Grafana admin password with $SECRETS_FILE..."
  compose_monitoring exec -T grafana /usr/share/grafana/bin/grafana cli \
    --homepath /usr/share/grafana \
    --config /etc/grafana/grafana.ini \
    admin reset-admin-password "$GRAFANA_ADMIN_PASSWORD" >/dev/null \
    || die "Failed to reset Grafana admin password"

  log "Verifying Grafana admin credentials..."
  grafana_form_login "http://127.0.0.1:3000" "admin" "$GRAFANA_ADMIN_PASSWORD" \
    || die "Grafana admin credentials do not work"
  ok "Grafana admin credentials verified"

  log "Waiting for Prometheus..."
  for _ in $(seq 1 30); do
    if curl -fsS http://127.0.0.1:9090/-/healthy >/dev/null 2>&1; then
      ok "Prometheus ready"
      return
    fi
    sleep 2
  done

  die "Monitoring stack did not become healthy"
}

# ── Phase 12: Named Cloudflare Tunnel ─────────────────────────────────────────
start_tunnel() {
  step "STARTING NAMED CLOUDFLARE TUNNEL"

  mkdir -p "$RUNTIME_DIR"
  rm -f "$TUNNEL_URL_FILE"

  if ! command -v cloudflared >/dev/null 2>&1; then
    die "cloudflared not installed. Run: sudo curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -o /usr/local/bin/cloudflared && sudo chmod +x /usr/local/bin/cloudflared"
  fi

  if ! cloudflared tunnel info "$TUNNEL_NAME" >/dev/null 2>&1; then
    log "Creating named tunnel: $TUNNEL_NAME"
    cloudflared tunnel create "$TUNNEL_NAME"
    log "Routing $DOMAIN to tunnel $TUNNEL_NAME..."
    cloudflared tunnel route dns "$TUNNEL_NAME" "$DOMAIN"
  else
    log "Using existing named tunnel: $TUNNEL_NAME"
  fi

  log "Starting https://${DOMAIN} → localhost:8080"
  cloudflared tunnel run --url http://localhost:8080 "$TUNNEL_NAME" \
    > /tmp/tunnel.log 2>&1 &
  local pid=$!
  echo "$pid" > /tmp/tunnel.pid

  for _ in $(seq 1 60); do
    if ! kill -0 "$pid" 2>/dev/null; then
      tail -20 /tmp/tunnel.log >&2 || true
      die "Named Cloudflare Tunnel exited before becoming ready"
    fi
    if grep -q 'Registered tunnel connection' /tmp/tunnel.log 2>/dev/null; then
      printf 'https://%s\n' "$DOMAIN" > "${TUNNEL_URL_FILE}.tmp"
      mv "${TUNNEL_URL_FILE}.tmp" "$TUNNEL_URL_FILE"
      ok "Named tunnel running — https://${DOMAIN}"
      return
    fi
    sleep 2
  done

  die "Timed out waiting for the named Cloudflare Tunnel"
}

# ── Phase 13: Health Check ────────────────────────────────────────────────────
health_check() {
  step "HEALTH CHECK"

  echo ""
  echo "  Testing endpoints..."

  # Frontend
  local f_status
  f_status=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8080 2>/dev/null || echo "FAIL")
  [ "$f_status" = "200" ] && ok "Frontend: OK (HTTP 200)" || warn "Frontend: HTTP $f_status"

  # Analytics
  local a_status
  a_status=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8000/v1/health 2>/dev/null || echo "FAIL")
  [ "$a_status" = "200" ] && ok "Analytics API: OK (HTTP 200)" || warn "Analytics API: HTTP $a_status"

  # Supabase REST
  local s_status
  s_status=$(curl -s -o /dev/null -w '%{http_code}' "${SUPABASE_URL}/rest/v1/" \
    -H "apikey: ${ANON_KEY}" 2>/dev/null || echo "FAIL")
  [ "$s_status" = "200" ] && ok "Supabase REST: OK (HTTP 200)" || warn "Supabase REST: HTTP $s_status"

  # Edge functions
  local e_status
  e_status=$(curl -s -o /dev/null -w '%{http_code}' "${SUPABASE_URL}/functions/v1/chat" \
    -H "Content-Type: application/json" \
    -d '{"messages":[{"role":"user","content":"hi"}],"ticketSummary":""}' 2>/dev/null || echo "FAIL")
  [ "$e_status" = "200" ] && ok "Chat function: OK (HTTP 200)" || warn "Chat function: HTTP $e_status"

  # Monitoring
  local g_status p_status protected_status grafana_auth_status gateway_user gateway_password gateway_auth_status prometheus_down
  g_status=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/api/health 2>/dev/null || echo "FAIL")
  [ "$g_status" = "200" ] && ok "Grafana: OK (HTTP 200)" || warn "Grafana: HTTP $g_status"

  grafana_auth_status=$(payload="$(printf '{"user":"%s","password":"%s"}' "admin" "$GRAFANA_ADMIN_PASSWORD")"; curl -s -o /dev/null -w '%{http_code}' \
    -H "Content-Type: application/json" \
    --data "$payload" \
    http://127.0.0.1:3000/admin/grafana/login 2>/dev/null || echo "FAIL")
  [ "$grafana_auth_status" = "200" ] \
    && ok "Grafana admin login: OK" \
    || die "Grafana admin login failed with HTTP $grafana_auth_status"

  p_status=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:9090/-/healthy 2>/dev/null || echo "FAIL")
  [ "$p_status" = "200" ] && ok "Prometheus: OK (HTTP 200)" || warn "Prometheus: HTTP $p_status"

  prometheus_down=$(curl -fsS http://127.0.0.1:9090/api/v1/targets 2>/dev/null \
    | python3 -c 'import json,sys
data=json.load(sys.stdin)
bad=[]
for target in data.get("data", {}).get("activeTargets", []):
  if target.get("health") != "up":
    labels=target.get("labels", {})
    bad.append("{}:{}".format(labels.get("job", "unknown"), target.get("scrapeUrl", target.get("health", "unknown"))))
print("\n".join(bad))' 2>/dev/null || echo "PROMETHEUS_TARGET_QUERY_FAILED")
  if [ -z "$prometheus_down" ]; then
    ok "Prometheus targets: all up"
  else
    warn "Prometheus target issue(s):"
    echo "$prometheus_down" | sed 's/^/    - /'
  fi

  protected_status=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8080/admin/grafana/ 2>/dev/null || echo "FAIL")
  [ "$protected_status" = "401" ] \
    && ok "Grafana gateway route: protected (HTTP 401)" \
    || warn "Grafana gateway route should return 401, got HTTP $protected_status"

  if [ -f "$CREDENTIALS_FILE" ]; then
    gateway_user="$(read_credential_value gateway username)"
    gateway_password="$(read_credential_value gateway password)"
    if [ -n "$gateway_user" ] && [ -n "$gateway_password" ]; then
      gateway_auth_status=$(payload="$(printf '{"user":"%s","password":"%s"}' "admin" "$GRAFANA_ADMIN_PASSWORD")"; curl -s -o /dev/null -w '%{http_code}' \
        -u "${gateway_user}:${gateway_password}" \
        -H "Content-Type: application/json" \
        --data "$payload" \
        http://127.0.0.1:8080/admin/grafana/login 2>/dev/null || echo "FAIL")
      case "$gateway_auth_status" in
        200|302|307)
          ok "Grafana gateway credentials: OK"
          ;;
        *)
          die "Grafana gateway credentials failed with HTTP $gateway_auth_status"
          ;;
      esac
    else
      warn "Could not read gateway credentials from $CREDENTIALS_FILE"
    fi
  else
    warn "$CREDENTIALS_FILE not found; cannot verify gateway Basic Auth credentials"
  fi

  # Database counts
  local db_i db_p
  db_i=$(psql "$PG_URL" -t -c "SELECT COUNT(*) FROM redmine_issues;" 2>/dev/null | tr -d ' ' || echo "?")
  db_p=$(psql "$PG_URL" -t -c "SELECT COUNT(*) FROM redmine_projects;" 2>/dev/null | tr -d ' ' || echo "?")
  ok "Database: $db_i issues, $db_p projects"
}

# ── Phase 14: Print Summary ───────────────────────────────────────────────────
print_summary() {
  step "SUMMARY"

  local public_url
  public_url=$(cat "$TUNNEL_URL_FILE" 2>/dev/null || echo "not available")

  echo ""
  echo -e "${GREEN}╔══════════════════════════════════════════════════════════╗${NC}"
  echo -e "${GREEN}║            TICKETING INSIGHTS HUB — RUNNING              ║${NC}"
  echo -e "${GREEN}╚══════════════════════════════════════════════════════════╝${NC}"
  echo ""
  echo -e "  🌐 Dashboard:      ${BLUE}${public_url}${NC}"
  echo -e "  📈 Grafana:        ${BLUE}${public_url}/admin/grafana/${NC}"
  echo -e "  📈 Grafana local:  ${BLUE}http://127.0.0.1:3000${NC}"
  echo -e "  🔎 Prometheus:     ${BLUE}http://127.0.0.1:9090${NC}"
  echo -e "  🗄️  Studio:         ${BLUE}http://127.0.0.1:54323${NC}"
  echo -e "  📊 Analytics API:  ${BLUE}http://127.0.0.1:8000${NC}"
  echo -e "  📦 Supabase API:   ${BLUE}${SUPABASE_URL}${NC}"
  echo -e "  🔑 DB:             ${BLUE}${PG_URL}${NC}"
  echo -e "  📦 Warehouse:      ${BLUE}${DUCKDB_PATH}${NC}"
  echo ""
  echo -e "  🔐 Gateway user:   ${YELLOW}admin${NC}"
  echo -e "  🔐 Grafana user:   ${YELLOW}admin${NC}"
  echo -e "  🔐 Passwords:      ${YELLOW}deploy/secrets/initial-admin-credentials.txt${NC}"
  echo ""
  echo -e "  📝 Frontend log:   /tmp/frontend.log"
  echo -e "  📝 API log:        /tmp/analytics-api.log"
  echo -e "  📝 Functions log:  /tmp/supabase-functions.log"
  echo -e "  📝 Tunnel log:     /tmp/tunnel.log"
  echo ""
  echo -e "  ${YELLOW}Stop everything:${NC}"
  echo -e "    pkill -f vite; pkill -f uvicorn; pkill -f 'supabase functions'"
  echo -e "    pkill -f cloudflared; npx supabase stop"
  echo -e "    docker compose --env-file deploy/secrets/runtime.env -f docker-compose.run-everything.yml down"
  echo ""
  echo -e "  ${YELLOW}Status:${NC}"
  echo -e "    bash deploy/scripts/status.sh"
  echo ""
}

# ═════════════════════════════════════════════════════════════════════════════
# MAIN
# ═════════════════════════════════════════════════════════════════════════════
main() {
  echo -e "${GREEN}"
  echo "╔══════════════════════════════════════════════════════════╗"
  echo "║   run-everything.sh — Ticketing Insights Hub             ║"
  printf "║   Domain: %-45s║\n" "$DOMAIN"
  echo "╚══════════════════════════════════════════════════════════╝"
  echo -e "${NC}"

  check_deps

  cleanup              # 1
  load_secrets         # 2
  write_env_local      # 3
  start_supabase       # 4
  grant_permissions    # 5
  serve_functions      # 6
  ingest_redmine       # 7
  build_warehouse      # 8
  start_analytics      # 9
  start_frontend       # 10
  start_monitoring     # 11
  start_tunnel         # 12
  health_check         # 13
  print_summary        # 14

  echo -e "\n${GREEN}🎉 Everything is running! Visit: $(cat "$TUNNEL_URL_FILE")${NC}\n"
}

main "$@"
