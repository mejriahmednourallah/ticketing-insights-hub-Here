from __future__ import annotations

import threading
import time
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


_collector: WarehouseMetricsCollector | None = None


def start_api_metrics_server(
    warehouse_path: Path,
    port: int = 9102,
    registry: CollectorRegistry = REGISTRY,
) -> None:
    global _collector
    _collector = WarehouseMetricsCollector(warehouse_path)
    registry.register(_collector)
    start_http_server(port, registry=registry)
