from pathlib import Path

import analytics_service.app as app_module
from fastapi.testclient import TestClient


def test_health_reports_missing_warehouse(monkeypatch) -> None:
    monkeypatch.setattr(app_module, "WAREHOUSE_PATH", Path("missing-test-warehouse.duckdb"))
    assert app_module.health() == {"ok": False, "warehouseReady": False}


def test_request_metrics_use_normalized_route(monkeypatch) -> None:
    monkeypatch.setenv("ANALYTICS_METRICS_DISABLED", "true")
    monkeypatch.setattr(app_module, "WAREHOUSE_PATH", Path("missing-test-warehouse.duckdb"))
    metric = app_module.REQUESTS.labels(method="GET", route="/v1/health", status="200")
    before = metric._value.get()

    with TestClient(app_module.app) as client:
        response = client.get("/v1/health")

    assert response.status_code == 200
    assert metric._value.get() == before + 1
