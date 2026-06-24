from __future__ import annotations

import math
import os
import re
import time
from collections import Counter
from contextlib import asynccontextmanager
from datetime import date, datetime
from pathlib import Path
from typing import Any, Literal

import duckdb
from fastapi import Depends, FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from analytics_service.auth import require_analytics_token
from analytics_service.forecasting import (
    DEFAULT_HORIZON_MONTHS,
    ForecastUnavailableError,
    build_forecast,
    build_ticket_volume_forecast,
    eligible_scopes,
    eligible_ticket_volume_scopes,
)
from analytics_service.metrics import (
    FORECAST_BACKTEST_MAE,
    FORECAST_DURATION,
    FORECAST_MODEL_SELECTIONS,
    FORECAST_REQUESTS,
    REQUEST_DURATION,
    REQUESTS,
    REQUESTS_IN_PROGRESS,
    start_api_metrics_server,
)
from analytics_service.query import FILTER_COLUMNS, build_where, safe_sort_column


WAREHOUSE_PATH = Path(os.getenv("DUCKDB_PATH", "/warehouse/warehouse-current.duckdb"))
FACT = "analytics.fct_tickets"
MIN_ANALYTICS_DATE = "date '2000-01-01'"


def duration_days_sql(end_column: str) -> str:
    return f"""
    case
      when created_date is not null
       and {end_column} is not null
       and {end_column} >= created_date
       and {end_column} >= {MIN_ANALYTICS_DATE}
      then date_diff('second', created_date, {end_column}) / 86400.0
      else null
    end
    """
NOT_PROVIDED = "Non renseigné"


class FilterRequest(BaseModel):
    filters: dict[str, Any] = Field(default_factory=dict)


class TicketSearchRequest(FilterRequest):
    page: int = Field(default=1, ge=1)
    pageSize: int = Field(default=50, ge=1, le=200)
    search: str = Field(default="", max_length=200)
    sortBy: str = "createdDate"
    sortDirection: str = "desc"


class SimilarityRequest(FilterRequest):
    topN: int = Field(default=10, ge=1, le=50)


class PredictionScope(BaseModel):
    type: Literal["global", "project", "team"] = "global"
    value: str | None = None


class ResolutionDelayPredictionRequest(BaseModel):
    scope: PredictionScope = Field(default_factory=PredictionScope)
    horizonMonths: int = Field(default=DEFAULT_HORIZON_MONTHS, ge=1, le=12)


class TicketVolumePredictionRequest(BaseModel):
    scope: PredictionScope = Field(default_factory=PredictionScope)
    horizonMonths: int = Field(default=DEFAULT_HORIZON_MONTHS, ge=1, le=12)



@asynccontextmanager
async def lifespan(_: FastAPI):
    if os.getenv("ANALYTICS_METRICS_DISABLED", "").lower() not in {"1", "true", "yes"}:
        start_api_metrics_server(
            WAREHOUSE_PATH,
            forecast_summary_path=Path(
                os.getenv(
                    "FORECAST_MODEL_SUMMARY_PATH",
                    "runtime/model-analysis/forecast-model-summary.json",
                )
            ),
            port=int(os.getenv("ANALYTICS_METRICS_PORT", "9102")),
        )
    yield


app = FastAPI(
    title="Ticketing DuckDB Analytics API",
    version="1.0.0",
    lifespan=lifespan,
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[origin for origin in os.getenv("ANALYTICS_CORS_ORIGINS", "*").split(",") if origin],
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["Authorization", "Content-Type"],
)


@app.middleware("http")
async def prometheus_request_metrics(request: Request, call_next):
    method = request.method
    REQUESTS_IN_PROGRESS.labels(method=method).inc()
    started = time.perf_counter()
    status = 500
    try:
        response = await call_next(request)
        status = response.status_code
        return response
    finally:
        route_object = request.scope.get("route")
        route = getattr(route_object, "path", request.url.path)
        REQUESTS.labels(method=method, route=route, status=str(status)).inc()
        REQUEST_DURATION.labels(method=method, route=route).observe(time.perf_counter() - started)
        REQUESTS_IN_PROGRESS.labels(method=method).dec()


def connect() -> duckdb.DuckDBPyConnection:
    if not WAREHOUSE_PATH.exists():
        raise HTTPException(status_code=503, detail="Warehouse is not ready")
    return duckdb.connect(str(WAREHOUSE_PATH), read_only=True)


def rows(conn: duckdb.DuckDBPyConnection, sql: str, params: list[Any] | None = None) -> list[dict[str, Any]]:
    result = conn.execute(sql, params or [])
    columns = [item[0] for item in result.description]
    return [dict(zip(columns, row)) for row in result.fetchall()]


def scalar(conn: duckdb.DuckDBPyConnection, sql: str, params: list[Any] | None = None) -> Any:
    value = conn.execute(sql, params or []).fetchone()
    return value[0] if value else None


def json_value(value: Any) -> Any:
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    return value


def clean_records(records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [{key: json_value(value) for key, value in row.items()} for row in records]


def dimension_query(
    conn: duckdb.DuckDBPyConnection,
    column: str,
    where: str,
    params: list[Any],
    limit: int | None = None,
) -> list[dict[str, Any]]:
    limit_sql = f" limit {int(limit)}" if limit else ""
    return clean_records(rows(
        conn,
        f"""
        select coalesce(nullif({column}, ''), '{NOT_PROVIDED}') as name, count(*)::integer as value
        from {FACT}{where}
        group by 1
        order by value desc, name
        {limit_sql}
        """,
        params,
    ))


@app.get("/v1/health")
def health() -> dict[str, Any]:
    if not WAREHOUSE_PATH.exists():
        return {"ok": False, "warehouseReady": False}
    with connect() as conn:
        count = scalar(conn, f"select count(*) from {FACT}")
    return {"ok": True, "warehouseReady": True, "tickets": count}


@app.get("/v1/metadata", dependencies=[Depends(require_analytics_token)])
def metadata() -> dict[str, Any]:
    stat = WAREHOUSE_PATH.stat()
    with connect() as conn:
        return {
            "warehousePath": WAREHOUSE_PATH.name,
            "warehouseUpdatedAt": datetime.fromtimestamp(stat.st_mtime).isoformat(),
            "ticketCount": scalar(conn, f"select count(*) from {FACT}"),
            "projectCount": scalar(conn, f"select count(distinct project_name) from {FACT}"),
        }


@app.get("/v1/filters", dependencies=[Depends(require_analytics_token)])
def filters() -> dict[str, list[str]]:
    output: dict[str, list[str]] = {}
    with connect() as conn:
        for api_name, column in FILTER_COLUMNS.items():
            values = conn.execute(
                f"select distinct {column} from {FACT} where {column} <> '' order by 1"
            ).fetchall()
            output[api_name] = [value[0] for value in values]
        output["fichiers"] = ["Oui", "Non"]
    return output


@app.get(
    "/v1/predictions/resolution-delay/options",
    dependencies=[Depends(require_analytics_token)],
)
def resolution_delay_prediction_options() -> dict[str, Any]:
    with connect() as conn:
        return eligible_scopes(conn)


@app.post(
    "/v1/predictions/resolution-delay",
    dependencies=[Depends(require_analytics_token)],
)
def resolution_delay_prediction(request: ResolutionDelayPredictionRequest) -> dict[str, Any]:
    scope_type = request.scope.type
    started = time.perf_counter()
    status = "success"
    try:
        result = build_forecast(
            WAREHOUSE_PATH,
            scope_type=scope_type,
            scope_value=request.scope.value,
            horizon_months=request.horizonMonths,
        )
        model = result["model"]
        FORECAST_MODEL_SELECTIONS.labels(
            forecast_type="resolution_delay",
            scope_type=scope_type,
            model=model["name"],
        ).inc()
        FORECAST_BACKTEST_MAE.labels(
            forecast_type="resolution_delay",
            scope_type=scope_type,
            model=model["name"],
        ).observe(
            model["backtestMaeDays"]
        )
        return result
    except ForecastUnavailableError as exc:
        status = "unavailable"
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception:
        status = "error"
        raise
    finally:
        FORECAST_REQUESTS.labels(
            forecast_type="resolution_delay",
            scope_type=scope_type,
            status=status,
        ).inc()
        FORECAST_DURATION.labels(
            forecast_type="resolution_delay",
            scope_type=scope_type,
        ).observe(time.perf_counter() - started)


@app.get(
    "/v1/predictions/ticket-volume/options",
    dependencies=[Depends(require_analytics_token)],
)
def ticket_volume_prediction_options() -> dict[str, Any]:
    with connect() as conn:
        return eligible_ticket_volume_scopes(conn)


@app.post(
    "/v1/predictions/ticket-volume",
    dependencies=[Depends(require_analytics_token)],
)
def ticket_volume_prediction(request: TicketVolumePredictionRequest) -> dict[str, Any]:
    scope_type = request.scope.type
    started = time.perf_counter()
    status = "success"
    try:
        result = build_ticket_volume_forecast(
            WAREHOUSE_PATH,
            scope_type=scope_type,
            scope_value=request.scope.value,
            horizon_months=request.horizonMonths,
        )
        model = result["model"]
        FORECAST_MODEL_SELECTIONS.labels(
            forecast_type="ticket_volume",
            scope_type=scope_type,
            model=model["name"],
        ).inc()
        FORECAST_BACKTEST_MAE.labels(
            forecast_type="ticket_volume",
            scope_type=scope_type,
            model=model["name"],
        ).observe(model["backtestMaeTickets"])
        return result
    except ForecastUnavailableError as exc:
        status = "unavailable"
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception:
        status = "error"
        raise
    finally:
        FORECAST_REQUESTS.labels(
            forecast_type="ticket_volume",
            scope_type=scope_type,
            status=status,
        ).inc()
        FORECAST_DURATION.labels(
            forecast_type="ticket_volume",
            scope_type=scope_type,
        ).observe(time.perf_counter() - started)


@app.post("/v1/dashboard/query", dependencies=[Depends(require_analytics_token)])
def dashboard(request: FilterRequest) -> dict[str, Any]:
    where, params = build_where(request.filters)
    with connect() as conn:
        kpi = rows(
            conn,
            f"""
            select
              count(*)::integer as totalTickets,
              count(distinct project_name)::integer as projectsWithTickets,
              round(avg({duration_days_sql("resolved_date")}), 1) as avgResolvedDays,
              round(avg({duration_days_sql("closed_date")}), 1) as avgClosedDays
            from {FACT}{where}
            """,
            params,
        )[0]
        global_kpi = rows(
            conn,
            f"""
            select
              count(*)::integer as globalTickets,
              count(distinct project_name)::integer as globalProjects,
              round(avg({duration_days_sql("resolved_date")}), 1) as globalAvgResolvedDays,
              round(avg({duration_days_sql("closed_date")}), 1) as globalAvgClosedDays
            from {FACT}
            """,
        )[0]

        years = [row[0] for row in conn.execute(
            f"select distinct created_year from {FACT}{where} and created_year is not null order by 1"
            if where else f"select distinct created_year from {FACT} where created_year is not null order by 1",
            params,
        ).fetchall()]

        charts = {
            "priority": dimension_query(conn, "priority", where, params),
            "project": dimension_query(conn, "project_name", where, params),
            "subject": dimension_query(conn, "subject", where, params, 20),
            "team": dimension_query(conn, "team", where, params),
            "source": dimension_query(conn, "source", where, params),
            "status": dimension_query(conn, "status", where, params),
            "type": dimension_query(conn, "type", where, params),
            "satisfaction": dimension_query(conn, "satisfaction", where, params),
            "author": dimension_query(conn, "author", where, params, 20),
            "assignee": dimension_query(conn, "assignee", where, params, 20),
            "attachments": clean_records(rows(
                conn,
                f"""
                select case when has_attachment then 'Avec fichiers' else 'Sans fichiers' end as name,
                       count(*)::integer as value
                from {FACT}{where}
                group by 1 order by 1
                """,
                params,
            )),
            "monthly": clean_records(rows(
                conn,
                f"""
                select created_month::integer as month, count(*)::integer as value
                from {FACT}{where}
                group by 1 order by 1
                """,
                params,
            )),
            "monthlyTrend": clean_records(rows(
                conn,
                f"""
                select date_trunc('month', created_date) as period,
                       count(*)::integer as value
                from {FACT}{where}
                group by 1
                order by 1
                """,
                params,
            )),
            "technologyByYear": clean_records(rows(
                conn,
                f"""
                select coalesce(nullif(technology, ''), '{NOT_PROVIDED}') as name,
                       created_year::integer as year, count(*)::integer as value
                from {FACT}{where}
                group by 1, 2 order by 1, 2
                """,
                params,
            )),
            "trackerByYear": clean_records(rows(
                conn,
                f"""
                select coalesce(nullif(tracker, ''), '{NOT_PROVIDED}') as name,
                       created_year::integer as year, count(*)::integer as value
                from {FACT}{where}
                group by 1, 2 order by 1, 2
                """,
                params,
            )),
            "avgClosedByYear": clean_records(rows(
                conn,
                f"""
                select created_year::integer as year,
                       round(avg({duration_days_sql("closed_date")}), 1) as value
                from {FACT}{where}
                group by 1 order by 1
                """,
                params,
            )),
            "avgResolvedByYear": clean_records(rows(
                conn,
                f"""
                select created_year::integer as year,
                       round(avg({duration_days_sql("resolved_date")}), 1) as value
                from {FACT}{where}
                group by 1 order by 1
                """,
                params,
            )),
        }

    return {"kpis": {**global_kpi, **kpi}, "charts": charts, "years": years}


@app.post("/v1/tickets/search", dependencies=[Depends(require_analytics_token)])
def ticket_search(request: TicketSearchRequest) -> dict[str, Any]:
    where, params = build_where(request.filters)
    if request.search:
        search_columns = [
            "cast(id as varchar)",
            "subject",
            "project_name",
            "type",
            "tracker",
            "source",
            "team",
            "author",
            "assignee",
            "status",
            "priority",
        ]
        search_clause = "(" + " or ".join(f"coalesce({column}, '') ilike ?" for column in search_columns) + ")"
        where = f"{where} {'and' if where else 'where'} {search_clause}"
        term = f"%{request.search}%"
        params.extend([term] * len(search_columns))

    direction = "asc" if request.sortDirection.lower() == "asc" else "desc"
    sort_column = safe_sort_column(request.sortBy)
    offset = (request.page - 1) * request.pageSize

    with connect() as conn:
        total = scalar(conn, f"select count(*) from {FACT}{where}", params)
        data = rows(
            conn,
            f"""
            select id, project_name as project, subject, type, tracker, source, team,
                   author, assignee, status, priority, created_date as createdDate
            from {FACT}{where}
            order by {sort_column} {direction}, id
            limit ? offset ?
            """,
            [*params, request.pageSize, offset],
        )
    return {
        "items": clean_records(data),
        "page": request.page,
        "pageSize": request.pageSize,
        "total": total,
        "totalPages": math.ceil(total / request.pageSize) if total else 0,
    }


@app.get("/v1/tickets/{ticket_id}", dependencies=[Depends(require_analytics_token)])
def ticket_detail(ticket_id: int) -> dict[str, Any]:
    with connect() as conn:
        data = rows(conn, f"select * from {FACT} where id = ?", [ticket_id])
    if not data:
        raise HTTPException(status_code=404, detail="Ticket not found")
    return clean_records(data)[0]


TOKEN_RE = re.compile(r"[a-z0-9]{2,}")


def tokenize(value: str) -> list[str]:
    return TOKEN_RE.findall(value.lower())


def cosine(a: Counter[str], b: Counter[str]) -> float:
    dot = sum(value * b.get(key, 0) for key, value in a.items())
    mag_a = math.sqrt(sum(value * value for value in a.values()))
    mag_b = math.sqrt(sum(value * value for value in b.values()))
    return dot / (mag_a * mag_b) if mag_a and mag_b else 0.0


@app.post("/v1/similarity/{ticket_id}", dependencies=[Depends(require_analytics_token)])
def similarity(ticket_id: int, request: SimilarityRequest) -> dict[str, Any]:
    where, params = build_where(request.filters)
    with connect() as conn:
        candidates = rows(
            conn,
            f"""
            select id, subject, description, type, tracker, project_name, status, priority, team,
                   created_year, created_month, age_hours
            from {FACT}{where}
            """,
            params,
        )
    reference = next((item for item in candidates if str(item["id"]) == str(ticket_id)), None)
    if not reference:
        raise HTTPException(status_code=404, detail="Reference ticket not found in filtered data")

    def text(item: dict[str, Any]) -> str:
        return " ".join(
            str(item.get(key) or "")
            for key in ("subject", "description", "type", "tracker", "project_name")
        )

    ref_vector = Counter(tokenize(text(reference)))
    scored: list[dict[str, Any]] = []
    distances: list[float] = []
    for item in candidates:
        if str(item["id"]) == str(ticket_id):
            continue
        distance = math.sqrt(
            (float(reference.get("created_year") or 0) - float(item.get("created_year") or 0)) ** 2
            + (float(reference.get("created_month") or 0) - float(item.get("created_month") or 0)) ** 2
            + (float(reference.get("age_hours") or 0) - float(item.get("age_hours") or 0)) ** 2
        )
        distances.append(distance)
        scored.append({"ticket": item, "textSimilarity": cosine(ref_vector, Counter(tokenize(text(item)))), "numDistance": distance})

    max_distance = max(distances, default=1.0) or 1.0
    for item in scored:
        item["combinedScore"] = 0.7 * item["textSimilarity"] + 0.3 * (1 - item["numDistance"] / max_distance)
    scored.sort(key=lambda item: item["combinedScore"], reverse=True)

    output = []
    for rank, item in enumerate(scored[: request.topN], start=1):
        ticket = item["ticket"]
        differences = []
        similarities = []
        for label, key in (("Projet", "project_name"), ("Priorite", "priority"), ("Statut", "status"), ("Equipe", "team"), ("Type", "type")):
            reference_value = reference.get(key) or NOT_PROVIDED
            ticket_value = ticket.get(key) or NOT_PROVIDED
            if reference_value == ticket_value:
                similarities.append(f"{label}: {reference_value}")
            else:
                differences.append(f"{label}: {reference_value} != {ticket_value}")
        output.append({
            "idA": str(ticket_id),
            "idB": str(ticket["id"]),
            "subjectA": reference["subject"],
            "subjectB": ticket["subject"],
            "statusB": ticket["status"],
            "textSimilarity": item["textSimilarity"],
            "numDistance": item["numDistance"],
            "combinedScore": item["combinedScore"],
            "similarities": similarities,
            "differences": differences,
            "rank": rank,
        })
    return {"reference": {"id": str(ticket_id), "subject": reference["subject"]}, "results": output}


@app.post("/v1/ai/context", dependencies=[Depends(require_analytics_token)])
def ai_context(request: FilterRequest) -> dict[str, str]:
    dashboard_data = dashboard(request)
    kpis = dashboard_data["kpis"]
    charts = dashboard_data["charts"]

    lines = [
        "## Resume du dataset",
        f"- Total tickets: {kpis['globalTickets']}",
        f"- Tickets filtres: {kpis['totalTickets']}",
        f"- Projets filtres: {kpis['projectsWithTickets']}",
        f"- Delai moyen de cloture: {kpis['avgClosedDays']} jours",
        "",
        "## Top projets",
    ]
    lines.extend(f"- {item['name']}: {item['value']}" for item in charts["project"][:10])
    lines.append("\n## Par statut")
    lines.extend(f"- {item['name']}: {item['value']}" for item in charts["status"])
    lines.append("\n## Par priorite")
    lines.extend(f"- {item['name']}: {item['value']}" for item in charts["priority"])
    lines.append("\n## Par equipe")
    lines.extend(f"- {item['name']}: {item['value']}" for item in charts["team"][:10])
    return {"summary": "\n".join(lines)}


@app.get("/v1/quality", dependencies=[Depends(require_analytics_token)])
def quality(limit: int = Query(default=50, ge=1, le=200)) -> dict[str, Any]:
    with connect() as conn:
        summary = rows(
            conn,
            """
            select field_name,
                   sum(ticket_count)::integer as ticketCount,
                   sum(mapped_count)::integer as mappedCount,
                   sum(source_empty_count)::integer as sourceEmptyCount,
                   sum(source_absent_count)::integer as sourceAbsentCount,
                   sum(mapping_failure_count)::integer as mappingFailureCount,
                   sum(conflict_count)::integer as conflictCount,
                   round(100.0 * sum(mapped_count) / nullif(sum(ticket_count), 0), 2) as coveragePct
            from analytics.v_mapping_quality
            group by field_name
            order by field_name
            """,
        )
        examples = rows(
            conn,
            """
            select id, project_name as project, tracker, subject, field_name as fieldName,
                   quality_status as qualityStatus
            from analytics.v_mapping_issues
            order by quality_status desc, id desc
            limit ?
            """,
            [limit],
        )
        format_issue_count = scalar(conn, "select count(*) from analytics.v_mapping_format_issues")
        format_examples = rows(
            conn,
            """
            select id, project_name as project, tracker, subject,
                   field_name as fieldName, source_value as sourceValue,
                   issue_type as issueType
            from analytics.v_mapping_format_issues
            order by id desc
            limit ?
            """,
            [limit],
        )
    return {
        "warehouseUpdatedAt": datetime.fromtimestamp(WAREHOUSE_PATH.stat().st_mtime).isoformat(),
        "summary": clean_records(summary),
        "examples": clean_records(examples),
        "formatIssueCount": format_issue_count,
        "formatExamples": clean_records(format_examples),
    }
