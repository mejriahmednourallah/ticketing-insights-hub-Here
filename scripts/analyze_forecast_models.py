#!/usr/bin/env python3
from __future__ import annotations

import argparse
import csv
import json
import math
import os
import sys
from collections import Counter, defaultdict
from dataclasses import dataclass
from datetime import date, datetime, timezone
from pathlib import Path
from statistics import median
from typing import Any


REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT))

import duckdb

from analytics_service.forecasting import (
    BACKTEST_HORIZONS,
    BACKTEST_MONTHS,
    CANDIDATE_MODELS,
    MIN_HISTORY_MONTHS,
    MIN_RECENT_MONTHS,
    MIN_RECENT_OBSERVATIONS,
    MIN_RESOLVED_TICKETS,
    CandidateResult,
    ForecastTarget,
    ModelName,
    ScopeType,
    _regular_series,
    _regular_ticket_series,
    eligible_scopes,
    eligible_ticket_volume_scopes,
    evaluate_candidate_model,
    load_monthly_points,
    load_ticket_volume_points,
    promote_candidate,
)


TARGET_LABELS = {
    "resolution_delay": "Délai médian de résolution",
    "ticket_volume": "Volume mensuel de tickets",
}


@dataclass(frozen=True)
class ScopeSpec:
    target: ForecastTarget
    scope_type: ScopeType
    scope_value: str | None
    display_name: str
    history_months: int
    observations: int


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Backtest every forecast candidate model on the local DuckDB warehouse "
            "and write ranked accuracy reports."
        )
    )
    parser.add_argument(
        "--warehouse",
        default=os.getenv("DUCKDB_PATH", "/tmp/warehouse-current.duckdb"),
        help="Path to warehouse-current.duckdb. Defaults to DUCKDB_PATH or /tmp/warehouse-current.duckdb.",
    )
    parser.add_argument(
        "--output-dir",
        default="runtime/model-analysis",
        help="Directory for JSON, CSV, and Prometheus snapshot reports.",
    )
    parser.add_argument(
        "--target",
        choices=["both", "resolution_delay", "ticket_volume"],
        default="both",
        help="Forecast target to evaluate.",
    )
    parser.add_argument(
        "--backtest-months",
        type=int,
        default=BACKTEST_MONTHS,
        help="Number of latest completed months used as actual months in rolling-origin backtests.",
    )
    parser.add_argument(
        "--max-projects",
        type=int,
        default=15,
        help="Top eligible projects per target to include unless --all-scopes is set.",
    )
    parser.add_argument(
        "--max-teams",
        type=int,
        default=10,
        help="Top eligible teams per target to include unless --all-scopes is set.",
    )
    parser.add_argument(
        "--all-scopes",
        action="store_true",
        help="Evaluate every eligible project and team. This can take several minutes.",
    )
    parser.add_argument(
        "--today",
        help="Override today's date as YYYY-MM-DD for reproducible current-month exclusion.",
    )
    return parser.parse_args()


def parse_today(value: str | None) -> date:
    if not value:
        return date.today()
    return datetime.strptime(value, "%Y-%m-%d").date()


def finite(value: float | int | None) -> float | None:
    if value is None or not math.isfinite(float(value)):
        return None
    return float(value)


def rounded(value: float | int | None, digits: int = 4) -> float | None:
    value = finite(value)
    return None if value is None else round(value, digits)


def percent(value: float | int | None) -> float | None:
    value = finite(value)
    return None if value is None else round(value * 100.0, 2)


def median_optional(values: list[float | int | None], digits: int = 4) -> float | None:
    clean_values = [float(value) for value in values if value is not None and math.isfinite(float(value))]
    if not clean_values:
        return None
    return round(float(median(clean_values)), digits)


def rank_options(options: list[dict[str, Any]], count_key: str, limit: int, all_scopes: bool) -> list[dict[str, Any]]:
    ranked = sorted(
        options,
        key=lambda item: (
            int(item.get(count_key, 0)),
            int(item.get("recentMonths", 0)),
            int(item.get("historyMonths", 0)),
            str(item.get("value", "")),
        ),
        reverse=True,
    )
    return ranked if all_scopes else ranked[:limit]


def build_scopes(
    conn: duckdb.DuckDBPyConnection,
    target: ForecastTarget,
    today: date,
    max_projects: int,
    max_teams: int,
    all_scopes: bool,
) -> list[ScopeSpec]:
    if target == "resolution_delay":
        history, _ = load_monthly_points(conn, "global", None, today)
        global_observations = sum(point.resolved_tickets for point in history)
        options = eligible_scopes(conn, today)
        count_key = "resolvedTickets"
    else:
        history, _ = load_ticket_volume_points(conn, "global", None, today)
        global_observations = sum(point.ticket_count for point in history)
        options = eligible_ticket_volume_scopes(conn, today)
        count_key = "tickets"

    scopes = [
        ScopeSpec(
            target=target,
            scope_type="global",
            scope_value=None,
            display_name="Global",
            history_months=len(history),
            observations=global_observations,
        )
    ]
    for item in rank_options(options["projects"], count_key, max_projects, all_scopes):
        scopes.append(
            ScopeSpec(
                target=target,
                scope_type="project",
                scope_value=str(item["value"]),
                display_name=f"Projet — {item['value']}",
                history_months=int(item["historyMonths"]),
                observations=int(item[count_key]),
            )
        )
    for item in rank_options(options["teams"], count_key, max_teams, all_scopes):
        scopes.append(
            ScopeSpec(
                target=target,
                scope_type="team",
                scope_value=str(item["value"]),
                display_name=f"Équipe — {item['value']}",
                history_months=int(item["historyMonths"]),
                observations=int(item[count_key]),
            )
        )
    return scopes


def load_series(conn: duckdb.DuckDBPyConnection, scope: ScopeSpec, today: date):
    if scope.target == "resolution_delay":
        history, _ = load_monthly_points(conn, scope.scope_type, scope.scope_value, today)
        return _regular_series(history)
    history, _ = load_ticket_volume_points(conn, scope.scope_type, scope.scope_value, today)
    return _regular_ticket_series(history)


def skipped(scope: ScopeSpec, model_name: ModelName, reason: str) -> dict[str, Any]:
    return {
        "target": scope.target,
        "scope_type": scope.scope_type,
        "scope_value": scope.scope_value or "",
        "scope": scope.display_name,
        "model": model_name,
        "status": "skipped",
        "skip_reason": reason,
        "history_months": scope.history_months,
        "observations": scope.observations,
        "weighted_mase": None,
        "weighted_mae": None,
        "promoted_live_model": False,
        "selection_reason": "",
    }


def model_row(scope: ScopeSpec, candidate: CandidateResult, promoted: CandidateResult) -> dict[str, Any]:
    row: dict[str, Any] = {
        "target": scope.target,
        "scope_type": scope.scope_type,
        "scope_value": scope.scope_value or "",
        "scope": scope.display_name,
        "model": candidate.name,
        "status": "ok",
        "skip_reason": "",
        "history_months": scope.history_months,
        "observations": scope.observations,
        "weighted_mase": rounded(candidate.weighted_mase),
        "weighted_mae": rounded(candidate.weighted_mae),
        "promoted_live_model": candidate.name == promoted.name,
        "selection_reason": promoted.selection_reason if candidate.name == promoted.name else "",
    }
    for horizon in BACKTEST_HORIZONS:
        metrics = candidate.metrics_by_horizon.get(horizon, {})
        row[f"h{horizon}_points"] = metrics.get("points", 0)
        row[f"h{horizon}_mae"] = rounded(metrics.get("mae"))
        row[f"h{horizon}_rmse"] = rounded(metrics.get("rmse"))
        row[f"h{horizon}_wape_pct"] = percent(metrics.get("wape"))
        row[f"h{horizon}_smape_pct"] = percent(metrics.get("smape"))
        row[f"h{horizon}_mase"] = rounded(metrics.get("mase"))
        row[f"h{horizon}_bias"] = rounded(metrics.get("bias"))
        row[f"h{horizon}_coverage80_pct"] = percent(metrics.get("coverage80"))
        row[f"h{horizon}_interval80_width"] = rounded(metrics.get("interval80Width"))
        row[f"h{horizon}_directional_accuracy_pct"] = percent(metrics.get("directionalAccuracy"))
    return row


def horizon_rows(scope: ScopeSpec, candidate: CandidateResult, promoted: CandidateResult) -> list[dict[str, Any]]:
    rows = []
    for horizon, metrics in candidate.metrics_by_horizon.items():
        rows.append(
            {
                "target": scope.target,
                "scope_type": scope.scope_type,
                "scope_value": scope.scope_value or "",
                "scope": scope.display_name,
                "model": candidate.name,
                "horizon": horizon,
                "promoted_live_model": candidate.name == promoted.name,
                "points": metrics.get("points", 0),
                "mae": rounded(metrics.get("mae")),
                "rmse": rounded(metrics.get("rmse")),
                "wape_pct": percent(metrics.get("wape")),
                "smape_pct": percent(metrics.get("smape")),
                "mase": rounded(metrics.get("mase")),
                "bias": rounded(metrics.get("bias")),
                "coverage80_pct": percent(metrics.get("coverage80")),
                "interval80_width": rounded(metrics.get("interval80Width")),
                "directional_accuracy_pct": percent(metrics.get("directionalAccuracy")),
            }
        )
    return rows


def backtest_rows(scope: ScopeSpec, candidate: CandidateResult) -> list[dict[str, Any]]:
    rows = []
    for horizon, predictions in candidate.backtests_by_horizon.items():
        for prediction in predictions:
            rows.append(
                {
                    "target": scope.target,
                    "scope_type": scope.scope_type,
                    "scope_value": scope.scope_value or "",
                    "scope": scope.display_name,
                    "model": candidate.name,
                    "horizon": horizon,
                    "period": prediction["period"],
                    "actual": rounded(prediction["actual"]),
                    "forecast": rounded(prediction["forecast"]),
                    "error": rounded(prediction["error"]),
                    "absolute_error": rounded(prediction["absolute_error"]),
                    "previous_actual": rounded(prediction.get("previous_actual")),
                }
            )
    return rows


def scoreboard(rows: list[dict[str, Any]], selected_rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    wins = Counter((row["target"], row["model"]) for row in selected_rows)
    grouped: dict[tuple[str, str], list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        if row["status"] == "ok":
            grouped[(row["target"], row["model"])].append(row)

    output = []
    for (target, model_name), model_rows in grouped.items():
        output.append(
            {
                "target": target,
                "model": model_name,
                "scopes_evaluated": len(model_rows),
                "scope_wins": wins[(target, model_name)],
                "median_weighted_mase": median_optional([row["weighted_mase"] for row in model_rows]),
                "median_weighted_mae": median_optional([row["weighted_mae"] for row in model_rows]),
                "median_h1_mae": median_optional([row["h1_mae"] for row in model_rows]),
                "median_h1_wape_pct": median_optional([row["h1_wape_pct"] for row in model_rows], 2),
                "median_h3_mae": median_optional([row["h3_mae"] for row in model_rows]),
                "median_h6_mae": median_optional([row["h6_mae"] for row in model_rows]),
                "median_h1_directional_accuracy_pct": median_optional(
                    [row["h1_directional_accuracy_pct"] for row in model_rows],
                    2,
                ),
            }
        )
    return sorted(output, key=lambda row: (row["target"], -row["scope_wins"], row["median_weighted_mase"] or float("inf")))


def write_csv(path: Path, rows: list[dict[str, Any]]) -> None:
    if not rows:
        path.write_text("", encoding="utf-8")
        return
    with path.open("w", newline="", encoding="utf-8") as csv_file:
        writer = csv.DictWriter(csv_file, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)


def prom_label(value: str) -> str:
    return value.replace("\\", "\\\\").replace('"', '\\"').replace("\n", "\\n")


def labels(**items: str | int | float | bool | None) -> str:
    rendered = ",".join(f'{key}="{prom_label(str(value or ""))}"' for key, value in items.items())
    return "{" + rendered + "}"


def write_prometheus_snapshot(path: Path, report: dict[str, Any], selected_rows: list[dict[str, Any]], horizon_metric_rows: list[dict[str, Any]]) -> None:
    generated_at = datetime.fromisoformat(report["generatedAt"]).timestamp()
    lines = [
        "# HELP ticketing_forecast_model_report_generated_timestamp_seconds Last model-analysis report generation time.",
        "# TYPE ticketing_forecast_model_report_generated_timestamp_seconds gauge",
        f"ticketing_forecast_model_report_generated_timestamp_seconds {generated_at}",
        "# HELP ticketing_forecast_model_selected_info Selected promoted forecast model by scope.",
        "# TYPE ticketing_forecast_model_selected_info gauge",
    ]
    for row in selected_rows:
        lines.append(
            "ticketing_forecast_model_selected_info"
            + labels(
                forecast_type=row["target"],
                scope_type=row["scope_type"],
                scope_value=row["scope_value"],
                model=row["model"],
                reason=row["selection_reason"],
            )
            + " 1"
        )
    lines.extend(
        [
            "# HELP ticketing_forecast_model_wins_total Number of scopes where the model is promoted.",
            "# TYPE ticketing_forecast_model_wins_total gauge",
        ]
    )
    for row in report["scoreboard"]:
        lines.append(
            "ticketing_forecast_model_wins_total"
            + labels(forecast_type=row["target"], model=row["model"])
            + f" {row['scope_wins']}"
        )
    for metric_name, key in [
        ("ticketing_forecast_model_mae", "mae"),
        ("ticketing_forecast_model_wape_percent", "wape_pct"),
        ("ticketing_forecast_model_mase", "mase"),
    ]:
        lines.extend(
            [
                f"# HELP {metric_name} Latest model-analysis metric by horizon.",
                f"# TYPE {metric_name} gauge",
            ]
        )
        for row in horizon_metric_rows:
            value = row.get(key)
            if value is None:
                continue
            lines.append(
                metric_name
                + labels(
                    forecast_type=row["target"],
                    scope_type=row["scope_type"],
                    scope_value=row["scope_value"],
                    model=row["model"],
                    horizon=row["horizon"],
                    promoted=row["promoted_live_model"],
                )
                + f" {value}"
            )
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def print_report(report: dict[str, Any]) -> None:
    print("\nForecast model analysis")
    print("=======================")
    print(f"Warehouse: {report['warehouse']}")
    print(f"Generated: {report['generatedAt']}")
    print(f"Backtest window: latest {report['backtestMonths']} completed actual months")
    print("F1 score note: F1 is for classification; these time-series models are judged with MAE, RMSE, WAPE, sMAPE, MASE, bias, interval coverage, and direction accuracy.\n")

    for target in report["targets"]:
        target_rows = [row for row in report["scoreboard"] if row["target"] == target]
        best_rows = [row for row in report["bestByScope"] if row["target"] == target]
        print(TARGET_LABELS[target])
        print("-" * len(TARGET_LABELS[target]))
        for row in target_rows:
            print(
                f"{row['model']}: wins={row['scope_wins']}, "
                f"median weighted MASE={row['median_weighted_mase']}, "
                f"median H1 MAE={row['median_h1_mae']}, "
                f"median H1 WAPE={row['median_h1_wape_pct']}%"
            )
        print("Top promoted scope models:")
        for row in best_rows[:8]:
            print(
                f"  {row['scope']}: {row['model']} "
                f"(weighted MASE={row['weighted_mase']}, H1 MAE={row.get('h1_mae')}, reason={row['selection_reason']})"
            )
        print()

    print("Reports written:")
    for name, path in report["files"].items():
        print(f"  {name}: {path}")


def main() -> int:
    args = parse_args()
    today = parse_today(args.today)
    warehouse_path = Path(args.warehouse).expanduser().resolve()
    if not warehouse_path.exists():
        print(f"Warehouse not found: {warehouse_path}", file=sys.stderr)
        return 2

    targets: list[ForecastTarget] = (
        ["resolution_delay", "ticket_volume"]
        if args.target == "both"
        else [args.target]
    )
    output_dir = (REPO_ROOT / args.output_dir).resolve() if not Path(args.output_dir).is_absolute() else Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    model_rows: list[dict[str, Any]] = []
    horizon_metric_rows: list[dict[str, Any]] = []
    prediction_rows: list[dict[str, Any]] = []
    scope_rows: list[dict[str, Any]] = []
    selected_rows: list[dict[str, Any]] = []

    with duckdb.connect(str(warehouse_path), read_only=True) as conn:
        for target in targets:
            scopes = build_scopes(conn, target, today, args.max_projects, args.max_teams, args.all_scopes)
            for scope in scopes:
                scope_rows.append(
                    {
                        "target": scope.target,
                        "scope_type": scope.scope_type,
                        "scope_value": scope.scope_value or "",
                        "scope": scope.display_name,
                        "history_months": scope.history_months,
                        "observations": scope.observations,
                    }
                )
                series = load_series(conn, scope, today)
                candidates: list[CandidateResult] = []
                skipped_rows: list[dict[str, Any]] = []
                for model_name in CANDIDATE_MODELS:
                    try:
                        candidates.append(
                            evaluate_candidate_model(
                                series,
                                model_name,
                                scope.target,
                                backtest_months=args.backtest_months,
                                horizons=BACKTEST_HORIZONS,
                            )
                        )
                    except Exception as exc:
                        skipped_rows.append(skipped(scope, model_name, type(exc).__name__))

                if candidates:
                    promoted = promote_candidate(candidates)
                    selected = model_row(scope, promoted, promoted)
                    selected_rows.append(selected)
                    for candidate in candidates:
                        row = model_row(scope, candidate, promoted)
                        model_rows.append(row)
                        horizon_metric_rows.extend(horizon_rows(scope, candidate, promoted))
                        prediction_rows.extend(backtest_rows(scope, candidate))
                model_rows.extend(skipped_rows)

    score_rows = scoreboard(model_rows, selected_rows)
    files = {
        "summary": str(output_dir / "forecast-model-summary.json"),
        "modelMetrics": str(output_dir / "forecast-model-metrics.csv"),
        "horizonMetrics": str(output_dir / "forecast-model-horizon-metrics.csv"),
        "backtests": str(output_dir / "forecast-model-backtests.csv"),
        "scopes": str(output_dir / "forecast-model-scopes.csv"),
        "prometheus": str(output_dir / "forecast-model-quality.prom"),
    }
    report = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "warehouse": str(warehouse_path),
        "targets": targets,
        "today": today.isoformat(),
        "backtestMonths": args.backtest_months,
        "backtestHorizons": list(BACKTEST_HORIZONS),
        "minimumHistoryMonths": MIN_HISTORY_MONTHS,
        "minimumObservations": MIN_RESOLVED_TICKETS,
        "minimumRecentMonths": MIN_RECENT_MONTHS,
        "minimumRecentObservations": MIN_RECENT_OBSERVATIONS,
        "candidateModels": list(CANDIDATE_MODELS),
        "scopeCount": len(scope_rows),
        "modelEvaluationCount": len(model_rows),
        "successfulEvaluationCount": sum(1 for row in model_rows if row["status"] == "ok"),
        "scoreboard": score_rows,
        "bestByScope": selected_rows,
        "files": files,
    }

    Path(files["summary"]).write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
    write_csv(Path(files["modelMetrics"]), model_rows)
    write_csv(Path(files["horizonMetrics"]), horizon_metric_rows)
    write_csv(Path(files["backtests"]), prediction_rows)
    write_csv(Path(files["scopes"]), scope_rows)
    write_prometheus_snapshot(Path(files["prometheus"]), report, selected_rows, horizon_metric_rows)
    print_report(report)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
