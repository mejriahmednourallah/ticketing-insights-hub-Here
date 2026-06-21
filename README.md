# Ticketing Insights Hub

Real-time Redmine ticket analytics dashboard with AI-powered similarity analysis.

**Frontend:** React 18 + Vite + TypeScript  
**Backend:** Supabase PostgreSQL + Edge Functions  
**Ingestion:** Redmine API → Supabase (via p_cron scheduler)  
**Deployment:** Docker (local) or cloud

---

## 🚀 Quick Start

### Fully containerized deployment with a temporary Cloudflare URL

See [DEPLOYMENT_QUICK_TUNNEL.md](DEPLOYMENT_QUICK_TUNNEL.md) for the production
container stack, generated secrets, autohealing, monitoring, and local backups.

### Option 1: Cloud Supabase (Easy, Recommended)
```bash
# 1. Create Supabase project at https://app.supabase.com
# 2. Update .env with cloud credentials
# 3. Apply migrations via Supabase SQL Editor
# 4. Deploy function: supabase functions deploy redmine-ingest
# 5. Set secrets via Supabase dashboard
# 6. Run: docker compose up --build
```
See **DEPLOYMENT_GUIDE.md** → "Option 2: Cloud Supabase"

### Option 2: Local Development (Test Locally)
```bash
cd /workspaces/ticketing-insights-hub
chmod +x SETUP_MANUAL.sh
./SETUP_MANUAL.sh
```
See **SETUP_GUIDE.md** for step-by-step

### Option 3: Server Deployment (Self-Hosted)
```bash
docker-compose -f docker-compose.server.yml up -d
```
See **DEPLOYMENT_GUIDE.md** → "Option 3: Server Deployment"

---

## 📖 Documentation

| Document | Purpose |
|----------|---------|
| [PROJECT_TOP_LEVEL_OVERVIEW.md](PROJECT_TOP_LEVEL_OVERVIEW.md) | Top-level architecture and end-to-end system flow |
| [SETUP_GUIDE.md](SETUP_GUIDE.md) | Step-by-step local setup (manual) |
| [SETUP_MANUAL.sh](SETUP_MANUAL.sh) | Automated local bootstrap script |
| [DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md) | All deployment options (local/cloud/server) |
| [VERIFY_SETUP.sh](VERIFY_SETUP.sh) | Post-setup validation script |

---

## 🏗️ Architecture

The `redmine-ingest` edge function reads Redmine data and upserts it into Supabase. A cron job named `redmine_ingest_every_5m` triggers it every 5 minutes.

If you deploy the chat edge function, configure at least one AI secret. `LOVABLE_API_KEY` is used first by default; `GROQ_API_KEY` is the fallback. The default Groq fallback model is `llama-3.3-70b-versatile`, configurable through `GROQ_MODEL`.

## Forecast model analysis

Run a rolling-origin backtest of the forecasting models against the current DuckDB warehouse:

```bash
npm run forecast:analyze
```

The script evaluates resolution-delay and ticket-volume forecasts with multi-horizon time-series metrics for 1, 3, and 6 months ahead: MAE, RMSE, WAPE, sMAPE, MASE, bias, 80% interval coverage, and direction accuracy. F1 is not reported because these forecasts are regression/time-series problems, not classification.

Reports are written under `runtime/model-analysis/`:

- `forecast-model-summary.json`: ranked model scoreboard and winning model per scope.
- `forecast-model-metrics.csv`: one row per target, scope, and candidate model.
- `forecast-model-horizon-metrics.csv`: one row per target, scope, model, and horizon.
- `forecast-model-backtests.csv`: every rolling backtest prediction versus actual.
- `forecast-model-scopes.csv`: scopes included in the run.
- `forecast-model-quality.prom`: compact Prometheus text snapshot for model diagnostics.

Use `npm run forecast:analyze -- --all-scopes` for every eligible project/team, or pass `--warehouse /path/to/warehouse-current.duckdb` to analyze another warehouse file.

## Environment variables

- `REDMINE_URL`: Base URL of the Redmine instance.
- `REDMINE_API_KEY`: Redmine API key.
- `SUPABASE_URL`: Supabase project URL.
- `SUPABASE_SERVICE_ROLE_KEY`: Server-side Supabase key used by ingestion scripts and function triggers.
- `VITE_SUPABASE_URL`: Frontend Supabase URL.
- `VITE_SUPABASE_PUBLISHABLE_KEY`: Frontend Supabase anonymous key.
- `REDMINE_PAGE_SIZE`: Pagination size for Redmine API requests, default `100`.

Optional custom-field mappings can be configured with comma-separated aliases, for example `REDMINE_FIELD_TEAM`, `REDMINE_FIELD_TECHNOLOGY`, and `REDMINE_FIELD_SLA_PLAN`.

## Troubleshooting Local Supabase Reload Errors

If you get a message similar to "Supabase reload failed, check connection and permissions":

```bash
cd /workspaces/ticketing-insights-hub
bash scripts/repair-supabase-local.sh
```

Then retry full startup:

```bash
bash scripts/local-up.sh
```
