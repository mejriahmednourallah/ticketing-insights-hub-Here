from pathlib import Path

import fastapi.routing
import fastapi.dependencies.utils
import httpx
import pytest

import analytics_service.app as app_module
from analytics_service.tests.test_forecasting import create_warehouse


@pytest.fixture
def anyio_backend():
    return "asyncio"


@pytest.fixture(autouse=True)
def direct_sync_routes(monkeypatch: pytest.MonkeyPatch):
    async def direct(function, *args, **kwargs):
        return function(*args, **kwargs)

    monkeypatch.setattr(fastapi.routing, "run_in_threadpool", direct)
    monkeypatch.setattr(fastapi.dependencies.utils, "run_in_threadpool", direct)


async def request(method: str, path: str, **kwargs) -> httpx.Response:
    transport = httpx.ASGITransport(app=app_module.app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        return await client.request(method, path, **kwargs)


def test_health_reports_missing_warehouse(monkeypatch) -> None:
    monkeypatch.setattr(app_module, "WAREHOUSE_PATH", Path("missing-test-warehouse.duckdb"))
    assert app_module.health() == {"ok": False, "warehouseReady": False}


@pytest.mark.anyio
async def test_request_metrics_use_normalized_route(monkeypatch) -> None:
    monkeypatch.setenv("ANALYTICS_METRICS_DISABLED", "true")
    monkeypatch.setattr(app_module, "WAREHOUSE_PATH", Path("missing-test-warehouse.duckdb"))
    metric = app_module.REQUESTS.labels(method="GET", route="/v1/health", status="200")
    before = metric._value.get()

    response = await request("GET", "/v1/health")

    assert response.status_code == 200
    assert metric._value.get() == before + 1


@pytest.mark.anyio
async def test_prediction_endpoint_requires_authentication(monkeypatch, tmp_path: Path) -> None:
    warehouse = tmp_path / "warehouse.duckdb"
    create_warehouse(warehouse)
    monkeypatch.delenv("ANALYTICS_AUTH_DISABLED", raising=False)
    monkeypatch.delenv("SUPABASE_ANON_KEY", raising=False)
    monkeypatch.delenv("SUPABASE_JWT_SECRET", raising=False)
    monkeypatch.setenv("ANALYTICS_METRICS_DISABLED", "true")
    monkeypatch.setattr(app_module, "WAREHOUSE_PATH", warehouse)

    response = await request(
        "POST",
        "/v1/predictions/resolution-delay",
        json={"scope": {"type": "global"}, "horizonMonths": 6},
    )

    assert response.status_code == 401


@pytest.mark.anyio
async def test_prediction_endpoints_return_options_and_forecast(monkeypatch, tmp_path: Path) -> None:
    warehouse = tmp_path / "warehouse.duckdb"
    create_warehouse(warehouse, months=41)
    monkeypatch.setenv("ANALYTICS_AUTH_DISABLED", "true")
    monkeypatch.setenv("ANALYTICS_METRICS_DISABLED", "true")
    monkeypatch.setattr(app_module, "WAREHOUSE_PATH", warehouse)

    options = await request("GET", "/v1/predictions/resolution-delay/options")
    forecast = await request(
        "POST",
        "/v1/predictions/resolution-delay",
        json={"scope": {"type": "team", "value": "RUN"}, "horizonMonths": 6},
    )

    assert options.status_code == 200
    assert options.json()["teams"][0]["value"] == "RUN"
    assert forecast.status_code == 200
    assert len(forecast.json()["forecast"]) == 6


@pytest.mark.anyio
async def test_ticket_volume_prediction_endpoints_return_options_and_forecast(monkeypatch, tmp_path: Path) -> None:
    warehouse = tmp_path / "warehouse.duckdb"
    create_warehouse(warehouse, months=41)
    monkeypatch.setenv("ANALYTICS_AUTH_DISABLED", "true")
    monkeypatch.setenv("ANALYTICS_METRICS_DISABLED", "true")
    monkeypatch.setattr(app_module, "WAREHOUSE_PATH", warehouse)

    options = await request("GET", "/v1/predictions/ticket-volume/options")
    forecast = await request(
        "POST",
        "/v1/predictions/ticket-volume",
        json={"scope": {"type": "project", "value": "Projet A"}, "horizonMonths": 6},
    )

    assert options.status_code == 200
    assert options.json()["projects"][0]["value"] == "Projet A"
    assert forecast.status_code == 200
    body = forecast.json()
    assert len(body["forecast"]) == 6
    assert "predictedTickets" in body["forecast"][0]


@pytest.mark.anyio
async def test_prediction_endpoint_rejects_unknown_scope_value(monkeypatch, tmp_path: Path) -> None:
    warehouse = tmp_path / "warehouse.duckdb"
    create_warehouse(warehouse)
    monkeypatch.setenv("ANALYTICS_AUTH_DISABLED", "true")
    monkeypatch.setenv("ANALYTICS_METRICS_DISABLED", "true")
    monkeypatch.setattr(app_module, "WAREHOUSE_PATH", warehouse)

    response = await request(
        "POST",
        "/v1/predictions/resolution-delay",
        json={"scope": {"type": "project", "value": "Inconnu"}, "horizonMonths": 6},
    )

    assert response.status_code == 422
    assert "Historique insuffisant" in response.json()["detail"]
