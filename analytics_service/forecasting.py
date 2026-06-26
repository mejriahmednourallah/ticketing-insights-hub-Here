from __future__ import annotations

import math
import threading
import warnings
from dataclasses import dataclass, replace
from datetime import date, datetime
from pathlib import Path
from typing import Any, Literal

import duckdb


MIN_HISTORY_MONTHS = 24
MIN_RESOLVED_TICKETS = 120
MIN_RECENT_MONTHS = 9
MIN_RECENT_OBSERVATIONS = 30
DEFAULT_HORIZON_MONTHS = 6
BACKTEST_MONTHS = 12
BACKTEST_HORIZONS = (1, 2, 3, 4, 5, 6)
HORIZON_WEIGHTS = {1: 0.3, 2: 0.2, 3: 0.2, 4: 0.1, 5: 0.1, 6: 0.1}
PROMOTION_MASE_IMPROVEMENT = 0.05
MIN_FORECAST_DATE = datetime(2000, 1, 1)
TARGET_RANGE_PCT = 10.0
TARGET_WITHIN10_ACCURACY = 0.85

ScopeType = Literal["global", "project", "team"]
ForecastTarget = Literal["resolution_delay", "ticket_volume"]
ModelName = Literal[
    "seasonal_naive",
    "damped_holt",
    "holt_winters",
    "recent_median",
    "seasonal_median",
    "seasonal_naive_drift",
    "theta",
    "lag_gradient_boosting",
    "robust_ensemble_top3",
]

CANDIDATE_MODELS: tuple[ModelName, ...] = (
    "seasonal_naive",
    "damped_holt",
    "holt_winters",
    "recent_median",
    "seasonal_median",
    "seasonal_naive_drift",
    "theta",
    "lag_gradient_boosting",
    "robust_ensemble_top3",
)
ENSEMBLE_BASE_MODELS: tuple[ModelName, ...] = tuple(
    model for model in CANDIDATE_MODELS if model not in {"lag_gradient_boosting", "robust_ensemble_top3"}
)


class ForecastUnavailableError(ValueError):
    pass


@dataclass(frozen=True)
class MonthlyPoint:
    period: datetime
    median_days: float
    resolved_tickets: int


@dataclass(frozen=True)
class TicketVolumePoint:
    period: datetime
    ticket_count: int


@dataclass(frozen=True)
class CandidateResult:
    name: ModelName
    mae: float
    residuals: list[float]
    residuals_by_horizon: dict[int, list[float]]
    metrics_by_horizon: dict[int, dict[str, Any]]
    backtests_by_horizon: dict[int, list[dict[str, Any]]]
    weighted_within10_accuracy: float
    weighted_mase: float
    weighted_mae: float
    baseline_weighted_mase: float | None = None
    promoted: bool = True
    selection_reason: str = "best_weighted_mase"


_cache_lock = threading.Lock()
_forecast_cache: dict[tuple[Any, ...], dict[str, Any]] = {}


def clear_forecast_cache() -> None:
    with _cache_lock:
        _forecast_cache.clear()


def _month_start(value: date | datetime) -> datetime:
    return datetime(value.year, value.month, 1)


def _next_month(value: datetime) -> datetime:
    return _add_months(value, 1)


def _add_months(value: datetime, months: int) -> datetime:
    month_index = value.month - 1 + months
    return datetime(value.year + month_index // 12, month_index % 12 + 1, 1)


def _month_distance(start: datetime, end: datetime) -> int:
    return (end.year - start.year) * 12 + end.month - start.month


def _scope_clause(scope_type: ScopeType, scope_value: str | None) -> tuple[str, list[Any]]:
    if scope_type == "global":
        if scope_value:
            raise ForecastUnavailableError("La portée globale ne doit pas préciser de valeur.")
        return "", []
    if not scope_value:
        raise ForecastUnavailableError("Sélectionnez un projet ou une équipe.")
    if scope_type == "project":
        return " and project_name = ?", [scope_value]
    if scope_type == "team":
        return " and coalesce(nullif(team, ''), 'Non renseigné') = ?", [scope_value]
    raise ForecastUnavailableError("Portée de prévision invalide.")


def load_monthly_points(
    conn: duckdb.DuckDBPyConnection,
    scope_type: ScopeType,
    scope_value: str | None,
    today: date | None = None,
) -> tuple[list[MonthlyPoint], MonthlyPoint | None]:
    current_month = _month_start(today or date.today())
    clause, params = _scope_clause(scope_type, scope_value)
    records = conn.execute(
        f"""
        select
          date_trunc('month', resolved_date) as period,
          median(date_diff('second', created_date, resolved_date) / 86400.0) as median_days,
          count(*)::integer as resolved_tickets
        from analytics.fct_tickets
        where created_date is not null
          and resolved_date is not null
          and created_date >= ?
          and resolved_date >= ?
          and resolved_date >= created_date
          and resolved_date < ?
          {clause}
        group by 1
        order by 1
        """,
        [MIN_FORECAST_DATE, MIN_FORECAST_DATE, current_month, *params],
    ).fetchall()
    history = [
        MonthlyPoint(_month_start(period), max(0.0, float(median_days)), int(count))
        for period, median_days, count in records
    ]

    current_record = conn.execute(
        f"""
        select
          median(date_diff('second', created_date, resolved_date) / 86400.0) as median_days,
          count(*)::integer as resolved_tickets
        from analytics.fct_tickets
        where created_date is not null
          and resolved_date is not null
          and created_date >= ?
          and resolved_date >= ?
          and resolved_date >= created_date
          and resolved_date >= ?
          and resolved_date < ?
          {clause}
        """,
        [
            MIN_FORECAST_DATE,
            MIN_FORECAST_DATE,
            current_month,
            _next_month(current_month),
            *params,
        ],
    ).fetchone()
    current = None
    if current_record and current_record[1]:
        current = MonthlyPoint(
            current_month,
            max(0.0, float(current_record[0])),
            int(current_record[1]),
        )
    return history, current


def load_ticket_volume_points(
    conn: duckdb.DuckDBPyConnection,
    scope_type: ScopeType,
    scope_value: str | None,
    today: date | None = None,
) -> tuple[list[TicketVolumePoint], TicketVolumePoint | None]:
    current_month = _month_start(today or date.today())
    clause, params = _scope_clause(scope_type, scope_value)
    records = conn.execute(
        f"""
        select
          date_trunc('month', created_date) as period,
          count(*)::integer as ticket_count
        from analytics.fct_tickets
        where created_date is not null
          and created_date >= ?
          and created_date < ?
          {clause}
        group by 1
        order by 1
        """,
        [MIN_FORECAST_DATE, current_month, *params],
    ).fetchall()
    history = [
        TicketVolumePoint(_month_start(period), max(0, int(ticket_count)))
        for period, ticket_count in records
    ]

    current_record = conn.execute(
        f"""
        select count(*)::integer as ticket_count
        from analytics.fct_tickets
        where created_date is not null
          and created_date >= ?
          and created_date >= ?
          and created_date < ?
          {clause}
        """,
        [
            MIN_FORECAST_DATE,
            current_month,
            _next_month(current_month),
            *params,
        ],
    ).fetchone()
    current = None
    if current_record and current_record[0]:
        current = TicketVolumePoint(current_month, int(current_record[0]))
    return history, current


def eligible_scopes(conn: duckdb.DuckDBPyConnection, today: date | None = None) -> dict[str, Any]:
    current_month = _month_start(today or date.today())
    recent_start = _add_months(current_month, -12)

    def eligible(column: str, alias: str) -> list[dict[str, Any]]:
        records = conn.execute(
            f"""
            select
              {column} as value,
              count(distinct date_trunc('month', resolved_date))::integer as history_months,
              count(*)::integer as resolved_tickets,
              count(distinct case when resolved_date >= ? then date_trunc('month', resolved_date) end)::integer as recent_months,
              sum(case when resolved_date >= ? then 1 else 0 end)::integer as recent_resolved_tickets
            from analytics.fct_tickets
            where created_date is not null
              and resolved_date is not null
              and created_date >= ?
              and resolved_date >= ?
              and resolved_date >= created_date
              and resolved_date < ?
            group by 1
            having history_months >= ?
               and resolved_tickets >= ?
               and recent_months >= ?
               and recent_resolved_tickets >= ?
            order by value
            """,
            [
                recent_start,
                recent_start,
                MIN_FORECAST_DATE,
                MIN_FORECAST_DATE,
                current_month,
                MIN_HISTORY_MONTHS,
                MIN_RESOLVED_TICKETS,
                MIN_RECENT_MONTHS,
                MIN_RECENT_OBSERVATIONS,
            ],
        ).fetchall()
        return [
            {
                "value": value,
                "historyMonths": months,
                "resolvedTickets": tickets,
                "recentMonths": recent_months,
                "recentResolvedTickets": recent_tickets,
                "type": alias,
            }
            for value, months, tickets, recent_months, recent_tickets in records
            if value
        ]

    return {
        "projects": eligible("project_name", "project"),
        "teams": eligible("coalesce(nullif(team, ''), 'Non renseigné')", "team"),
        "minimumHistoryMonths": MIN_HISTORY_MONTHS,
        "minimumResolvedTickets": MIN_RESOLVED_TICKETS,
        "minimumRecentMonths": MIN_RECENT_MONTHS,
        "minimumRecentTickets": MIN_RECENT_OBSERVATIONS,
        "horizonMonths": DEFAULT_HORIZON_MONTHS,
    }


def eligible_ticket_volume_scopes(conn: duckdb.DuckDBPyConnection, today: date | None = None) -> dict[str, Any]:
    current_month = _month_start(today or date.today())
    recent_start = _add_months(current_month, -12)

    def eligible(column: str, alias: str) -> list[dict[str, Any]]:
        records = conn.execute(
            f"""
            select
              {column} as value,
              count(distinct date_trunc('month', created_date))::integer as history_months,
              count(*)::integer as tickets,
              count(distinct case when created_date >= ? then date_trunc('month', created_date) end)::integer as recent_months,
              sum(case when created_date >= ? then 1 else 0 end)::integer as recent_tickets
            from analytics.fct_tickets
            where created_date is not null
              and created_date >= ?
              and created_date < ?
            group by 1
            having history_months >= ?
               and tickets >= ?
               and recent_months >= ?
               and recent_tickets >= ?
            order by value
            """,
            [
                recent_start,
                recent_start,
                MIN_FORECAST_DATE,
                current_month,
                MIN_HISTORY_MONTHS,
                MIN_RESOLVED_TICKETS,
                MIN_RECENT_MONTHS,
                MIN_RECENT_OBSERVATIONS,
            ],
        ).fetchall()
        return [
            {
                "value": value,
                "historyMonths": months,
                "tickets": tickets,
                "recentMonths": recent_months,
                "recentTickets": recent_tickets,
                "type": alias,
            }
            for value, months, tickets, recent_months, recent_tickets in records
            if value
        ]

    return {
        "projects": eligible("project_name", "project"),
        "teams": eligible("coalesce(nullif(team, ''), 'Non renseigné')", "team"),
        "minimumHistoryMonths": MIN_HISTORY_MONTHS,
        "minimumTickets": MIN_RESOLVED_TICKETS,
        "minimumRecentMonths": MIN_RECENT_MONTHS,
        "minimumRecentTickets": MIN_RECENT_OBSERVATIONS,
        "horizonMonths": DEFAULT_HORIZON_MONTHS,
    }


def _regular_series(points: list[MonthlyPoint]):
    import pandas as pd

    if not points:
        return pd.Series(dtype=float)
    observed = pd.Series(
        [point.median_days for point in points],
        index=pd.DatetimeIndex([point.period for point in points]),
        dtype=float,
    )
    full_index = pd.date_range(observed.index.min(), observed.index.max(), freq="MS")
    return observed.reindex(full_index).interpolate(method="linear").bfill().ffill()


def _regular_ticket_series(points: list[TicketVolumePoint]):
    import pandas as pd

    if not points:
        return pd.Series(dtype=float)
    observed = pd.Series(
        [point.ticket_count for point in points],
        index=pd.DatetimeIndex([point.period for point in points]),
        dtype=float,
    )
    full_index = pd.date_range(observed.index.min(), observed.index.max(), freq="MS")
    return observed.reindex(full_index).fillna(0.0)


def _winsorize_log_values(values):
    import numpy as np

    if len(values) < 12:
        return values
    lower, upper = np.quantile(values, [0.05, 0.95])
    if not np.isfinite(lower) or not np.isfinite(upper) or lower >= upper:
        return values
    return np.clip(values, lower, upper)


def _training_log_values(raw_values, target: ForecastTarget):
    import numpy as np

    values = np.log1p(np.maximum(np.asarray(raw_values, dtype=float), 0.0))
    if target == "resolution_delay":
        return _winsorize_log_values(values)
    return values


def _forecast_values(
    name: ModelName,
    training,
    horizon: int,
    target: ForecastTarget = "resolution_delay",
):
    import numpy as np

    training = np.asarray(training, dtype=float)
    if len(training) == 0:
        raise ValueError("Model requires training data")

    if name == "recent_median":
        window = training[-min(6, len(training)) :]
        return np.repeat(float(np.median(window)), horizon)

    if name == "seasonal_naive":
        if len(training) < 12:
            raise ValueError("Seasonal naïve requires 12 months")
        return np.asarray([training[len(training) - 12 + (index % 12)] for index in range(horizon)])

    if name == "seasonal_median":
        if len(training) < 24:
            raise ValueError("Seasonal median requires 24 months")
        output = []
        for index in range(horizon):
            seasonal_index = len(training) - 12 + (index % 12)
            candidates = []
            while seasonal_index >= 0:
                candidates.append(training[seasonal_index])
                seasonal_index -= 12
            if not candidates:
                raise ValueError("Seasonal median has no seasonal candidates")
            output.append(float(np.median(candidates)))
        return np.asarray(output, dtype=float)

    if name == "seasonal_naive_drift":
        if len(training) < 24:
            raise ValueError("Seasonal naïve drift requires 24 months")
        annual_delta = float(np.mean(training[-12:] - training[-24:-12]))
        return np.asarray(
            [
                training[len(training) - 12 + (index % 12)] + annual_delta * (1 + index // 12)
                for index in range(horizon)
            ],
            dtype=float,
        )

    if name == "damped_holt":
        return _fast_damped_holt(training, horizon)

    if name == "holt_winters":
        if len(training) < 24:
            raise ValueError("Holt-Winters requires 24 months")
        return _fast_additive_holt_winters(training, horizon)

    if name == "theta":
        return _fast_theta(training, horizon)

    if name == "lag_gradient_boosting":
        return _lag_gradient_boosting(training, horizon)

    if name == "robust_ensemble_top3":
        selected_models = _top_ensemble_models(training, target)
        forecasts = []
        for model_name in selected_models:
            try:
                forecasts.append(_forecast_values(model_name, training, horizon, target))
            except (ValueError, RuntimeError, OverflowError, np.linalg.LinAlgError):
                continue
        if not forecasts:
            raise ValueError("Robust ensemble has no valid base forecasts")
        return np.median(np.vstack(forecasts), axis=0)

    raise ValueError(f"Unknown model: {name}")


def _fast_damped_holt(training, horizon: int):
    import numpy as np

    if len(training) < 3:
        raise ValueError("Damped Holt requires at least 3 months")
    alpha = 0.7
    beta = 0.2
    phi = 0.85
    level = float(training[0])
    trend = float(training[1] - training[0])
    for observed in training[1:]:
        previous_level = level
        level = alpha * float(observed) + (1.0 - alpha) * (level + phi * trend)
        trend = beta * (level - previous_level) + (1.0 - beta) * phi * trend
    return np.asarray(
        [level + sum(phi**step for step in range(1, index + 2)) * trend for index in range(horizon)],
        dtype=float,
    )


def _fast_additive_holt_winters(training, horizon: int):
    import numpy as np

    seasonality = 12
    if len(training) < seasonality * 2:
        raise ValueError("Holt-Winters requires 24 months")
    alpha = 0.45
    beta = 0.12
    gamma = 0.25
    phi = 0.85
    first_season = training[:seasonality]
    second_season = training[seasonality : seasonality * 2]
    level = float(np.mean(first_season))
    trend = float((np.mean(second_season) - np.mean(first_season)) / seasonality)
    seasonals = np.asarray(first_season - level, dtype=float)
    for index, observed in enumerate(training):
        slot = index % seasonality
        seasonal = float(seasonals[slot])
        previous_level = level
        level = alpha * (float(observed) - seasonal) + (1.0 - alpha) * (level + phi * trend)
        trend = beta * (level - previous_level) + (1.0 - beta) * phi * trend
        seasonals[slot] = gamma * (float(observed) - level) + (1.0 - gamma) * seasonal
    forecasts = []
    for index in range(horizon):
        damped_trend = sum(phi**step for step in range(1, index + 2)) * trend
        seasonal = float(seasonals[(len(training) + index) % seasonality])
        forecasts.append(level + damped_trend + seasonal)
    return np.asarray(forecasts, dtype=float)


def _fast_theta(training, horizon: int):
    import numpy as np

    if len(training) < 3:
        raise ValueError("Theta requires at least 3 months")
    x = np.arange(len(training), dtype=float)
    slope, intercept = np.polyfit(x, np.asarray(training, dtype=float), 1)
    alpha = 0.25
    level = float(training[0])
    for observed in training[1:]:
        level = alpha * float(observed) + (1.0 - alpha) * level
    forecasts = []
    for index in range(horizon):
        future_x = len(training) + index
        linear = intercept + slope * future_x
        forecasts.append(0.5 * linear + 0.5 * level)
    return np.asarray(forecasts, dtype=float)


def _lag_features(values, index: int):
    import numpy as np

    values = np.asarray(values, dtype=float)
    lags = [1, 2, 3, 6, 12]
    windows = [3, 6, 12]
    features: list[float] = []
    for lag in lags:
        features.append(float(values[index - lag]))
    for window in windows:
        recent = values[index - window : index]
        features.extend([
            float(np.mean(recent)),
            float(np.median(recent)),
            float(np.std(recent)),
        ])
    previous_three = values[index - 6 : index - 3]
    recent_three = values[index - 3 : index]
    momentum = float(np.mean(recent_three) - np.mean(previous_three)) if len(previous_three) == 3 else 0.0
    month_slot = index % 12
    features.extend([
        float(index),
        math.sin(2 * math.pi * month_slot / 12.0),
        math.cos(2 * math.pi * month_slot / 12.0),
        momentum,
    ])
    return features


def _lag_gradient_boosting(training, horizon: int):
    import numpy as np
    from sklearn.ensemble import GradientBoostingRegressor

    values = np.asarray(training, dtype=float)
    max_lag = 12
    if len(values) < max_lag + 12:
        raise ValueError("Lag gradient boosting requires at least 24 months")

    x_rows = [_lag_features(values, index) for index in range(max_lag, len(values))]
    y = values[max_lag:]
    if len(x_rows) < 12:
        raise ValueError("Lag gradient boosting has insufficient training rows")

    model = GradientBoostingRegressor(
        loss="huber",
        n_estimators=45,
        learning_rate=0.06,
        max_depth=2,
        random_state=42,
    )
    model.fit(np.asarray(x_rows, dtype=float), np.asarray(y, dtype=float))

    history = list(values)
    forecasts: list[float] = []
    for _ in range(horizon):
        feature_row = np.asarray([_lag_features(history, len(history))], dtype=float)
        prediction = float(model.predict(feature_row)[0])
        forecasts.append(prediction)
        history.append(prediction)
    return np.asarray(forecasts, dtype=float)


def _top_ensemble_models(training, target: ForecastTarget) -> list[ModelName]:
    import numpy as np

    values = np.asarray(training, dtype=float)
    start = max(12, len(values) - 6)
    scored: list[tuple[float, ModelName]] = []
    for model_name in ENSEMBLE_BASE_MODELS:
        errors = []
        for actual_index in range(start, len(values)):
            if actual_index < 12:
                continue
            try:
                predicted_log = float(_forecast_values(model_name, values[:actual_index], 1, target)[0])
            except (ValueError, RuntimeError, OverflowError, np.linalg.LinAlgError):
                errors = []
                break
            predicted = max(0.0, math.expm1(predicted_log))
            actual = max(0.0, math.expm1(float(values[actual_index])))
            errors.append(abs(actual - predicted))
        if errors:
            scored.append((float(np.mean(errors)), model_name))
    scored.sort(key=lambda item: item[0])
    return [model_name for _, model_name in scored[:3]] or ["seasonal_naive", "recent_median"]


def _seasonal_mase_denominator(values, seasonality: int = 12) -> float | None:
    import numpy as np

    values = np.asarray(values, dtype=float)
    if len(values) <= seasonality:
        return None
    errors = np.abs(values[seasonality:] - values[:-seasonality])
    denominator = float(np.mean(errors))
    return denominator if denominator > 0 else None


def _metric_summary(
    actuals,
    forecasts,
    residuals,
    mase_denominator: float | None,
    previous_actuals=None,
) -> dict[str, Any]:
    import numpy as np

    actuals = np.asarray(actuals, dtype=float)
    forecasts = np.asarray(forecasts, dtype=float)
    residuals = np.asarray(residuals, dtype=float)
    absolute_errors = np.abs(residuals)
    positive_actuals = actuals > 0
    fixed_range = np.abs(forecasts) * (TARGET_RANGE_PCT / 100.0)
    within10_mask = absolute_errors <= fixed_range
    smape_denominator = np.abs(actuals) + np.abs(forecasts)
    smape_mask = smape_denominator > 0
    lower_residual, upper_residual = np.quantile(residuals, [0.1, 0.9])
    coverage = np.mean((actuals >= forecasts + lower_residual) & (actuals <= forecasts + upper_residual))
    directional_accuracy = None
    if previous_actuals is not None:
        previous_actuals = np.asarray(previous_actuals, dtype=float)
        direction_mask = actuals != previous_actuals
        if direction_mask.any():
            actual_direction = np.sign(actuals[direction_mask] - previous_actuals[direction_mask])
            forecast_direction = np.sign(forecasts[direction_mask] - previous_actuals[direction_mask])
            directional_accuracy = float(np.mean(actual_direction == forecast_direction))
    return {
        "points": int(len(actuals)),
        "mae": float(np.mean(absolute_errors)),
        "rmse": float(np.sqrt(np.mean(residuals**2))),
        "mape": (
            float(np.mean(absolute_errors[positive_actuals] / actuals[positive_actuals]))
            if positive_actuals.any()
            else None
        ),
        "smape": (
            float(np.mean(2.0 * absolute_errors[smape_mask] / smape_denominator[smape_mask]))
            if smape_mask.any()
            else None
        ),
        "wape": float(np.sum(absolute_errors) / np.sum(actuals)) if np.sum(actuals) > 0 else None,
        "mase": float(np.mean(absolute_errors) / mase_denominator) if mase_denominator else None,
        "bias": float(np.mean(forecasts - actuals)),
        "coverage80": float(coverage),
        "interval80Width": float(upper_residual - lower_residual),
        "within10Accuracy": float(np.mean(within10_mask)),
        "within10Count": int(np.sum(within10_mask)),
        "backtestCount": int(len(actuals)),
        "targetRangePct": TARGET_RANGE_PCT,
        "targetMet": bool(float(np.mean(within10_mask)) >= TARGET_WITHIN10_ACCURACY),
        "directionalAccuracy": directional_accuracy,
    }


def _weighted_metric(
    metrics_by_horizon: dict[int, dict[str, Any]],
    key: str,
) -> float:
    weighted_sum = 0.0
    total_weight = 0.0
    for horizon, metrics in metrics_by_horizon.items():
        value = metrics.get(key)
        if isinstance(value, int | float) and math.isfinite(float(value)):
            weight = HORIZON_WEIGHTS.get(horizon, 1.0)
            weighted_sum += float(value) * weight
            total_weight += weight
    return weighted_sum / total_weight if total_weight else math.inf


def evaluate_candidate_model(
    series,
    model_name: ModelName,
    target: ForecastTarget,
    backtest_months: int = BACKTEST_MONTHS,
    horizons: tuple[int, ...] = BACKTEST_HORIZONS,
) -> CandidateResult:
    import numpy as np

    raw_values = np.asarray(series.to_numpy(dtype=float), dtype=float)
    if len(raw_values) < MIN_HISTORY_MONTHS:
        raise ForecastUnavailableError("Historique insuffisant pour le backtest.")

    start_actual_index = max(12, len(raw_values) - backtest_months)
    mase_denominator = _seasonal_mase_denominator(raw_values)
    residuals_by_horizon: dict[int, list[float]] = {}
    metrics_by_horizon: dict[int, dict[str, float | int | None]] = {}
    backtests_by_horizon: dict[int, list[dict[str, Any]]] = {}
    forecast_cache: dict[int, Any] = {}
    max_horizon = max(horizons)

    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        for horizon in horizons:
            actuals: list[float] = []
            forecasts: list[float] = []
            residuals: list[float] = []
            previous_actuals: list[float] = []
            rows: list[dict[str, Any]] = []
            for actual_index in range(start_actual_index, len(raw_values)):
                training_end = actual_index - horizon + 1
                if training_end < 12:
                    continue
                try:
                    forecast_log = forecast_cache.get(training_end)
                    if forecast_log is None:
                        training = _training_log_values(raw_values[:training_end], target)
                        forecast_log = _forecast_values(model_name, training, max_horizon, target)
                        forecast_cache[training_end] = forecast_log
                except (ValueError, RuntimeError, OverflowError, np.linalg.LinAlgError):
                    actuals = []
                    forecasts = []
                    residuals = []
                    rows = []
                    break
                forecast = max(0.0, math.expm1(float(forecast_log[horizon - 1])))
                actual = float(raw_values[actual_index])
                previous_actual = float(raw_values[actual_index - 1]) if actual_index > 0 else actual
                residual = actual - forecast
                actuals.append(actual)
                forecasts.append(forecast)
                residuals.append(residual)
                previous_actuals.append(previous_actual)
                rows.append(
                    {
                        "horizon": horizon,
                        "period": series.index[actual_index].date().isoformat(),
                        "actual": actual,
                        "forecast": forecast,
                        "error": residual,
                        "absolute_error": abs(residual),
                        "previous_actual": previous_actual,
                    }
                )
            if actuals:
                residuals_by_horizon[horizon] = residuals
                backtests_by_horizon[horizon] = rows
                metrics_by_horizon[horizon] = _metric_summary(
                    actuals,
                    forecasts,
                    residuals,
                    mase_denominator,
                    previous_actuals,
                )

    if not metrics_by_horizon:
        raise ForecastUnavailableError(f"Aucun backtest exploitable pour {model_name}.")

    weighted_mae = _weighted_metric(metrics_by_horizon, "mae")
    weighted_within10 = _weighted_metric(metrics_by_horizon, "within10Accuracy")
    weighted_mase = _weighted_metric(metrics_by_horizon, "mase")
    if not math.isfinite(weighted_mase):
        weighted_mase = weighted_mae
    horizon_one_metrics = metrics_by_horizon.get(1) or next(iter(metrics_by_horizon.values()))
    horizon_one_residuals = residuals_by_horizon.get(1) or next(iter(residuals_by_horizon.values()))
    return CandidateResult(
        name=model_name,
        mae=float(horizon_one_metrics["mae"] or weighted_mae),
        residuals=list(horizon_one_residuals),
        residuals_by_horizon=residuals_by_horizon,
        metrics_by_horizon=metrics_by_horizon,
        backtests_by_horizon=backtests_by_horizon,
        weighted_within10_accuracy=weighted_within10 if math.isfinite(weighted_within10) else 0.0,
        weighted_mase=weighted_mase,
        weighted_mae=weighted_mae,
    )


def evaluate_candidate_models(
    series,
    target: ForecastTarget,
    backtest_months: int = BACKTEST_MONTHS,
    horizons: tuple[int, ...] = BACKTEST_HORIZONS,
    models: tuple[ModelName, ...] = CANDIDATE_MODELS,
) -> list[CandidateResult]:
    candidates: list[CandidateResult] = []
    for model_name in models:
        try:
            candidates.append(evaluate_candidate_model(series, model_name, target, backtest_months, horizons))
        except ForecastUnavailableError:
            continue
    return candidates


def promote_candidate(candidates: list[CandidateResult]) -> CandidateResult:
    if not candidates:
        raise ForecastUnavailableError("Aucun modèle fiable ne peut être entraîné sur cet historique.")

    def selection_key(candidate: CandidateResult) -> tuple[float, float, float, float, float]:
        weighted_wape = _weighted_metric(candidate.metrics_by_horizon, "wape")
        weighted_smape = _weighted_metric(candidate.metrics_by_horizon, "smape")
        return (
            -candidate.weighted_within10_accuracy,
            weighted_wape if math.isfinite(weighted_wape) else math.inf,
            weighted_smape if math.isfinite(weighted_smape) else math.inf,
            candidate.weighted_mase,
            candidate.weighted_mae,
        )

    best = min(candidates, key=selection_key)
    baseline = next((candidate for candidate in candidates if candidate.name == "seasonal_naive"), None)
    if baseline is None or best.name == "seasonal_naive":
        return replace(
            best,
            baseline_weighted_mase=baseline.weighted_mase if baseline else None,
            promoted=True,
            selection_reason="best_within10_accuracy",
        )

    if selection_key(best) <= selection_key(baseline):
        return replace(
            best,
            baseline_weighted_mase=baseline.weighted_mase,
            promoted=True,
            selection_reason="beats_seasonal_naive_on_within10",
        )
    return replace(
        baseline,
        baseline_weighted_mase=baseline.weighted_mase,
        promoted=False,
        selection_reason="seasonal_naive_guardrail",
    )


def select_model(
    series,
    target: ForecastTarget = "resolution_delay",
    backtest_months: int = BACKTEST_MONTHS,
) -> CandidateResult:
    candidates = evaluate_candidate_models(series, target, backtest_months)
    return promote_candidate(candidates)


def _recent_activity_ok(
    points: list[MonthlyPoint] | list[TicketVolumePoint],
    target: ForecastTarget,
    current_month: datetime,
) -> bool:
    recent_start = _add_months(current_month, -12)
    recent_points = [point for point in points if recent_start <= point.period < current_month]
    if target == "resolution_delay":
        observations = sum(point.resolved_tickets for point in recent_points)  # type: ignore[attr-defined]
    else:
        observations = sum(point.ticket_count for point in recent_points)  # type: ignore[attr-defined]
    return len(recent_points) >= MIN_RECENT_MONTHS and observations >= MIN_RECENT_OBSERVATIONS


def _reliability(mae: float, baseline: float) -> str:
    ratio = mae / baseline if baseline > 0 else math.inf
    if ratio <= 0.2:
        return "Élevée"
    if ratio <= 0.4:
        return "Modérée"
    return "Prudente"


def _business_summary(change_pct: float) -> str:
    if change_pct <= -10:
        return "Amélioration attendue : le délai de résolution devrait diminuer."
    if change_pct >= 10:
        return "Vigilance recommandée : le délai de résolution devrait augmenter."
    return "Tendance stable : le délai de résolution devrait rester proche du niveau récent."


def _ticket_volume_business_summary(change_pct: float) -> str:
    if change_pct <= -10:
        return "Baisse attendue : le volume de nouveaux tickets devrait diminuer."
    if change_pct >= 10:
        return "Hausse attendue : le volume de nouveaux tickets devrait augmenter."
    return "Volume stable : le nombre de nouveaux tickets devrait rester proche du niveau récent."


def _mean(values: list[float]) -> float | None:
    clean = [value for value in values if math.isfinite(value)]
    return sum(clean) / len(clean) if clean else None


def _pct_change(current: float | None, previous: float | None) -> float | None:
    if current is None or previous is None or previous == 0:
        return None
    return (current - previous) / previous * 100.0


def _format_pct(value: float | None) -> str:
    if value is None:
        return "non comparable"
    return f"{value:+.1f}%"


def _fact_columns(conn: duckdb.DuckDBPyConnection) -> set[str]:
    return {
        row[0]
        for row in conn.execute(
            """
            select column_name
            from information_schema.columns
            where table_schema = 'analytics'
              and table_name = 'fct_tickets'
            """
        ).fetchall()
    }


def _explanation_dimensions(
    conn: duckdb.DuckDBPyConnection,
    scope_type: ScopeType,
) -> list[tuple[str, str, str, str]]:
    columns = _fact_columns(conn)
    candidates = [
        ("project", "Projet", "project_name", "coalesce(nullif(project_name, ''), 'Non renseigné')"),
        ("team", "Équipe", "team", "coalesce(nullif(team, ''), 'Non renseigné')"),
        ("type", "Type", "type", "coalesce(nullif(type, ''), 'Non renseigné')"),
    ]
    if scope_type == "project":
        allowed = {"team", "type"}
    elif scope_type == "team":
        allowed = {"project", "type"}
    else:
        allowed = {"project", "team", "type"}
    return [
        (dimension, label, column, expression)
        for dimension, label, column, expression in candidates
        if dimension in allowed and column in columns
    ]


def _contributor_interpretation(
    target: ForecastTarget,
    label: str,
    name: str,
    change_pct: float | None,
    recent: float,
    previous: float,
) -> str:
    if previous == 0 and recent > 0:
        return f"{label} {name} apparaît dans les trois derniers mois et pèse dans le signal récent."
    if change_pct is None:
        return f"{label} {name} a un niveau récent comparable difficile à mesurer."
    if target == "resolution_delay":
        if change_pct <= -10:
            return f"{label} {name} tire le délai récent vers le bas."
        if change_pct >= 10:
            return f"{label} {name} tire le délai récent vers le haut."
        return f"{label} {name} reste proche de son niveau précédent."
    if change_pct <= -10:
        return f"{label} {name} contribue à la baisse du volume récent."
    if change_pct >= 10:
        return f"{label} {name} contribue à la hausse du volume récent."
    return f"{label} {name} reste proche de son niveau précédent."


def _forecast_contributors(
    conn: duckdb.DuckDBPyConnection,
    target: ForecastTarget,
    scope_type: ScopeType,
    scope_value: str | None,
    current_month: datetime,
) -> list[dict[str, Any]]:
    previous_start = _add_months(current_month, -6)
    recent_start = _add_months(current_month, -3)
    dimensions = _explanation_dimensions(conn, scope_type)
    scope_clause, scope_params = _scope_clause(scope_type, scope_value)
    contributors: list[dict[str, Any]] = []

    for dimension, label, _column, expression in dimensions:
        if target == "resolution_delay":
            value_expr = "date_diff('second', created_date, resolved_date) / 86400.0"
            query = f"""
                select
                  {expression} as name,
                  median(case when resolved_date >= ? and resolved_date < ? then {value_expr} end) as recent_value,
                  median(case when resolved_date >= ? and resolved_date < ? then {value_expr} end) as previous_value,
                  count(*) filter (where resolved_date >= ? and resolved_date < ?)::integer as recent_count,
                  count(*) filter (where resolved_date >= ? and resolved_date < ?)::integer as previous_count
                from analytics.fct_tickets
                where created_date is not null
                  and resolved_date is not null
                  and resolved_date >= created_date
                  and resolved_date >= ?
                  and resolved_date < ?
                  {scope_clause}
                group by 1
            """
            params: list[Any] = [
                recent_start,
                current_month,
                previous_start,
                recent_start,
                recent_start,
                current_month,
                previous_start,
                recent_start,
                previous_start,
                current_month,
                *scope_params,
            ]
            metric = "délai médian"
        else:
            query = f"""
                select
                  {expression} as name,
                  sum(case when created_date >= ? and created_date < ? then 1 else 0 end)::double as recent_value,
                  sum(case when created_date >= ? and created_date < ? then 1 else 0 end)::double as previous_value,
                  sum(case when created_date >= ? and created_date < ? then 1 else 0 end)::integer as recent_count,
                  sum(case when created_date >= ? and created_date < ? then 1 else 0 end)::integer as previous_count
                from analytics.fct_tickets
                where created_date is not null
                  and created_date >= ?
                  and created_date < ?
                  {scope_clause}
                group by 1
            """
            params = [
                recent_start,
                current_month,
                previous_start,
                recent_start,
                recent_start,
                current_month,
                previous_start,
                recent_start,
                previous_start,
                current_month,
                *scope_params,
            ]
            metric = "tickets créés"

        for name, recent_raw, previous_raw, recent_count, previous_count in conn.execute(query, params).fetchall():
            recent = float(recent_raw or 0.0)
            previous = float(previous_raw or 0.0)
            if recent_count == 0 and previous_count == 0:
                continue
            change = _pct_change(recent, previous)
            rank_value = abs(change) if change is not None else abs(recent - previous)
            contributor_name = str(name or "Non renseigné")
            contributors.append(
                {
                    "dimension": dimension,
                    "name": contributor_name,
                    "metric": metric,
                    "recentValue": round(recent, 1),
                    "previousValue": round(previous, 1),
                    "changePct": round(change, 1) if change is not None else None,
                    "interpretation": _contributor_interpretation(
                        target,
                        label,
                        contributor_name,
                        change,
                        recent,
                        previous,
                    ),
                    "_rank": rank_value,
                }
            )

    contributors.sort(key=lambda item: item["_rank"], reverse=True)
    return [
        {key: value for key, value in item.items() if key != "_rank"}
        for item in contributors[:3]
    ]


def _same_month_value(
    points: list[MonthlyPoint] | list[TicketVolumePoint],
    forecast_period: str,
    target: ForecastTarget,
) -> tuple[datetime, float] | None:
    month = int(forecast_period[5:7])
    for point in reversed(points):
        if point.period.month != month:
            continue
        if target == "resolution_delay":
            return point.period, float(point.median_days)  # type: ignore[attr-defined]
        return point.period, float(point.ticket_count)  # type: ignore[attr-defined]
    return None


def _history_windows(
    points: list[MonthlyPoint] | list[TicketVolumePoint],
    target: ForecastTarget,
) -> tuple[float | None, float | None]:
    recent = points[-3:]
    previous = points[-6:-3]
    if target == "resolution_delay":
        return (
            _mean([float(point.median_days) for point in recent]),  # type: ignore[attr-defined]
            _mean([float(point.median_days) for point in previous]),  # type: ignore[attr-defined]
        )
    return (
        _mean([float(point.ticket_count) for point in recent]),  # type: ignore[attr-defined]
        _mean([float(point.ticket_count) for point in previous]),  # type: ignore[attr-defined]
    )


def _confidence_note(reliability: str, mae: float, unit: str) -> str:
    if reliability in {"Élevée", "Ã‰levÃ©e"}:
        return f"Lecture fiable : les derniers backtests se trompent en moyenne d'environ {mae:.1f} {unit}."
    if reliability in {"Modérée", "ModÃ©rÃ©e"}:
        return f"Lecture à confirmer : l'erreur historique moyenne est d'environ {mae:.1f} {unit}."
    return f"Lecture prudente : l'historique varie beaucoup, avec une erreur moyenne d'environ {mae:.1f} {unit}."


def _build_explanation(
    *,
    conn: duckdb.DuckDBPyConnection,
    target: ForecastTarget,
    scope_type: ScopeType,
    scope_value: str | None,
    current_month: datetime,
    history: list[MonthlyPoint] | list[TicketVolumePoint],
    first_forecast: dict[str, Any],
    summary: dict[str, Any],
    model: dict[str, Any],
) -> dict[str, Any]:
    recent_window, previous_window = _history_windows(history, target)
    recent_change = _pct_change(recent_window, previous_window)
    forecast_period = str(first_forecast["period"])
    if target == "resolution_delay":
        next_value = float(summary["nextMonthMedianDays"])
        baseline = float(summary["recentThreeMonthMedianDays"])
        unit = "jours"
        short_unit = "j"
        metric_label = "délai de résolution"
        mae = float(model["backtestMaeDays"])
        forecast_key = "predictedMedianDays"
    else:
        next_value = float(summary["nextMonthTickets"])
        baseline = float(summary["recentThreeMonthAverageTickets"])
        unit = "tickets"
        short_unit = "tickets"
        metric_label = "volume de tickets"
        mae = float(model["backtestMaeTickets"])
        forecast_key = "predictedTickets"

    forecast_change = _pct_change(next_value, baseline)
    same_month = _same_month_value(history, forecast_period, target)
    seasonal_text = "La saisonnalité est moins lisible, faute de comparaison solide sur le même mois."
    if same_month:
        same_period, same_value = same_month
        seasonal_change = _pct_change(float(first_forecast[forecast_key]), same_value)
        if seasonal_change is not None and abs(seasonal_change) < 8:
            seasonal_text = (
                f"La projection colle aussi à la saisonnalité : le même mois observé "
                f"en {same_period.year} était déjà autour de {same_value:.1f} {short_unit}."
            )
        elif seasonal_change is not None and seasonal_change < 0:
            seasonal_text = (
                f"Elle est sous le niveau du même mois en {same_period.year} "
                f"({same_value:.1f} {short_unit}), ce qui renforce le signal de baisse."
            )
        elif seasonal_change is not None:
            seasonal_text = (
                f"Elle est au-dessus du même mois en {same_period.year} "
                f"({same_value:.1f} {short_unit}), donc la saisonnalité appelle à rester vigilant."
            )

    if forecast_change is not None and forecast_change <= -10:
        movement = "baisse"
        headline = "La prévision baisse parce que le niveau attendu est nettement sous le rythme récent."
    elif forecast_change is not None and forecast_change >= 10:
        movement = "hausse"
        headline = "La prévision monte parce que le niveau attendu dépasse nettement le rythme récent."
    else:
        movement = "stabilisation"
        headline = "La prévision reste stable parce que le niveau attendu colle au rythme récent."

    if recent_change is None:
        recent_sentence = "Le trimestre précédent n'est pas assez complet pour mesurer une dynamique récente."
    elif target == "resolution_delay" and recent_change <= -10:
        recent_sentence = "Les trois derniers mois montrent déjà un raccourcissement du délai, ce qui pousse la projection vers le bas."
    elif target == "resolution_delay" and recent_change >= 10:
        recent_sentence = "Les trois derniers mois se sont allongés par rapport au trimestre précédent, ce qui explique la vigilance du modèle."
    elif target == "ticket_volume" and recent_change <= -10:
        recent_sentence = "Les trois derniers mois sont sous le trimestre précédent, ce qui explique une projection plus basse."
    elif target == "ticket_volume" and recent_change >= 10:
        recent_sentence = "Les trois derniers mois sont au-dessus du trimestre précédent, ce qui tire la projection vers le haut."
    else:
        recent_sentence = "Le rythme des trois derniers mois reste proche du trimestre précédent, donc la projection ne signale pas de rupture."

    paragraphs = [
        (
            f"Le signal principal est une {movement} du {metric_label} : le prochain mois est attendu "
            f"à {next_value:.1f} {short_unit}, contre {baseline:.1f} {short_unit} sur les trois derniers mois complets "
            f"({_format_pct(forecast_change)}). {recent_sentence}"
        ),
        (
            f"{seasonal_text} Le mois en cours reste indicatif seulement : il est affiché pour contexte, "
            "mais il n'est pas utilisé pour entraîner la prévision."
        ),
    ]
    evidence = [
        {
            "label": "Écart vs référence récente",
            "value": _format_pct(forecast_change),
            "meaning": "Compare le mois prévu aux trois derniers mois complets.",
        },
        {
            "label": "Signal des trois derniers mois",
            "value": _format_pct(recent_change),
            "meaning": "Compare les trois derniers mois au trimestre précédent.",
        },
    ]
    if same_month:
        evidence.append(
            {
                "label": "Repère saisonnier",
                "value": f"{same_month[1]:.1f} {short_unit}",
                "meaning": f"Même mois observé en {same_month[0].year}.",
            }
        )

    return {
        "headline": headline,
        "paragraphs": paragraphs,
        "evidence": evidence,
        "contributors": _forecast_contributors(conn, target, scope_type, scope_value, current_month),
        "confidenceNote": _confidence_note(str(summary["reliability"]), mae, unit),
    }


def _interval_residuals(selected: CandidateResult, step: int) -> list[float]:
    horizon = 1 if step == 1 else 3 if step <= 3 else 6
    return (
        selected.residuals_by_horizon.get(horizon)
        or selected.residuals_by_horizon.get(1)
        or selected.residuals
        or [0.0]
    )


def _model_payload(selected: CandidateResult, series, extra: dict[str, Any], backtest_key: str) -> dict[str, Any]:
    metrics_payload = {
        str(horizon): {
            key: round(value, 4) if isinstance(value, float) and math.isfinite(value) else value
            for key, value in metrics.items()
        }
        for horizon, metrics in selected.metrics_by_horizon.items()
    }
    return {
        "name": selected.name,
        backtest_key: round(selected.mae, 1),
        "targetRangePct": TARGET_RANGE_PCT,
        "targetAccuracyPct": round(TARGET_WITHIN10_ACCURACY * 100.0, 1),
        "weightedWithin10Accuracy": round(selected.weighted_within10_accuracy, 4),
        "targetMet": selected.weighted_within10_accuracy >= TARGET_WITHIN10_ACCURACY,
        "weightedMase": round(selected.weighted_mase, 4),
        "weightedMae": round(selected.weighted_mae, 4),
        "baselineWeightedMase": (
            round(selected.baseline_weighted_mase, 4)
            if selected.baseline_weighted_mase is not None and math.isfinite(selected.baseline_weighted_mase)
            else None
        ),
        "promoted": selected.promoted,
        "selectionReason": selected.selection_reason,
        "metricsByHorizon": metrics_payload,
        "trainingStart": series.index[0].date().isoformat(),
        "trainingEnd": series.index[-1].date().isoformat(),
        "historyMonths": len(series),
        **extra,
    }


def _fixed_pct_bounds(value: float, digits: int = 1) -> tuple[float, float]:
    delta = abs(float(value)) * (TARGET_RANGE_PCT / 100.0)
    return (
        round(max(0.0, float(value) - delta), digits),
        round(max(0.0, float(value) + delta), digits),
    )


def build_forecast(
    warehouse_path: Path,
    scope_type: ScopeType,
    scope_value: str | None,
    horizon_months: int = DEFAULT_HORIZON_MONTHS,
    today: date | None = None,
) -> dict[str, Any]:
    import numpy as np
    import pandas as pd

    if horizon_months != DEFAULT_HORIZON_MONTHS:
        raise ForecastUnavailableError("L’horizon disponible est fixé à six mois.")
    if not warehouse_path.exists():
        raise ForecastUnavailableError("Les données ne sont pas encore disponibles.")

    target: ForecastTarget = "resolution_delay"
    current_month = _month_start(today or date.today())
    stat = warehouse_path.stat()
    cache_key = (
        stat.st_mtime_ns,
        target,
        scope_type,
        scope_value or "",
        horizon_months,
        (today or date.today()).isoformat(),
    )
    with _cache_lock:
        cached = _forecast_cache.get(cache_key)
        if cached:
            return cached

    with duckdb.connect(str(warehouse_path), read_only=True) as conn:
        history, current = load_monthly_points(conn, scope_type, scope_value, today)

    resolved_tickets = sum(point.resolved_tickets for point in history)
    if len(history) < MIN_HISTORY_MONTHS or resolved_tickets < MIN_RESOLVED_TICKETS:
        raise ForecastUnavailableError(
            "Historique insuffisant : il faut au moins "
            f"{MIN_HISTORY_MONTHS} mois renseignés et {MIN_RESOLVED_TICKETS} tickets résolus."
        )
    if scope_type != "global" and not _recent_activity_ok(history, target, current_month):
        raise ForecastUnavailableError(
            "Activité récente insuffisante : il faut au moins "
            f"{MIN_RECENT_MONTHS} mois actifs et {MIN_RECENT_OBSERVATIONS} tickets récents."
        )

    series = _regular_series(history)
    selected = select_model(series, target)
    forecast_start = _next_month(current_month)
    first_model_period = _next_month(series.index[-1].to_pydatetime())
    skipped_incomplete_months = max(0, _month_distance(first_model_period, forecast_start))
    training = _training_log_values(series.to_numpy(dtype=float), target)
    future_log = _forecast_values(
        selected.name,
        training,
        horizon_months + skipped_incomplete_months,
        target,
    )
    predictions = np.maximum(0.0, np.expm1(future_log))[skipped_incomplete_months:]
    future_index = pd.date_range(forecast_start, periods=horizon_months, freq="MS")

    recent_baseline = float(np.median(series.iloc[-3:]))
    next_month = float(predictions[0])
    change_pct = ((next_month - recent_baseline) / recent_baseline * 100.0) if recent_baseline else 0.0
    forecasts = []
    for step, (period, value) in enumerate(zip(future_index, predictions, strict=True), start=1):
        lower, upper = _fixed_pct_bounds(float(value), 1)
        forecasts.append(
            {
                "period": period.date().isoformat(),
                "predictedMedianDays": round(float(value), 1),
                "lowerBoundDays": lower,
                "upperBoundDays": upper,
            }
        )

    summary_payload = {
        "nextMonthMedianDays": round(next_month, 1),
        "sixMonthAverageDays": round(float(np.mean(predictions)), 1),
        "recentThreeMonthMedianDays": round(recent_baseline, 1),
        "changePct": round(change_pct, 1),
        "trend": "improving" if change_pct <= -10 else "deteriorating" if change_pct >= 10 else "stable",
        "businessInsight": _business_summary(change_pct),
        "reliability": _reliability(selected.mae, recent_baseline),
        "qualityTargetMet": selected.weighted_within10_accuracy >= TARGET_WITHIN10_ACCURACY,
        "qualityWarning": (
            None
            if selected.weighted_within10_accuracy >= TARGET_WITHIN10_ACCURACY
            else "Ce périmètre est en dessous de l’objectif 85%; lecture à utiliser avec prudence."
        ),
    }
    model_payload = _model_payload(
        selected,
        series,
        {"resolvedTickets": resolved_tickets},
        "backtestMaeDays",
    )
    response = {
        "scope": {"type": scope_type, "value": scope_value},
        "historical": [
            {
                "period": point.period.date().isoformat(),
                "medianDays": round(point.median_days, 1),
                "resolvedTickets": point.resolved_tickets,
            }
            for point in history
        ],
        "currentMonth": (
            {
                "period": current.period.date().isoformat(),
                "medianDays": round(current.median_days, 1),
                "resolvedTickets": current.resolved_tickets,
            }
            if current
            else None
        ),
        "forecast": forecasts,
        "summary": summary_payload,
        "model": model_payload,
    }
    with duckdb.connect(str(warehouse_path), read_only=True) as conn:
        response["explanation"] = _build_explanation(
            conn=conn,
            target=target,
            scope_type=scope_type,
            scope_value=scope_value,
            current_month=current_month,
            history=history,
            first_forecast=forecasts[0],
            summary=summary_payload,
            model=model_payload,
        )
    from analytics_service.forecast_ai import build_ai_interpretation

    response["aiInterpretation"] = build_ai_interpretation(response, target)
    with _cache_lock:
        stale_keys = [key for key in _forecast_cache if key[0] != stat.st_mtime_ns]
        for key in stale_keys:
            _forecast_cache.pop(key, None)
        _forecast_cache[cache_key] = response
    return response


def build_ticket_volume_forecast(
    warehouse_path: Path,
    scope_type: ScopeType,
    scope_value: str | None,
    horizon_months: int = DEFAULT_HORIZON_MONTHS,
    today: date | None = None,
) -> dict[str, Any]:
    import numpy as np
    import pandas as pd

    if horizon_months != DEFAULT_HORIZON_MONTHS:
        raise ForecastUnavailableError("L’horizon disponible est fixé à six mois.")
    if not warehouse_path.exists():
        raise ForecastUnavailableError("Les données ne sont pas encore disponibles.")

    target: ForecastTarget = "ticket_volume"
    current_month = _month_start(today or date.today())
    stat = warehouse_path.stat()
    cache_key = (
        stat.st_mtime_ns,
        target,
        scope_type,
        scope_value or "",
        horizon_months,
        (today or date.today()).isoformat(),
    )
    with _cache_lock:
        cached = _forecast_cache.get(cache_key)
        if cached:
            return cached

    with duckdb.connect(str(warehouse_path), read_only=True) as conn:
        history, current = load_ticket_volume_points(conn, scope_type, scope_value, today)

    tickets = sum(point.ticket_count for point in history)
    if len(history) < MIN_HISTORY_MONTHS or tickets < MIN_RESOLVED_TICKETS:
        raise ForecastUnavailableError(
            "Historique insuffisant : il faut au moins "
            f"{MIN_HISTORY_MONTHS} mois renseignés et {MIN_RESOLVED_TICKETS} tickets."
        )
    if scope_type != "global" and not _recent_activity_ok(history, target, current_month):
        raise ForecastUnavailableError(
            "Activité récente insuffisante : il faut au moins "
            f"{MIN_RECENT_MONTHS} mois actifs et {MIN_RECENT_OBSERVATIONS} tickets récents."
        )

    series = _regular_ticket_series(history)
    selected = select_model(series, target)
    forecast_start = _next_month(current_month)
    first_model_period = _next_month(series.index[-1].to_pydatetime())
    skipped_incomplete_months = max(0, _month_distance(first_model_period, forecast_start))
    training = _training_log_values(series.to_numpy(dtype=float), target)
    future_log = _forecast_values(
        selected.name,
        training,
        horizon_months + skipped_incomplete_months,
        target,
    )
    predictions = np.maximum(0.0, np.expm1(future_log))[skipped_incomplete_months:]
    future_index = pd.date_range(forecast_start, periods=horizon_months, freq="MS")

    recent_baseline = float(np.mean(series.iloc[-3:]))
    next_month = float(predictions[0])
    change_pct = ((next_month - recent_baseline) / recent_baseline * 100.0) if recent_baseline else 0.0

    forecasts = []
    for step, (period, value) in enumerate(zip(future_index, predictions, strict=True), start=1):
        lower_raw, upper_raw = _fixed_pct_bounds(float(value), 0)
        lower = max(0, int(round(lower_raw)))
        upper = max(lower, int(round(upper_raw)))
        forecasts.append(
            {
                "period": period.date().isoformat(),
                "predictedTickets": max(0, int(round(float(value)))),
                "lowerBoundTickets": lower,
                "upperBoundTickets": upper,
            }
        )

    summary_payload = {
        "nextMonthTickets": max(0, int(round(next_month))),
        "sixMonthAverageTickets": round(float(np.mean(predictions)), 1),
        "recentThreeMonthAverageTickets": round(recent_baseline, 1),
        "changePct": round(change_pct, 1),
        "trend": "decreasing" if change_pct <= -10 else "increasing" if change_pct >= 10 else "stable",
        "businessInsight": _ticket_volume_business_summary(change_pct),
        "reliability": _reliability(selected.mae, recent_baseline),
        "qualityTargetMet": selected.weighted_within10_accuracy >= TARGET_WITHIN10_ACCURACY,
        "qualityWarning": (
            None
            if selected.weighted_within10_accuracy >= TARGET_WITHIN10_ACCURACY
            else "Ce périmètre est en dessous de l’objectif 85%; lecture à utiliser avec prudence."
        ),
    }
    model_payload = _model_payload(selected, series, {"tickets": tickets}, "backtestMaeTickets")
    response = {
        "scope": {"type": scope_type, "value": scope_value},
        "historical": [
            {
                "period": point.period.date().isoformat(),
                "ticketCount": point.ticket_count,
            }
            for point in history
        ],
        "currentMonth": (
            {
                "period": current.period.date().isoformat(),
                "ticketCount": current.ticket_count,
            }
            if current
            else None
        ),
        "forecast": forecasts,
        "summary": summary_payload,
        "model": model_payload,
    }
    with duckdb.connect(str(warehouse_path), read_only=True) as conn:
        response["explanation"] = _build_explanation(
            conn=conn,
            target=target,
            scope_type=scope_type,
            scope_value=scope_value,
            current_month=current_month,
            history=history,
            first_forecast=forecasts[0],
            summary=summary_payload,
            model=model_payload,
        )
    from analytics_service.forecast_ai import build_ai_interpretation

    response["aiInterpretation"] = build_ai_interpretation(response, target)
    with _cache_lock:
        stale_keys = [key for key in _forecast_cache if key[0] != stat.st_mtime_ns]
        for key in stale_keys:
            _forecast_cache.pop(key, None)
        _forecast_cache[cache_key] = response
    return response
