from __future__ import annotations

import json
from pathlib import Path

from analytics_service.metrics import ForecastQualityCollector, WarehouseMetricsCollector


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


def test_forecast_quality_collector_reads_latest_summary(tmp_path: Path) -> None:
    summary = tmp_path / "forecast-model-summary.json"
    summary.write_text(
        json.dumps(
            {
                "generatedAt": "2026-06-16T00:00:00+00:00",
                "bestByScope": [
                    {
                        "target": "ticket_volume",
                        "scope_type": "global",
                        "scope_value": "",
                        "model": "damped_holt",
                        "selection_reason": "beats_seasonal_naive_by_5pct",
                        "h1_mae": 4.2,
                        "h1_wape_pct": 12.5,
                        "weighted_mase": 0.8,
                    }
                ],
                "scoreboard": [
                    {"target": "ticket_volume", "model": "damped_holt", "scope_wins": 1}
                ],
            }
        ),
        encoding="utf-8",
    )
    collector = ForecastQualityCollector(summary, clock=lambda: 1_781_654_400.0)
    names = {metric.name for metric in collector.collect()}

    assert "ticketing_forecast_model_report_ready" in names
    assert "ticketing_forecast_model_selected" in names
    assert "ticketing_forecast_model_selected_weighted_mase" in names
