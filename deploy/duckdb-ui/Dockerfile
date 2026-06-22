FROM python:3.12-slim

WORKDIR /app

RUN pip install --no-cache-dir duckdb==1.5.3

COPY deploy/duckdb-ui/start-duckdb-ui.py /app/start-duckdb-ui.py

ENV DUCKDB_WAREHOUSE_PATH=/warehouse/warehouse-current.duckdb
ENV DUCKDB_UI_CATALOG_PATH=/tmp/duckdb-ui-catalog.duckdb
ENV DUCKDB_UI_PORT=14213

CMD ["python", "/app/start-duckdb-ui.py"]
