import os
import subprocess
import time
from pathlib import Path

import duckdb


def sql_string(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


warehouse_path = Path(os.environ.get("DUCKDB_WAREHOUSE_PATH", "/warehouse/warehouse-current.duckdb"))
catalog_path = Path(os.environ.get("DUCKDB_UI_CATALOG_PATH", "/tmp/duckdb-ui-catalog.duckdb"))
public_port = int(os.environ.get("DUCKDB_UI_PORT", "4213"))
internal_port = int(os.environ.get("DUCKDB_UI_INTERNAL_PORT", "4214"))

while not warehouse_path.exists():
    print(f"[duckdb-ui] waiting for {warehouse_path}", flush=True)
    time.sleep(5)

catalog_path.parent.mkdir(parents=True, exist_ok=True)

socat = subprocess.Popen(
    [
        "socat",
        f"TCP-LISTEN:{public_port},fork,reuseaddr,bind=0.0.0.0",
        f"TCP:127.0.0.1:{internal_port}",
    ],
)

con = duckdb.connect(str(catalog_path))
con.execute(f"SET ui_local_port = {internal_port}")
con.execute("INSTALL ui")
con.execute("LOAD ui")
con.execute(f"ATTACH {sql_string(str(warehouse_path))} (READ_ONLY) AS wh")

try:
    con.execute("USE wh.analytics")
except duckdb.Error:
    con.execute("USE wh")

con.execute("CALL start_ui_server()")
print(
    f"[duckdb-ui] listening on 0.0.0.0:{public_port} with {warehouse_path} attached as wh",
    flush=True,
)

try:
    while True:
        time.sleep(3600)
except KeyboardInterrupt:
    con.execute("CALL stop_ui_server()")
    socat.terminate()
