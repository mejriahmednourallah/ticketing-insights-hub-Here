#!/usr/bin/env bash
# Manual setup script for Ticketing Insights Hub local development
# Copy-paste each section or run this entire script

set -e  # Exit on error

echo "================================"
echo "Ticketing Insights Hub - Local Setup"
echo "================================"
echo ""

# Step 1: Check prerequisites
echo "📋 Step 1: Checking prerequisites..."
if ! command -v supabase &> /dev/null; then
    echo "❌ Supabase CLI not found. Install it:"
    echo "   npm install -g @supabase/cli"
    echo "   OR: brew install supabase/tap/supabase"
    exit 1
fi
echo "✅ Supabase CLI found: $(supabase --version)"

if ! command -v docker &> /dev/null; then
    echo "❌ Docker not found. Install Docker Desktop or Docker Engine."
    exit 1
fi
echo "✅ Docker found"

if ! command -v bun &> /dev/null; then
    echo "❌ Bun not found. Install from https://bun.sh"
    exit 1
fi
echo "✅ Bun found: $(bun --version)"

cd "$(dirname "${BASH_SOURCE[0]}")"
ROOT_DIR="$(pwd)"

# Step 2: Verify .env exists
echo ""
echo "📋 Step 2: Checking .env file..."
if [[ ! -f .env ]]; then
    echo "❌ .env file not found!"
    echo "   Copy .env.example to .env and fill in credentials:"
    echo "   cp .env.example .env"
    exit 1
fi
echo "✅ .env file exists"

# Source .env for use
set -a
source .env
set +a

if [[ -z "${REDMINE_API_KEY:-}" ]]; then
    echo "❌ REDMINE_API_KEY not set in .env"
    exit 1
fi
echo "✅ REDMINE_API_KEY configured"

# Step 3: Start Supabase locally
echo ""
echo "🚀 Step 3: Starting local Supabase stack..."
echo "   (This pulls Docker images and starts Postgres, Kong, Auth, Functions..."
echo "    First run may take 2-5 minutes)"
supabase start --no-verify-jwt-secret || {
    echo "❌ supabase start failed. Try:"
    echo "   docker system prune -a --volumes"
    echo "   supabase start"
    exit 1
}
echo "✅ Supabase started"

# Step 4: Extract local URLs and keys
echo ""
echo "📋 Step 4: Reading local Supabase credentials..."
STATUS_ENV="$(supabase status -o env)"
eval "${STATUS_ENV}"

if [[ -z "${API_URL:-}" || -z "${ANON_KEY:-}" || -z "${SERVICE_ROLE_KEY:-}" ]]; then
    echo "❌ Could not read Supabase keys from 'supabase status -o env'"
    echo "   Dumping status:"
    supabase status
    exit 1
fi
echo "✅ Credentials extracted:"
echo "   API_URL: ${API_URL}"
echo "   ANON_KEY: ${ANON_KEY:0:20}..."
echo "   SERVICE_ROLE_KEY: ${SERVICE_ROLE_KEY:0:20}..."

# Step 5: Generate .env.local.runtime
echo ""
echo "📋 Step 5: Generating .env.local.runtime..."
cat > .env.local.runtime <<RUNTIME_EOF
SUPABASE_URL=${API_URL}
SUPABASE_FUNCTIONS_URL=${API_URL}/functions/v1
SUPABASE_SERVICE_ROLE_KEY=${SERVICE_ROLE_KEY}
VITE_SUPABASE_URL=${API_URL}
VITE_SUPABASE_PUBLISHABLE_KEY=${ANON_KEY}
RUNTIME_EOF
echo "✅ Generated .env.local.runtime"

# Step 6: Apply database migrations
echo ""
echo "📋 Step 6: Applying database migrations..."
echo "   - Creating redmine_projects table"
echo "   - Creating redmine_issues table"
echo "   - Creating sync_state and sync_runs tables"
echo "   - Creating redmine_ticket_view"
echo "   - Setting up pg_cron scheduler"
supabase db push || {
    echo "❌ Database migration failed"
    echo "   Check supabase logs:"
    echo "   supabase logs --local"
    exit 1
}
echo "✅ Migrations applied"

# Step 7: Inject secrets for Edge Function
echo ""
echo "📋 Step 7: Injecting secrets for Edge Function..."
supabase secrets set \
  REDMINE_URL="${REDMINE_URL}" \
  REDMINE_API_KEY="${REDMINE_API_KEY}" \
  REDMINE_PAGE_SIZE="${REDMINE_PAGE_SIZE:-100}" \
  SUPABASE_URL="${API_URL}" \
  SUPABASE_SERVICE_ROLE_KEY="${SERVICE_ROLE_KEY}" \
  REDMINE_FIELD_TEAM="${REDMINE_FIELD_TEAM:-Equipe Affectée,Equipe Affectee,team}" \
  REDMINE_FIELD_TECHNOLOGY="${REDMINE_FIELD_TECHNOLOGY:-CMS / Framework,technology,technology_used}" \
  REDMINE_FIELD_TYPE="${REDMINE_FIELD_TYPE:-Type,type}" \
  REDMINE_FIELD_SATISFACTION="${REDMINE_FIELD_SATISFACTION:-Degré de satisfaction,csat_score,satisfaction}" \
  REDMINE_FIELD_SOURCE="${REDMINE_FIELD_SOURCE:-Source,source}" \
  REDMINE_FIELD_CANAL="${REDMINE_FIELD_CANAL:-Canal,channel,canal}" \
  REDMINE_FIELD_SEGMENT_CLIENT="${REDMINE_FIELD_SEGMENT_CLIENT:-Segment client,customer_segment,segment_client}" \
  REDMINE_FIELD_REGION="${REDMINE_FIELD_REGION:-Région,region}" \
  REDMINE_FIELD_REOPENED="${REDMINE_FIELD_REOPENED:-Réouvert,reouvert,reopened}" \
  REDMINE_FIELD_SLA_PLAN="${REDMINE_FIELD_SLA_PLAN:-SLA plan,sla_plan}" || {
    echo "❌ Secret injection failed"
    exit 1
}
echo "✅ Secrets injected"

# Step 8: Deploy Edge Function
echo ""
echo "📋 Step 8: Deploying redmine-ingest Edge Function..."
supabase functions deploy redmine-ingest --no-verify-jwt || {
    echo "❌ Function deployment failed"
    echo "   Check function logs:"
    echo "   supabase functions logs redmine-ingest --local"
    exit 1
}
echo "✅ Function deployed"

# Step 9: Summary and next steps
echo ""
echo "================================"
echo "✅ LOCAL SETUP COMPLETE!"
echo "================================"
echo ""
echo "Next steps:"
echo ""
echo "1️⃣  Load the local environment in your shell:"
echo "   source .env.local.runtime"
echo ""
echo "2️⃣  Start the frontend with Docker:"
echo "   docker compose up --build"
echo "   (The app will be at http://localhost:8080)"
echo ""
echo "3️⃣  In another terminal, trigger the first ingestion:"
echo "   source .env.local.runtime"
echo "   bun run ingest:redmine:function"
echo ""
echo "4️⃣  Monitor cron ingestions:"
echo "   supabase logs --local"
echo ""
echo "5️⃣  Check if data reached Supabase:"
echo "   supabase postgres connect --local"
echo "   SELECT COUNT(*) FROM redmine_projects;"
echo "   SELECT COUNT(*) FROM redmine_issues;"
echo ""
echo "📖 For more details, see: README.md"
echo ""
