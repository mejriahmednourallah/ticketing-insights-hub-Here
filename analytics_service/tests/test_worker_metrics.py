from __future__ import annotations

import pytest

from analytics_service.worker_metrics import (
    PUBLISHED_MAPPING_FAILURES,
    PUBLISHED_TICKETS,
    REFRESH_ATTEMPTS,
    REFRESH_IN_PROGRESS,
    instrument_refresh,
)


def sample_value(metric, labels: dict[str, str] | None = None) -> float:
    value = metric._value.get() if labels is None else metric.labels(**labels)._value.get()
    assert isinstance(value, float)
    return value


def test_successful_refresh_updates_metrics() -> None:
    before = sample_value(REFRESH_ATTEMPTS, {"result": "success"})
    result = instrument_refresh(lambda: (125, 0), clock=iter([10.0, 12.0, 13.0]).__next__)
    assert result == (125, 0)
    assert sample_value(REFRESH_ATTEMPTS, {"result": "success"}) == before + 1
    assert sample_value(PUBLISHED_TICKETS) == 125
    assert sample_value(PUBLISHED_MAPPING_FAILURES) == 0
    assert sample_value(REFRESH_IN_PROGRESS) == 0


def test_failed_refresh_resets_in_progress() -> None:
    before = sample_value(REFRESH_ATTEMPTS, {"result": "failure"})

    def fail() -> tuple[int, int]:
        raise RuntimeError("refresh failed")

    with pytest.raises(RuntimeError):
        instrument_refresh(fail, clock=iter([20.0, 21.0]).__next__)
    assert sample_value(REFRESH_ATTEMPTS, {"result": "failure"}) == before + 1
    assert sample_value(REFRESH_IN_PROGRESS) == 0
