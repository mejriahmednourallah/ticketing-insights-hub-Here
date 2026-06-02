# Local DuckDB Warehouse Setup

This project can run a local DuckDB + dbt warehouse beside the existing
Supabase/Postgres warehouse. Supabase remains the operational database. DuckDB
is a local analytical file for development, testing, and demos.

## Install

```bash
pip install duckdb dbt-duckdb
```

The local warehouse file is:

```text
ticketing_warehouse/warehouse.duckdb
```

## Architecture

```text
Redmine API
   |
Supabase Edge Function
   |
Supabase Postgres raw tables
   |
DuckDB local warehouse file: warehouse.duckdb
   |
dbt-duckdb transformations
   |
staging / marts / analytics outputs
```

The frontend still reads Supabase through `src/lib/loadDashboardKPIs.ts` and
`src/lib/loadTickets.ts`. The DuckDB warehouse is local and optional; the app
continues to work when DuckDB is not installed.

## Profile

The committed `profiles.yml` includes a `duckdb` target under the existing
`ticketing_warehouse` profile. The Postgres extension is installed and loaded
by `scripts/bootstrap_duckdb.sql`, while dbt reads the copied local DuckDB
tables. You can also copy
`profiles.duckdb.example.yml` into `~/.dbt/profiles.yml` if you prefer using a
global dbt profile.

## Run

Start local Supabase first so DuckDB can copy the raw tables from Postgres:

```bash
supabase start
```

Then run:

```bash
npm run warehouse:duckdb:bootstrap
npm run warehouse:duckdb:run
npm run warehouse:duckdb:test
npm run warehouse:duckdb:validate
```

Or from the warehouse folder:

```bash
cd ticketing_warehouse
python scripts/run_duckdb_sql.py warehouse.duckdb scripts/bootstrap_duckdb.sql
python -m dbt.cli.main run --profiles-dir . --target duckdb
python -m dbt.cli.main test --profiles-dir . --target duckdb
python scripts/run_duckdb_sql.py warehouse.duckdb scripts/validate_duckdb.sql
```

The bootstrap script assumes local Supabase defaults:

```text
host=127.0.0.1
port=54322
dbname=postgres
user=postgres
password=postgres
```

It copies these raw tables into DuckDB's `public` schema:

- `public.redmine_projects`
- `public.redmine_issues`
- `public.sla_plan_config`

dbt then builds:

- `staging.stg_projects`
- `staging.stg_issues`
- `marts.mart_daily_volume`
- `marts.mart_team_velocity`
- `marts.mart_sla_compliance`
- `marts.mart_age_bands`
- `marts.mart_similarity_features`
- `analytics.v_dashboard`
- `analytics.v_team_kpis`
- `analytics.v_backlog_health`
