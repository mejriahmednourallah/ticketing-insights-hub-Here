from __future__ import annotations

import json
import threading
import time
from datetime import datetime
from pathlib import Path
from typing import Callable

import duckdb
from prometheus_client import (
    CollectorRegistry,
    Counter,
    Gauge,
    Histogram,
    REGISTRY,
    start_http_server,
)

MODEL_REPORT_MAX_AGE_SECONDS = 24 * 60 * 60


REQUESTS = Counter(
    "ticketing_api_requests_total",
    "Analytics API requests.",
    ("method", "route", "status"),
)
REQUEST_DURATION = Histogram(
    "ticketing_api_request_duration_seconds",
    "Analytics API request duration.",
    ("method", "route"),
)
REQUESTS_IN_PROGRESS = Gauge(
    "ticketing_api_requests_in_progress",
    "Analytics API requests currently being processed.",
    ("method",),
)
FORECAST_REQUESTS = Counter(
    "ticketing_forecast_requests_total",
    "Forecast requests.",
    ("forecast_type", "scope_type", "status"),
)
FORECAST_DURATION = Histogram(
    "ticketing_forecast_calculation_duration_seconds",
    "Forecast calculation duration.",
    ("forecast_type", "scope_type"),
)
FORECAST_MODEL_SELECTIONS = Counter(
    "ticketing_forecast_model_selections_total",
    "Selected forecast models.",
    ("forecast_type", "scope_type", "model"),
)
FORECAST_BACKTEST_MAE = Histogram(
    "ticketing_forecast_backtest_mae_days",
    "Backtest mean absolute error for forecasts.",
    ("forecast_type", "scope_type", "model"),
)


class WarehouseMetricsCollector:
    def __init__(
        self,
        warehouse_path: Path,
        cache_seconds: int = 60,
        clock: Callable[[], float] = time.time,
    ) -> None:
        self.warehouse_path = warehouse_path
        self.cache_seconds = cache_seconds
        self.clock = clock
        self._lock = threading.Lock()
        self._cached_at = 0.0
        self._values: dict[str, float] = {}

    def _read_values(self) -> dict[str, float]:
        if not self.warehouse_path.exists():
            return self._empty_values()

        stat = self.warehouse_path.stat()
        with duckdb.connect(str(self.warehouse_path), read_only=True) as conn:
            tickets, projects = conn.execute(
                "select count(*), count(distinct project_name) from analytics.fct_tickets"
            ).fetchone()
            failures, conflicts = conn.execute(
                """
                select
                  coalesce(sum(mapping_failure_count), 0),
                  coalesce(sum(conflict_count), 0)
                from analytics.v_mapping_quality
                """
            ).fetchone()
            format_issues = conn.execute(
                "select count(*) from analytics.v_mapping_format_issues"
            ).fetchone()[0]

        return {
            "ready": 1,
            "age": max(0, self.clock() - stat.st_mtime),
            "tickets": tickets,
            "projects": projects,
            "mapping_failures": failures,
            "mapping_conflicts": conflicts,
            "format_issues": format_issues,
        }

    @staticmethod
    def _empty_values() -> dict[str, float]:
        return {
            "ready": 0,
            "age": 0,
            "tickets": 0,
            "projects": 0,
            "mapping_failures": 0,
            "mapping_conflicts": 0,
            "format_issues": 0,
        }

    def values(self) -> dict[str, float]:
        now = self.clock()
        with self._lock:
            if self._values and now - self._cached_at < self.cache_seconds:
                values = dict(self._values)
                if values["ready"] and self.warehouse_path.exists():
                    values["age"] = max(0, now - self.warehouse_path.stat().st_mtime)
                return values
            try:
                self._values = self._read_values()
            except Exception:
                self._values = self._empty_values()
            self._cached_at = now
            return dict(self._values)

    def collect(self):
        values = self.values()
        metrics = [
            ("ticketing_warehouse_ready", "Warehouse readiness.", "ready"),
            ("ticketing_warehouse_age_seconds", "Age of the current warehouse.", "age"),
            ("ticketing_warehouse_tickets", "Tickets in the analytical fact.", "tickets"),
            ("ticketing_warehouse_projects", "Projects in the analytical fact.", "projects"),
            (
                "ticketing_mapping_failures",
                "Populated source values that mapped to empty.",
                "mapping_failures",
            ),
            ("ticketing_mapping_conflicts", "Conflicting populated candidates.", "mapping_conflicts"),
            ("ticketing_mapping_format_issues", "Invalid source formats.", "format_issues"),
        ]
        for name, description, key in metrics:
            gauge = Gauge(name, description, registry=None)
            gauge.set(values[key])
            yield from gauge.collect()


class ForecastQualityCollector:
    def __init__(
        self,
        summary_path: Path,
        cache_seconds: int = 60,
        clock: Callable[[], float] = time.time,
    ) -> None:
        self.summary_path = summary_path
        self.cache_seconds = cache_seconds
        self.clock = clock
        self._lock = threading.Lock()
        self._cached_at = 0.0
        self._report: dict | None = None

    def _read_report(self) -> dict | None:
        if not self.summary_path.exists():
            return None
        return json.loads(self.summary_path.read_text(encoding="utf-8"))

    def report(self) -> dict | None:
        now = self.clock()
        with self._lock:
            if now - self._cached_at < self.cache_seconds:
                return self._report
            try:
                self._report = self._read_report()
            except Exception:
                self._report = None
            self._cached_at = now
            return self._report

    @staticmethod
    def _generated_timestamp(report: dict | None) -> float | None:
        if not report:
            return None
        try:
            return datetime.fromisoformat(report["generatedAt"]).timestamp()
        except Exception:
            return None

    def collect(self):
        report = self.report()
        generated_timestamp = self._generated_timestamp(report)
        age = max(0.0, self.clock() - generated_timestamp) if generated_timestamp else 0.0

        ready = Gauge("ticketing_forecast_model_report_ready", "Forecast model-analysis report readiness.", registry=None)
        ready.set(1 if report else 0)
        yield from ready.collect()

        report_age = Gauge("ticketing_forecast_model_report_age_seconds", "Age of the latest forecast model-analysis report.", registry=None)
        report_age.set(age)
        yield from report_age.collect()

        stale = Gauge("ticketing_forecast_model_report_stale", "Whether the forecast model-analysis report is stale.", registry=None)
        stale.set(1 if report and age > MODEL_REPORT_MAX_AGE_SECONDS else 0)
        yield from stale.collect()

        if not report:
            return

        selected = Gauge(
            "ticketing_forecast_model_selected",
            "Selected promoted forecast model by target and scope.",
            ("forecast_type", "scope_type", "scope_value", "model", "reason"),
            registry=None,
        )
        selected_mae = Gauge(
            "ticketing_forecast_model_selected_h1_mae",
            "Selected model one-month-ahead MAE.",
            ("forecast_type", "scope_type", "scope_value", "model"),
            registry=None,
        )
        selected_wape = Gauge(
            "ticketing_forecast_model_selected_h1_wape_percent",
            "Selected model one-month-ahead WAPE percent.",
            ("forecast_type", "scope_type", "scope_value", "model"),
            registry=None,
        )
        selected_mase = Gauge(
            "ticketing_forecast_model_selected_weighted_mase",
            "Selected model weighted MASE across backtest horizons.",
            ("forecast_type", "scope_type", "scope_value", "model"),
            registry=None,
        )
        for row in report.get("bestByScope", []):
            label_values = (
                row.get("target", ""),
                row.get("scope_type", ""),
                row.get("scope_value", ""),
                row.get("model", ""),
            )
            selected.labels(*label_values, row.get("selection_reason", "")).set(1)
            if row.get("h1_mae") is not None:
                selected_mae.labels(*label_values).set(float(row["h1_mae"]))
            if row.get("h1_wape_pct") is not None:
                selected_wape.labels(*label_values).set(float(row["h1_wape_pct"]))
            if row.get("weighted_mase") is not None:
                selected_mase.labels(*label_values).set(float(row["weighted_mase"]))
        yield from selected.collect()
        yield from selected_mae.collect()
        yield from selected_wape.collect()
        yield from selected_mase.collect()

        wins = Gauge(
            "ticketing_forecast_model_wins",
            "Number of scopes where the model is selected in the latest analysis.",
            ("forecast_type", "model"),
            registry=None,
        )
        for row in report.get("scoreboard", []):
            wins.labels(row.get("target", ""), row.get("model", "")).set(float(row.get("scope_wins", 0)))
        yield from wins.collect()


_collector: WarehouseMetricsCollector | None = None
_forecast_quality_collector: ForecastQualityCollector | None = None


def start_api_metrics_server(
    warehouse_path: Path,
    forecast_summary_path: Path | None = None,
    port: int = 9102,
    registry: CollectorRegistry = REGISTRY,
) -> None:
    global _collector, _forecast_quality_collector
    _collector = WarehouseMetricsCollector(warehouse_path)
    registry.register(_collector)
    if forecast_summary_path is not None:
        _forecast_quality_collector = ForecastQualityCollector(forecast_summary_path)
        registry.register(_forecast_quality_collector)
    start_http_server(port, registry=registry)
