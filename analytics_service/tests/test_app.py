from pathlib import Path
from datetime import datetime

import duckdb
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


def create_dashboard_warehouse(path: Path) -> None:
    with duckdb.connect(str(path)) as conn:
        conn.execute("create schema analytics")
        conn.execute(
            """
            create table analytics.fct_tickets (
              id integer,
              project_name varchar,
              priority varchar,
              subject varchar,
              description varchar,
              team varchar,
              source varchar,
              status varchar,
              type varchar,
              satisfaction varchar,
              author varchar,
              assignee varchar,
              has_attachment boolean,
              created_month integer,
              created_date timestamp,
              created_year integer,
              technology varchar,
              segment_client varchar,
              tracker varchar,
              closed_date timestamp,
              resolved_date timestamp,
              age_hours double
            )
            """
        )
        rows = [
            (
                1,
                "Projet A",
                "Normale",
                "Ticket valide",
                "erreur paiement mobile panier commande",
                "RUN",
                "Client",
                "Clos",
                "Technique",
                "",
                "Alice",
                "Bob",
                False,
                1,
                datetime(2026, 1, 1),
                2026,
                "Drupal",
                "Client A",
                "Bug",
                datetime(2026, 1, 6),
                datetime(2026, 1, 11),
                240.0,
            ),
            (
                2,
                "Projet B",
                "Normale",
                "Resolved invalide",
                "demande contenu page actualite",
                "RUN",
                "Client",
                "Clos",
                "Technique",
                "",
                "Alice",
                "Bob",
                False,
                1,
                datetime(2026, 1, 1),
                2026,
                "Drupal",
                "Client B",
                "Bug",
                datetime(2026, 1, 3),
                datetime(23, 9, 1),
                240.0,
            ),
            (
                3,
                "Projet A",
                "Normale",
                "Closed invalide",
                "erreur paiement mobile panier commande bloque",
                "RUN",
                "Client",
                "Clos",
                "Technique",
                "",
                "Alice",
                "Bob",
                False,
                1,
                datetime(2026, 1, 10),
                2026,
                "Drupal",
                "Client A",
                "Bug",
                datetime(2025, 1, 1),
                datetime(2026, 1, 15),
                120.0,
            ),
        ]
        conn.executemany(
            "insert into analytics.fct_tickets values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            rows,
        )


@pytest.mark.anyio
async def test_dashboard_ignores_invalid_date_durations(monkeypatch, tmp_path: Path) -> None:
    warehouse = tmp_path / "warehouse.duckdb"
    create_dashboard_warehouse(warehouse)
    monkeypatch.setenv("ANALYTICS_AUTH_DISABLED", "true")
    monkeypatch.setenv("ANALYTICS_METRICS_DISABLED", "true")
    monkeypatch.setattr(app_module, "WAREHOUSE_PATH", warehouse)

    response = await request("POST", "/v1/dashboard/query", json={"filters": {}})

    assert response.status_code == 200
    kpis = response.json()["kpis"]
    assert kpis["avgResolvedDays"] == 7.5
    assert kpis["globalAvgResolvedDays"] == 7.5
    assert kpis["avgClosedDays"] == 3.5
    assert kpis["globalAvgClosedDays"] == 3.5
    assert all(point["value"] is None or point["value"] >= 0 for point in response.json()["charts"]["avgResolvedByYear"])
    assert all(point["value"] is None or point["value"] >= 0 for point in response.json()["charts"]["avgClosedByYear"])


@pytest.mark.anyio
async def test_similarity_returns_similarity_reasons(monkeypatch, tmp_path: Path) -> None:
    warehouse = tmp_path / "warehouse.duckdb"
    create_dashboard_warehouse(warehouse)
    monkeypatch.setenv("ANALYTICS_AUTH_DISABLED", "true")
    monkeypatch.setenv("ANALYTICS_METRICS_DISABLED", "true")
    monkeypatch.setattr(app_module, "WAREHOUSE_PATH", warehouse)

    response = await request("POST", "/v1/similarity/1", json={"filters": {}, "topN": 2})

    assert response.status_code == 200
    result = response.json()["results"][0]
    assert result["idB"] == "3"
    assert result["textSimilarity"] > 0
    assert any(item.startswith("Sujet:") for item in result["similarities"])
    assert "Client: même client - Projet A" in result["similarities"]
    assert "CMS: même CMS - Drupal" in result["similarities"]
    assert result["differences"] == []
    second = response.json()["results"][1]
    assert "CMS: même CMS - Drupal" in second["similarities"]
    assert not any(item.startswith("Client:") for item in second["similarities"])


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
