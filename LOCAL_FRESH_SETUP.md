# Fresh Local Setup

Use this guide when running the project on a fresh Windows PC.

## 1. Install Prerequisites

Install and start:

- Docker Desktop
- Node.js and npm
- Python

Check they are available:

```powershell
node --version
npm --version
python --version
docker --version
```

## 2. Install Dependencies

From the repo root:

```powershell
npm install
python -m pip install --user duckdb dbt-duckdb
```

## 3. Create Local Environment File

Copy the example file:

```powershell
copy .env.example .env
```

Edit `.env` and fill at least:

```env
REDMINE_URL=...
REDMINE_API_KEY=...
REDMINE_PAGE_SIZE=500
REDMINE_PROJECT_BATCH_SIZE=20
```

## 4. Run Everything Locally

Run the full local startup:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/run-local-e2e.ps1
```

This script does the full flow:

1. Starts local Supabase.
2. Applies database migrations.
3. Generates local Supabase, frontend, and function env files.
4. Injects Redmine variables into the local function runtime.
5. Runs Redmine ingestion.
6. Starts the frontend Docker container.
7. Deletes and rebuilds `ticketing_warehouse/warehouse.duckdb` from scratch.
8. Runs dbt models against DuckDB.
9. Runs dbt tests.
10. Validates DuckDB output counts.

## 5. Open The App

After the script completes:

```text
Frontend:        http://127.0.0.1:8081
Supabase Studio: http://127.0.0.1:54323
Supabase API:    http://127.0.0.1:54321
DuckDB file:     ticketing_warehouse/warehouse.duckdb
```

## Refresh Options

Run the full flow again:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/run-local-e2e.ps1
```

Skip Redmine ingest but rebuild DuckDB from current Supabase data:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/run-local-e2e.ps1 -SkipIngest
```

Skip DuckDB refresh:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/run-local-e2e.ps1 -SkipDuckDB
```

Skip both Redmine ingest and DuckDB refresh:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/run-local-e2e.ps1 -SkipIngest -SkipDuckDB
```

## Manual DuckDB Commands

If you only want to rebuild the DuckDB warehouse:

```powershell
npm run warehouse:duckdb:bootstrap
npm run warehouse:duckdb:run
npm run warehouse:duckdb:test
npm run warehouse:duckdb:validate
```

## Notes

- Supabase remains the durable raw store.
- DuckDB is the analytical source served through the FastAPI service.
- The dashboard requests aggregates and paginated rows instead of downloading all tickets.

## Optional Monitoring

Start Prometheus, Grafana, PostgreSQL Exporter, cAdvisor, Node Exporter, and
Blackbox Exporter with the application:

```powershell
docker compose --profile monitoring up -d
```

When using the local web override:

```powershell
docker compose -f docker-compose.yml -f docker-compose.web-local.yml --profile monitoring up -d
```

| Service | Address |
|---|---|
| Grafana | `http://127.0.0.1:3000` |
| Prometheus | `http://127.0.0.1:9090` |

Set `GRAFANA_ADMIN_USER` and `GRAFANA_ADMIN_PASSWORD` in `.env`. Grafana
automatically loads the Prometheus datasource and the **Ticketing Insights
Operations** dashboard. Exporter and application metrics ports remain internal to
Docker.

Verify all Prometheus targets and Grafana provisioning:

```powershell
npm run monitoring:verify
```

On Docker Desktop, Node Exporter measures the Linux Docker virtual machine rather
than the Windows host. On a Linux production server it measures the Docker host.



CLEAN UP post pc reboot
 .\scripts\clean-duckdb.ps1 -DryRun

 npx supabase stop

 powershell -ExecutionPolicy Bypass -File scripts/run-local-e2e.ps1
