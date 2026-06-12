from __future__ import annotations

import time
from collections.abc import Callable

from prometheus_client import Counter, Gauge, Histogram, REGISTRY, start_http_server


REFRESH_ATTEMPTS = Counter(
    "ticketing_warehouse_refresh_attempts_total",
    "Warehouse refresh attempts.",
    ("result",),
)
REFRESH_DURATION = Histogram(
    "ticketing_warehouse_refresh_duration_seconds",
    "Warehouse refresh duration.",
)
REFRESH_IN_PROGRESS = Gauge(
    "ticketing_warehouse_refresh_in_progress",
    "Whether a warehouse refresh is running.",
)
LAST_SUCCESS = Gauge(
    "ticketing_warehouse_last_success_timestamp_seconds",
    "Unix timestamp of the last successful publication.",
)
PUBLISHED_TICKETS = Gauge(
    "ticketing_warehouse_published_tickets",
    "Tickets in the last published warehouse.",
)
PUBLISHED_MAPPING_FAILURES = Gauge(
    "ticketing_warehouse_published_mapping_failures",
    "Mapping failures in the last published warehouse.",
)


def start_worker_metrics_server(port: int = 9101) -> None:
    start_http_server(port, registry=REGISTRY)


def instrument_refresh(
    refresh: Callable[[], tuple[int, int]],
    clock: Callable[[], float] = time.time,
) -> tuple[int, int]:
    started = clock()
    REFRESH_IN_PROGRESS.set(1)
    try:
        ticket_count, mapping_failures = refresh()
        REFRESH_ATTEMPTS.labels(result="success").inc()
        LAST_SUCCESS.set(clock())
        PUBLISHED_TICKETS.set(ticket_count)
        PUBLISHED_MAPPING_FAILURES.set(mapping_failures)
        return ticket_count, mapping_failures
    except Exception:
        REFRESH_ATTEMPTS.labels(result="failure").inc()
        raise
    finally:
        REFRESH_DURATION.observe(max(0, clock() - started))
        REFRESH_IN_PROGRESS.set(0)
