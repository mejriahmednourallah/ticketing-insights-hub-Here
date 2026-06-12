from analytics_service.query import build_where, safe_sort_column


def test_build_where_parameterizes_filters() -> None:
    where, params = build_where({
        "project": "Portal",
        "fichiers": "Oui",
        "dateFrom": "2026-01-01",
        "dateTo": "2026-06-01",
    })

    assert "project_name = ?" in where
    assert "has_attachment = true" in where
    assert "created_date >= cast(? as date)" in where
    assert params == ["Portal", "2026-01-01", "2026-06-01"]


def test_sort_column_uses_allowlist() -> None:
    assert safe_sort_column("subject") == "subject"
    assert safe_sort_column("drop table") == "created_date"
