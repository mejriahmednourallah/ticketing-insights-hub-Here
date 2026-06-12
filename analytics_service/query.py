from __future__ import annotations

from typing import Any


FILTER_COLUMNS = {
    "project": "project_name",
    "technology": "technology",
    "priority": "priority",
    "team": "team",
    "tracker": "tracker",
    "source": "source",
    "status": "status",
    "type": "type",
    "author": "author",
    "assignee": "assignee",
    "subject": "subject",
    "satisfaction": "satisfaction",
    "canal": "canal",
    "segmentClient": "segment_client",
    "region": "region",
    "reopened": "reopened",
    "slaPlan": "sla_plan",
}

SORT_COLUMNS = {
    "id": "id",
    "project": "project_name",
    "subject": "subject",
    "status": "status",
    "priority": "priority",
    "createdDate": "created_date",
}


def build_where(filters: dict[str, Any] | None) -> tuple[str, list[Any]]:
    clauses: list[str] = []
    params: list[Any] = []
    filters = filters or {}

    for key, column in FILTER_COLUMNS.items():
        value = filters.get(key)
        if value is None or value == "":
            continue
        clauses.append(f"{column} = ?")
        params.append(value)

    attachments = filters.get("fichiers")
    if attachments == "Oui":
        clauses.append("has_attachment = true")
    elif attachments == "Non":
        clauses.append("has_attachment = false")

    date_from = filters.get("dateFrom")
    if date_from:
        clauses.append("created_date >= cast(? as date)")
        params.append(date_from)

    date_to = filters.get("dateTo")
    if date_to:
        clauses.append("created_date <= cast(? as date)")
        params.append(date_to)

    return (" where " + " and ".join(clauses)) if clauses else "", params


def safe_sort_column(value: str | None) -> str:
    return SORT_COLUMNS.get(value or "", "created_date")
