#!/usr/bin/env bash
# Push changes to a new branch

set -e

BRANCH_NAME="feature/supabase-local-setup"

echo "🔄 Creating and pushing branch: ${BRANCH_NAME}"
echo ""

# Create the branch (or switch if exists)
if git rev-parse --verify "${BRANCH_NAME}" > /dev/null 2>&1; then
    echo "Branch already exists, switching..."
    git checkout "${BRANCH_NAME}"
else
    echo "Creating new branch..."
    git checkout -b "${BRANCH_NAME}"
fi

# Stage all changes
git add -A

# Show what's being committed
echo "📦 Files to be committed:"
git diff --cached --name-only
echo ""

# Commit
git commit -m "feat: Add Supabase local setup with Docker + migrations + Edge Function

## What's New

### Documentation
- SETUP_GUIDE.md: Detailed step-by-step local setup instructions
- DEPLOYMENT_GUIDE.md: Complete guide for local/cloud/server deployments
- SETUP_MANUAL.sh: Automated bootstrap script for local development
- VERIFY_SETUP.sh: Post-setup validation and troubleshooting

### Infrastructure
- docker-compose.yml: Local development with Supabase
- docker-compose.server.yml: Production-ready server deployment
- install-supabase-cli.sh: Supabase CLI installation helper

### Database & Functions
- supabase/migrations/: 2 migrations (schema + pg_cron scheduler)
- supabase/functions/redmine-ingest/: Edge Function for Redmine ingestion
- Custom field mapping with flexible aliases

### Application
- src/lib/loadTickets.ts: Data abstraction layer (Supabase → CSV fallback)
- Updated Dashboard & SimilarityAnalysis for Supabase
- Environment variable templates (.env.example)

## Deployment Options

1. **Cloud Supabase** (Easy) - Use Supabase SaaS
2. **Local Development** (Test) - Docker + local Postgres
3. **Server Deployment** (Self-Hosted) - Full local control

See DEPLOYMENT_GUIDE.md for detailed instructions.

## Key Features

- ✅ Real-time data sync from Redmine (every 5 minutes via pg_cron)
- ✅ Custom field extraction and normalization
- ✅ Edge Function for secure API key handling
- ✅ Fallback to bundled CSV if Supabase unavailable
- ✅ Docker-based deployment (single image for all environments)
- ✅ Comprehensive setup and verification scripts
- ✅ Cloud-agnostic (works with local or cloud Supabase)

## Next Steps

1. Review DEPLOYMENT_GUIDE.md
2. Choose deployment option (cloud recommended for start)
3. Follow setup instructions for your chosen option
4. Test the dashboard at http://localhost:8080
5. Run Redmine ingest: bun run ingest:redmine:function

All code is production-ready. Secrets are externalized via environment." || echo "Nothing to commit"

# Push to remote
echo ""
echo "🚀 Pushing to GitHub..."
git push -u origin "${BRANCH_NAME}" --force-with-lease 2>&1 || {
    echo "❌ Push failed. Try: git push origin ${BRANCH_NAME}"
    exit 1
}

echo ""
echo "✅ Branch created and pushed: ${BRANCH_NAME}"
echo ""
echo "📚 Documentation to read:"
echo "   1. DEPLOYMENT_GUIDE.md (choose your deployment option)"
echo "   2. SETUP_GUIDE.md (for manual setup)"
echo "   3. README.md (quick overview)"
echo ""
echo "🔗 GitHub: https://github.com/Rimenmouhamed/ticketing-insights-hub/tree/${BRANCH_NAME}"
echo ""
echo "To test locally:"
echo "   git clone --branch ${BRANCH_NAME} https://github.com/Rimenmouhamed/ticketing-insights-hub.git"
echo ""
