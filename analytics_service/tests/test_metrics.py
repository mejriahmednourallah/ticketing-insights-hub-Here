from __future__ import annotations

from pathlib import Path

from analytics_service.metrics import WarehouseMetricsCollector


def test_missing_warehouse_is_reported_not_ready() -> None:
    collector = WarehouseMetricsCollector(Path("missing-test-warehouse.duckdb"))
    values = collector.values()
    assert values["ready"] == 0
    assert values["tickets"] == 0
    assert {metric.name for metric in collector.collect()} >= {
        "ticketing_warehouse_ready",
        "ticketing_mapping_failures",
    }


def test_warehouse_values_are_cached(monkeypatch) -> None:
    now = [100.0]
    collector = WarehouseMetricsCollector(
        Path("unused-test-warehouse.duckdb"),
        cache_seconds=60,
        clock=lambda: now[0],
    )
    calls = {"count": 0}

    def read_values():
        calls["count"] += 1
        return {
            "ready": 0,
            "age": 0,
            "tickets": 10,
            "projects": 2,
            "mapping_failures": 0,
            "mapping_conflicts": 1,
            "format_issues": 0,
        }

    monkeypatch.setattr(collector, "_read_values", read_values)
    assert collector.values()["tickets"] == 10
    now[0] = 130.0
    assert collector.values()["tickets"] == 10
    assert calls["count"] == 1
    now[0] = 161.0
    collector.values()
    assert calls["count"] == 2
