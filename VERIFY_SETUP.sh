#!/usr/bin/env bash
# Verification script - Run after setup to confirm everything works

set -e

echo "================================"
echo "🔍 Post-Setup Verification"
echo "================================"
echo ""

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "${ROOT_DIR}"

# Check 1: Verify .env files exist
echo "1️⃣  Checking environment files..."
if [[ ! -f .env ]]; then
    echo "   ❌ .env missing"
    exit 1
fi
echo "   ✅ .env exists"

if [[ ! -f .env.local.runtime ]]; then
    echo "   ⚠️  .env.local.runtime not found (will be created by bootstrap)"
else
    echo "   ✅ .env.local.runtime exists"
    source .env.local.runtime || echo "   ⚠️  Could not source .env.local.runtime"
fi

# Check 2: Verify Supabase is running
echo ""
echo "2️⃣  Checking Supabase status..."
if supabase status --local > /dev/null 2>&1; then
    echo "   ✅ Supabase is running"
    SUPABASE_URL=$(supabase status --local | grep "API URL" | awk '{print $NF}')
    echo "   📍 API URL: ${SUPABASE_URL}"
else
    echo "   ❌ Supabase not running. Start it with: supabase start --no-verify-jwt-secret"
    exit 1
fi

# Check 3: Verify database tables exist
echo ""
echo "3️⃣  Checking database tables..."
DB_CHECK=$(supabase postgres connect --local <<SQL 2>&1 || echo "Connection failed"
SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='redmine_projects') as has_projects,
       EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='redmine_issues') as has_issues,
       EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='sync_state') as has_sync_state,
       EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='sync_runs') as has_sync_runs;
SQL
)

if echo "${DB_CHECK}" | grep -q "true.*true.*true.*true"; then
    echo "   ✅ All required tables exist"
else
    echo "   ❌ Some tables are missing. Run: supabase db push"
fi

# Check 4: Verify Edge Function is deployed
echo ""
echo "4️⃣  Checking Edge Function deployment..."
if [[ -f "supabase/functions/redmine-ingest/index.ts" ]]; then
    echo "   ✅ Function source exists"
    # Try to check if function is actually deployed
    FUNC_CHECK=$(supabase functions list --local 2>&1 | grep -q "redmine-ingest" && echo "deployed" || echo "not-deployed")
    if [[ "${FUNC_CHECK}" == "deployed" ]]; then
        echo "   ✅ Function is deployed"
    else
        echo "   ⚠️  Function may not be deployed. Run: supabase functions deploy redmine-ingest --no-verify-jwt"
    fi
else
    echo "   ❌ Function source missing"
fi

# Check 5: Verify migrations exist
echo ""
echo "5️⃣  Checking migrations..."
MIGRATION_COUNT=$(find supabase/migrations -name "*.sql" | wc -l)
if [[ ${MIGRATION_COUNT} -ge 2 ]]; then
    echo "   ✅ Found ${MIGRATION_COUNT} migration files"
else
    echo "   ❌ Expected at least 2 migrations, found ${MIGRATION_COUNT}"
fi

# Check 6: Verify Docker compose file
echo ""
echo "6️⃣  Checking Docker setup..."
if [[ ! -f "docker-compose.yml" ]]; then
    echo "   ❌ docker-compose.yml missing"
else
    echo "   ✅ docker-compose.yml exists"
fi

if [[ ! -f "Dockerfile" ]]; then
    echo "   ❌ Dockerfile missing"
else
    echo "   ✅ Dockerfile exists"
fi

# Check 7: Verify npm scripts
echo ""
echo "7️⃣  Checking npm scripts..."
if grep -q '"probe:redmine"' package.json; then
    echo "   ✅ probe:redmine script found"
else
    echo "   ❌ probe:redmine script missing"
fi

if grep -q '"ingest:redmine:function"' package.json; then
    echo "   ✅ ingest:redmine:function script found"
else
    echo "   ❌ ingest:redmine:function script missing"
fi

if grep -q '"local:bootstrap"' package.json; then
    echo "   ✅ local:bootstrap script found"
else
    echo "   ❌ local:bootstrap script missing"
fi

# Check 8: Count data in Supabase
echo ""
echo "8️⃣  Checking data in Supabase..."
DATA_CHECK=$(supabase postgres connect --local <<SQL 2>&1 || echo "0"
SELECT 
  (SELECT COUNT(*) FROM redmine_projects) as projects,
  (SELECT COUNT(*) FROM redmine_issues) as issues,
  (SELECT COUNT(*) FROM sync_runs WHERE status='success') as successful_syncs;
SQL
)

if [[ "${DATA_CHECK}" != "0" ]]; then
    echo "   📊 Data found:"
    echo "   ${DATA_CHECK}"
else
    echo "   ℹ️  No data yet. Run: bun run ingest:redmine:function"
fi

# Summary
echo ""
echo "================================"
echo "✅ Verification Complete"
echo "================================"
echo ""
echo "Next steps:"
echo "1. Load environment: source .env.local.runtime"
echo "2. Start frontend: docker compose up --build"
echo "3. Trigger ingest: bun run ingest:redmine:function"
echo "4. View dashboard: http://localhost:8080"
echo ""
