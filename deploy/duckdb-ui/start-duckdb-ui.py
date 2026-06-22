import os
import time
from pathlib import Path

import duckdb


def sql_string(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


warehouse_path = Path(os.environ.get("DUCKDB_WAREHOUSE_PATH", "/warehouse/warehouse-current.duckdb"))
catalog_path = Path(os.environ.get("DUCKDB_UI_CATALOG_PATH", "/tmp/duckdb-ui-catalog.duckdb"))
ui_port = int(os.environ.get("DUCKDB_UI_PORT", "14213"))

while not warehouse_path.exists():
    print(f"[duckdb-ui] waiting for {warehouse_path}", flush=True)
    time.sleep(5)

catalog_path.parent.mkdir(parents=True, exist_ok=True)

con = duckdb.connect(str(catalog_path))
con.execute(f"SET ui_local_port = {ui_port}")
con.execute("UPDATE EXTENSIONS")
con.execute("FORCE INSTALL ui")
con.execute("LOAD ui")
con.execute(f"ATTACH {sql_string(str(warehouse_path))} AS wh (READ_ONLY)")

try:
    con.execute("USE wh.analytics")
except duckdb.Error:
    con.execute("USE wh")

con.execute("CALL start_ui_server()")
print(
    f"[duckdb-ui] listening on 127.0.0.1:{ui_port} with {warehouse_path} attached as wh",
    flush=True,
)

try:
    while True:
        time.sleep(3600)
except KeyboardInterrupt:
    con.execute("CALL stop_ui_server()")
