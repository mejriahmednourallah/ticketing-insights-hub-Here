from __future__ import annotations

import os
import math
import subprocess
import sys
from datetime import date, datetime, timedelta
from pathlib import Path

import duckdb
import pandas as pd
import pytest

import analytics_service.forecasting as forecasting
from analytics_service import forecast_ai


def create_warehouse(path: Path, months: int = 36, tickets_per_month: int = 5) -> None:
    with duckdb.connect(str(path)) as conn:
        conn.execute("create schema analytics")
        conn.execute(
            """
            create table analytics.fct_tickets (
              id integer,
              project_name varchar,
              team varchar,
              created_date timestamp,
              resolved_date timestamp
            )
            """
        )
        ticket_id = 1
        start = datetime(2023, 1, 1)
        for month_index in range(months):
            month = start.replace(
                year=start.year + (start.month - 1 + month_index) // 12,
                month=(start.month - 1 + month_index) % 12 + 1,
            )
            delay_days = 12 + (month_index % 12) * 2 + month_index * 0.15
            for offset in range(tickets_per_month):
                resolved = month + timedelta(days=5 + offset)
                created = resolved - timedelta(days=delay_days + offset)
                conn.execute(
                    "insert into analytics.fct_tickets values (?, ?, ?, ?, ?)",
                    [ticket_id, "Projet A", "RUN", created, resolved],
                )
                ticket_id += 1


def test_monthly_points_exclude_incomplete_current_month(tmp_path: Path) -> None:
    warehouse = tmp_path / "warehouse.duckdb"
    create_warehouse(warehouse)
    with duckdb.connect(str(warehouse)) as conn:
        conn.execute(
            "insert into analytics.fct_tickets values (?, ?, ?, ?, ?)",
            [9999, "Projet A", "RUN", datetime(2026, 1, 1), datetime(2026, 6, 10)],
        )
        history, current = forecasting.load_monthly_points(
            conn,
            "global",
            None,
            today=date(2026, 6, 15),
        )

    assert history[-1].period.date().isoformat() == "2025-12-01"
    assert current is not None
    assert current.period.date().isoformat() == "2026-06-01"
    assert current.resolved_tickets == 1


def test_monthly_points_ignore_out_of_bounds_dates(tmp_path: Path) -> None:
    warehouse = tmp_path / "warehouse.duckdb"
    create_warehouse(warehouse)
    with duckdb.connect(str(warehouse)) as conn:
        conn.execute(
            "insert into analytics.fct_tickets values (?, ?, ?, ?, ?)",
            [9998, "Projet A", "RUN", datetime(23, 8, 1), datetime(23, 9, 1)],
        )
        history, _ = forecasting.load_monthly_points(
            conn,
            "global",
            None,
            today=date(2026, 6, 15),
        )

    assert history[0].period.year >= 2000


def test_ticket_volume_points_exclude_incomplete_current_month(tmp_path: Path) -> None:
    warehouse = tmp_path / "warehouse.duckdb"
    create_warehouse(warehouse)
    with duckdb.connect(str(warehouse)) as conn:
        conn.execute(
            "insert into analytics.fct_tickets values (?, ?, ?, ?, ?)",
            [9999, "Projet A", "RUN", datetime(2026, 6, 10), None],
        )
        history, current = forecasting.load_ticket_volume_points(
            conn,
            "global",
            None,
            today=date(2026, 6, 15),
        )

    assert all(point.period.date() < date(2026, 6, 1) for point in history)
    assert current is not None
    assert current.period.date().isoformat() == "2026-06-01"
    assert current.ticket_count == 1


def test_ticket_volume_points_ignore_out_of_bounds_dates(tmp_path: Path) -> None:
    warehouse = tmp_path / "warehouse.duckdb"
    create_warehouse(warehouse)
    with duckdb.connect(str(warehouse)) as conn:
        conn.execute(
            "insert into analytics.fct_tickets values (?, ?, ?, ?, ?)",
            [9998, "Projet A", "RUN", datetime(23, 8, 1), datetime(23, 9, 1)],
        )
        history, _ = forecasting.load_ticket_volume_points(
            conn,
            "global",
            None,
            today=date(2026, 6, 15),
        )

    assert history[0].period.year >= 2000


def test_options_only_include_eligible_scopes(tmp_path: Path) -> None:
    warehouse = tmp_path / "warehouse.duckdb"
    create_warehouse(warehouse, months=41)
    with duckdb.connect(str(warehouse)) as conn:
        conn.execute(
            """
            insert into analytics.fct_tickets
            select 10000 + range, 'Petit projet', 'Petite équipe',
                   timestamp '2025-01-01', timestamp '2025-01-10'
            from range(10)
            """
        )
        options = forecasting.eligible_scopes(conn, today=date(2026, 6, 15))

    assert [item["value"] for item in options["projects"]] == ["Projet A"]
    assert [item["value"] for item in options["teams"]] == ["RUN"]
    assert options["minimumHistoryMonths"] == 24
    assert options["minimumResolvedTickets"] == 120
    assert options["minimumRecentMonths"] == 9
    assert options["minimumRecentTickets"] == 30


def test_ticket_volume_options_only_include_eligible_scopes(tmp_path: Path) -> None:
    warehouse = tmp_path / "warehouse.duckdb"
    create_warehouse(warehouse, months=41)
    with duckdb.connect(str(warehouse)) as conn:
        conn.execute(
            """
            insert into analytics.fct_tickets
            select 10000 + range, 'Petit projet', 'Petite équipe',
                   timestamp '2025-01-01', timestamp '2025-01-10'
            from range(10)
            """
        )
        options = forecasting.eligible_ticket_volume_scopes(conn, today=date(2026, 6, 15))

    assert [item["value"] for item in options["projects"]] == ["Projet A"]
    assert [item["value"] for item in options["teams"]] == ["RUN"]
    assert options["minimumHistoryMonths"] == 24
    assert options["minimumTickets"] == 120
    assert options["minimumRecentMonths"] == 9
    assert options["minimumRecentTickets"] == 30


def test_forecast_has_six_nonnegative_months_and_business_summary(tmp_path: Path) -> None:
    warehouse = tmp_path / "warehouse.duckdb"
    create_warehouse(warehouse, months=41)

    result = forecasting.build_forecast(
        warehouse,
        "project",
        "Projet A",
        today=date(2026, 6, 15),
    )

    assert len(result["forecast"]) == 6
    assert result["forecast"][0]["period"] == "2026-07-01"
    assert result["model"]["historyMonths"] == 41
    assert result["model"]["resolvedTickets"] == 205
    assert result["model"]["name"] in set(forecasting.CANDIDATE_MODELS)
    assert result["model"]["weightedMase"] >= 0
    assert "metricsByHorizon" in result["model"]
    assert "weightedWithin10Accuracy" in result["model"]
    assert result["model"]["targetRangePct"] == 10.0
    assert "qualityTargetMet" in result["summary"]
    assert result["summary"]["businessInsight"]
    assert result["aiInterpretation"]["source"] == "fallback"
    assert result["explanation"]["headline"]
    assert "trois derniers mois" in result["explanation"]["paragraphs"][0]
    assert result["explanation"]["evidence"]
    assert result["explanation"]["contributors"]
    assert result["explanation"]["contributors"][0]["dimension"] in {"team", "project"}
    assert result["explanation"]["confidenceNote"]
    assert all(point["predictedMedianDays"] >= 0 for point in result["forecast"])
    assert all(point["lowerBoundDays"] >= 0 for point in result["forecast"])
    assert all(
        point["upperBoundDays"] >= point["lowerBoundDays"]
        for point in result["forecast"]
    )
    first = result["forecast"][0]
    assert first["lowerBoundDays"] == pytest.approx(first["predictedMedianDays"] * 0.9, abs=0.2)
    assert first["upperBoundDays"] == pytest.approx(first["predictedMedianDays"] * 1.1, abs=0.2)


def test_ticket_volume_forecast_has_six_nonnegative_months(tmp_path: Path) -> None:
    warehouse = tmp_path / "warehouse.duckdb"
    create_warehouse(warehouse, months=41)

    result = forecasting.build_ticket_volume_forecast(
        warehouse,
        "team",
        "RUN",
        today=date(2026, 6, 15),
    )

    assert len(result["forecast"]) == 6
    assert result["forecast"][0]["period"] == "2026-07-01"
    assert result["model"]["tickets"] >= 120
    assert result["model"]["name"] in set(forecasting.CANDIDATE_MODELS)
    assert result["model"]["weightedMase"] >= 0
    assert "weightedWithin10Accuracy" in result["model"]
    assert result["model"]["targetRangePct"] == 10.0
    assert "qualityTargetMet" in result["summary"]
    assert result["summary"]["businessInsight"]
    assert result["aiInterpretation"]["source"] == "fallback"
    assert result["explanation"]["headline"]
    assert "trois derniers mois" in result["explanation"]["paragraphs"][0]
    assert result["explanation"]["evidence"]
    assert result["explanation"]["contributors"]
    assert result["explanation"]["contributors"][0]["dimension"] in {"team", "project"}
    assert result["explanation"]["confidenceNote"]
    assert all(point["predictedTickets"] >= 0 for point in result["forecast"])
    assert all(point["lowerBoundTickets"] >= 0 for point in result["forecast"])
    assert all(
        point["upperBoundTickets"] >= point["lowerBoundTickets"]
        for point in result["forecast"]
    )
    first = result["forecast"][0]
    assert first["lowerBoundTickets"] == pytest.approx(first["predictedTickets"] * 0.9, abs=1)
    assert first["upperBoundTickets"] == pytest.approx(first["predictedTickets"] * 1.1, abs=1)


def test_sparse_scope_returns_clear_error(tmp_path: Path) -> None:
    warehouse = tmp_path / "warehouse.duckdb"
    create_warehouse(warehouse, months=12, tickets_per_month=3)

    with pytest.raises(forecasting.ForecastUnavailableError, match="Historique insuffisant"):
        forecasting.build_forecast(
            warehouse,
            "global",
            None,
            today=date(2026, 6, 15),
        )


def test_sparse_ticket_volume_scope_returns_clear_error(tmp_path: Path) -> None:
    warehouse = tmp_path / "warehouse.duckdb"
    create_warehouse(warehouse, months=12, tickets_per_month=3)

    with pytest.raises(forecasting.ForecastUnavailableError, match="Historique insuffisant"):
        forecasting.build_ticket_volume_forecast(
            warehouse,
            "global",
            None,
            today=date(2026, 6, 15),
        )


def test_missing_months_are_interpolated_for_modeling(tmp_path: Path) -> None:
    warehouse = tmp_path / "warehouse.duckdb"
    create_warehouse(warehouse)
    with duckdb.connect(str(warehouse)) as conn:
        conn.execute(
            """
            delete from analytics.fct_tickets
            where date_trunc('month', resolved_date) in (
              date '2023-06-01', date '2024-03-01', date '2025-08-01'
            )
            """
        )

    result = forecasting.build_forecast(
        warehouse,
        "global",
        None,
        today=date(2026, 6, 15),
    )
    assert len(result["forecast"]) == 6


def test_cache_invalidates_when_warehouse_mtime_changes(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    warehouse = tmp_path / "warehouse.duckdb"
    create_warehouse(warehouse)
    forecasting.clear_forecast_cache()
    original = forecasting.select_model
    calls = 0

    def counted(series, *args, **kwargs):
        nonlocal calls
        calls += 1
        return original(series, *args, **kwargs)

    monkeypatch.setattr(forecasting, "select_model", counted)
    forecasting.build_forecast(warehouse, "global", None, today=date(2026, 6, 15))
    forecasting.build_forecast(warehouse, "global", None, today=date(2026, 6, 15))
    assert calls == 1

    current = warehouse.stat().st_mtime_ns
    os.utime(warehouse, ns=(current + 1_000_000, current + 1_000_000))
    forecasting.build_forecast(warehouse, "global", None, today=date(2026, 6, 15))
    assert calls == 2


def test_trend_series_promotes_interpretable_trend_model() -> None:
    series = pd.Series(
        [10 + index * 2 for index in range(48)],
        index=pd.date_range("2022-01-01", periods=48, freq="MS"),
        dtype=float,
    )

    selected = forecasting.select_model(series, "ticket_volume")

    assert selected.name in {"damped_holt", "theta", "lag_gradient_boosting", "robust_ensemble_top3"}
    assert selected.weighted_mase < 1


def test_seasonal_series_keeps_seasonal_baseline_when_best() -> None:
    series = pd.Series(
        [20 + (index % 12) * 3 for index in range(48)],
        index=pd.date_range("2022-01-01", periods=48, freq="MS"),
        dtype=float,
    )

    selected = forecasting.select_model(series, "ticket_volume")

    assert selected.name in {"seasonal_naive", "seasonal_median", "lag_gradient_boosting", "robust_ensemble_top3"}
    assert selected.weighted_mase == pytest.approx(0)


def test_model_selection_prefers_within10_accuracy() -> None:
    weak_classic = forecasting.CandidateResult(
        name="seasonal_naive",
        mae=1.0,
        residuals=[1.0],
        residuals_by_horizon={1: [1.0]},
        metrics_by_horizon={1: {"mae": 1.0, "wape": 0.05, "smape": 0.05, "mase": 0.1, "within10Accuracy": 0.5}},
        backtests_by_horizon={1: []},
        weighted_within10_accuracy=0.5,
        weighted_mase=0.1,
        weighted_mae=1.0,
    )
    stronger_business = forecasting.CandidateResult(
        name="theta",
        mae=2.0,
        residuals=[2.0],
        residuals_by_horizon={1: [2.0]},
        metrics_by_horizon={1: {"mae": 2.0, "wape": 0.1, "smape": 0.1, "mase": 0.2, "within10Accuracy": 0.9}},
        backtests_by_horizon={1: []},
        weighted_within10_accuracy=0.9,
        weighted_mase=0.2,
        weighted_mae=2.0,
    )

    selected = forecasting.promote_candidate([weak_classic, stronger_business])

    assert selected.name == "theta"
    assert selected.selection_reason == "beats_seasonal_naive_on_within10"


def test_resolution_delay_spike_is_winsorized_for_stable_forecast() -> None:
    values = [20 + (index % 12) for index in range(48)]
    values[-8] = 1500
    series = pd.Series(
        values,
        index=pd.date_range("2022-01-01", periods=48, freq="MS"),
        dtype=float,
    )
    selected = forecasting.select_model(series, "resolution_delay")
    training = forecasting._training_log_values(series.to_numpy(dtype=float), "resolution_delay")
    forecast = forecasting._forecast_values(selected.name, training, 6, "resolution_delay")
    predicted = [max(0, math.expm1(value)) for value in forecast]

    assert max(predicted) < 1000


def test_horizon_aware_intervals_are_nonnegative(tmp_path: Path) -> None:
    warehouse = tmp_path / "warehouse.duckdb"
    create_warehouse(warehouse, months=41)

    result = forecasting.build_ticket_volume_forecast(
        warehouse,
        "global",
        None,
        today=date(2026, 6, 15),
    )

    widths = [
        point["upperBoundTickets"] - point["lowerBoundTickets"]
        for point in result["forecast"]
    ]
    assert all(width >= 0 for width in widths)
    assert widths[-1] >= 0


def test_ai_interpretation_success_uses_provider(monkeypatch: pytest.MonkeyPatch) -> None:
    forecast_ai._cache.clear()
    response = {
        "scope": {"type": "global", "value": None},
        "summary": {"nextMonthTickets": 10, "qualityTargetMet": True},
        "model": {"trainingStart": "2024-01-01", "trainingEnd": "2025-12-01"},
        "forecast": [],
        "historical": [],
        "explanation": {"headline": "Fallback", "paragraphs": ["Fallback paragraph"], "contributors": []},
    }

    monkeypatch.setenv("FORECAST_AI_ENABLED", "true")
    monkeypatch.setenv("AI_PROVIDER_ORDER", "lovable")
    monkeypatch.setattr(
        forecast_ai,
        "_call_lovable",
        lambda context, timeout: '{"headline":"Signal en hausse","interpretation":"Le volume monte avec le rythme récent.","why":["Hausse récente"],"risks":["Historique limité"]}',
    )

    result = forecast_ai.build_ai_interpretation(response, "ticket_volume")

    assert result["available"] is True
    assert result["source"] == "lovable"
    assert result["headline"] == "Signal en hausse"
    assert result["why"] == ["Hausse récente"]


def test_ai_interpretation_invalid_json_falls_back(monkeypatch: pytest.MonkeyPatch) -> None:
    forecast_ai._cache.clear()
    response = {
        "scope": {"type": "global", "value": None},
        "summary": {"nextMonthTickets": 10},
        "model": {},
        "forecast": [],
        "historical": [],
        "explanation": {"headline": "Fallback", "paragraphs": ["Fallback paragraph"], "confidenceNote": "Fallback risk"},
    }

    monkeypatch.setenv("FORECAST_AI_ENABLED", "true")
    monkeypatch.setenv("AI_PROVIDER_ORDER", "lovable")
    monkeypatch.setattr(forecast_ai, "_call_lovable", lambda context, timeout: "not json")

    result = forecast_ai.build_ai_interpretation(response, "ticket_volume")

    assert result["available"] is False
    assert result["source"] == "fallback"
    assert result["headline"] == "Fallback"


def test_analysis_script_writes_json_csv_and_prometheus(tmp_path: Path) -> None:
    warehouse = tmp_path / "warehouse.duckdb"
    output_dir = tmp_path / "analysis"
    create_warehouse(warehouse, months=41)

    result = subprocess.run(
        [
            sys.executable,
            "scripts/analyze_forecast_models.py",
            "--warehouse",
            str(warehouse),
            "--target",
            "ticket_volume",
            "--max-projects",
            "0",
            "--max-teams",
            "0",
            "--output-dir",
            str(output_dir),
        ],
        check=True,
        cwd=Path(__file__).resolve().parents[2],
        text=True,
        capture_output=True,
    )

    assert "Forecast model analysis" in result.stdout
    assert (output_dir / "forecast-model-summary.json").is_file()
    assert (output_dir / "forecast-model-metrics.csv").is_file()
    assert (output_dir / "forecast-model-horizon-metrics.csv").is_file()
    assert (output_dir / "forecast-model-quality.prom").is_file()
