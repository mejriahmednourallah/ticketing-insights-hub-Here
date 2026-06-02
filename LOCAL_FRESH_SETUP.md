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

- DuckDB is a local file, not a server.
- Supabase remains the operational source for the frontend.
- The frontend still reads Supabase through the existing loaders.
- DuckDB is the local analytical warehouse at `ticketing_warehouse/warehouse.duckdb`.
