#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

python scripts/run_duckdb_sql.py warehouse.duckdb scripts/bootstrap_duckdb.sql
python -m dbt.cli.main run --profiles-dir . --target duckdb
python -m dbt.cli.main test --profiles-dir . --target duckdb
python scripts/run_duckdb_sql.py warehouse.duckdb scripts/validate_duckdb.sql
