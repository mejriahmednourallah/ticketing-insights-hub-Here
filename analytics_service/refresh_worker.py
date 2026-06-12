from __future__ import annotations

import os
import subprocess
import time
from pathlib import Path

import duckdb

from analytics_service.worker_metrics import instrument_refresh, start_worker_metrics_server

WAREHOUSE_DIR = Path(os.getenv("WAREHOUSE_DIR", "/warehouse"))
CURRENT = WAREHOUSE_DIR / "warehouse-current.duckdb"
TEMP = WAREHOUSE_DIR / "warehouse-building.duckdb"
PROJECT_DIR = Path(os.getenv("DBT_PROJECT_DIR", "/app/ticketing_warehouse"))
INTERVAL = int(os.getenv("WAREHOUSE_REFRESH_SECONDS", "300"))


def postgres_connection() -> str:
    host = os.getenv("DBT_SUPABASE_HOST", "host.docker.internal")
    port = os.getenv("DBT_SUPABASE_PORT", "54322")
    database = os.getenv("DBT_SUPABASE_DBNAME", "postgres")
    user = os.getenv("DBT_SUPABASE_USER", "postgres")
    password = os.getenv("DBT_SUPABASE_PASSWORD", "postgres")
    return f"host={host} port={port} dbname={database} user={user} password={password}"


def build_once() -> tuple[int, int]:
    WAREHOUSE_DIR.mkdir(parents=True, exist_ok=True)
    TEMP.unlink(missing_ok=True)
    Path(f"{TEMP}.wal").unlink(missing_ok=True)

    with duckdb.connect(str(TEMP)) as conn:
        conn.execute("install postgres")
        conn.execute("load postgres")
        conn.execute("create schema if not exists public")
        conn.execute(f"attach '{postgres_connection()}' as supabase_db (type postgres)")
        for table in ("redmine_projects", "redmine_issues", "sla_plan_config"):
            conn.execute(f"create table public.{table} as select * from supabase_db.public.{table}")

    env = os.environ.copy()
    env["DBT_DUCKDB_PATH"] = str(TEMP)
    subprocess.run(
        ["python", "-m", "dbt.cli.main", "run", "--profiles-dir", str(PROJECT_DIR), "--target", "duckdb"],
        cwd=PROJECT_DIR,
        env=env,
        check=True,
    )
    subprocess.run(
        ["python", "-m", "dbt.cli.main", "test", "--profiles-dir", str(PROJECT_DIR), "--target", "duckdb"],
        cwd=PROJECT_DIR,
        env=env,
        check=True,
    )

    with duckdb.connect(str(TEMP), read_only=True) as conn:
        raw_count = conn.execute("select count(*) from public.redmine_issues").fetchone()[0]
        fact_count = conn.execute("select count(*) from analytics.fct_tickets").fetchone()[0]
        failures = conn.execute(
            "select coalesce(sum(mapping_failure_count), 0) from analytics.v_mapping_quality"
        ).fetchone()[0]
        if raw_count != fact_count:
            raise RuntimeError(f"Warehouse row mismatch: raw={raw_count}, fact={fact_count}")
        if failures:
            raise RuntimeError(f"Warehouse has {failures} populated-source mapping failures")

    os.replace(TEMP, CURRENT)
    return fact_count, failures


def main() -> None:
    start_worker_metrics_server(int(os.getenv("WAREHOUSE_METRICS_PORT", "9101")))
    while True:
        started = time.time()
        try:
            instrument_refresh(build_once)
            print(f"[warehouse-refresh] published {CURRENT}", flush=True)
        except Exception as exc:
            print(f"[warehouse-refresh] failed: {exc}", flush=True)
        elapsed = time.time() - started
        time.sleep(max(5, INTERVAL - int(elapsed)))


if __name__ == "__main__":
    main()
