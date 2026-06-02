from __future__ import annotations

import sys
import os
from pathlib import Path

import duckdb


def main() -> int:
    if len(sys.argv) != 3:
        print("usage: run_duckdb_sql.py <warehouse.duckdb> <script.sql>", file=sys.stderr)
        return 2

    database_path = Path(sys.argv[1]).resolve()
    script_path = Path(sys.argv[2]).resolve()
    extension_path = Path(
        os.environ.get("DUCKDB_EXTENSION_DIR", r"C:\tmp\ticketing_warehouse_duckdb_extensions")
    ).resolve()

    if not script_path.exists():
        print(f"SQL script not found: {script_path}", file=sys.stderr)
        return 2

    sql = script_path.read_text(encoding="utf-8")

    with duckdb.connect(str(database_path)) as conn:
        extension_path.mkdir(parents=True, exist_ok=True)
        (extension_path / f"v{duckdb.__version__}" / "windows_amd64").mkdir(
            parents=True,
            exist_ok=True,
        )
        extension_sql_path = extension_path.as_posix().replace("'", "''")
        conn.execute(f"set extension_directory = '{extension_sql_path}'")
        for statement in sql.split(";"):
            statement = statement.strip()
            if not statement:
                continue

            results = conn.execute(statement)
            if not results.description:
                continue

            rows = results.fetchall()
            columns = [column[0] for column in results.description]
            print("\t".join(columns))
            for row in rows:
                print("\t".join("" if value is None else str(value) for value in row))

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
