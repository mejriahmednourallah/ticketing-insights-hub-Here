#!/usr/bin/env python3
"""
build_warehouse.py — Build all DuckDB analytics views from Postgres data.
Usage: python3 build_warehouse.py /path/to/warehouse.duckdb
"""
import sys
import duckdb

db_path = sys.argv[1]
conn = duckdb.connect(db_path)

# ── Staging ────────────────────────────────────────────────────────────────────
conn.execute("CREATE SCHEMA IF NOT EXISTS staging")
conn.execute("CREATE OR REPLACE VIEW staging.stg_projects AS SELECT * FROM public.redmine_projects")
conn.execute("""
CREATE OR REPLACE VIEW staging.stg_issues AS
SELECT a.*, b.name AS project_name
FROM public.redmine_issues a
JOIN public.redmine_projects b ON a.project_redmine_id = b.redmine_id
""")

# ── Marts ──────────────────────────────────────────────────────────────────────
conn.execute("CREATE SCHEMA IF NOT EXISTS marts")
conn.execute("""
CREATE OR REPLACE VIEW marts.mart_daily_volume AS
SELECT DATE(created_on) AS day, COUNT(*) AS ticket_count
FROM staging.stg_issues GROUP BY 1 ORDER BY 1
""")
conn.execute("""
CREATE OR REPLACE VIEW marts.mart_age_bands AS
SELECT project_name, team,
  CASE WHEN closed_on IS NULL AND created_on < NOW() - INTERVAL '30 days' THEN '30+'
       WHEN closed_on IS NULL AND created_on < NOW() - INTERVAL '7 days' THEN '7-30'
       ELSE 'Current' END AS age_band,
  COUNT(*) AS ticket_count
FROM staging.stg_issues GROUP BY 1, 2, 3
""")

# ── Analytics ──────────────────────────────────────────────────────────────────
conn.execute("CREATE SCHEMA IF NOT EXISTS analytics")

# Main fact table
conn.execute("""
CREATE OR REPLACE VIEW analytics.fct_tickets AS SELECT
  i.redmine_id::VARCHAR AS id,
  i.project_name,
  i.tracker_name AS tracker,
  i.status_name AS status,
  i.priority_name AS priority,
  i.subject,
  i.author_name AS author,
  i.assigned_to_name AS assignee,
  i.created_on AS created_date,
  i.closed_on AS closed_date,
  CASE WHEN i.resolved_on IS NOT NULL AND i.resolved_on >= i.created_on THEN i.resolved_on ELSE NULL END AS resolved_date,
  i.team, i.technology, i.type, i.satisfaction, i.source,
  i.team, i.technology, i.type, i.satisfaction, i.source,
  i.fichiers, i.has_attachment, i.canal, i.segment_client, i.region,
  i.reopened, i.sla_plan,
  i.nature, i.intervention_type,
  EXTRACT(YEAR FROM i.created_on)::INT AS created_year,
  EXTRACT(MONTH FROM i.created_on)::INT AS created_month,
  EXTRACT(EPOCH FROM (COALESCE(i.closed_on, i.created_on) - i.created_on)) / 3600.0 AS age_hours,
  COALESCE(EXTRACT(EPOCH FROM (COALESCE(i.closed_on, i.resolved_on) - i.created_on)) / 3600.0, 0) AS age_hours
FROM staging.stg_issues i
""")

# Simple views that the analytics API queries
conn.execute("""
CREATE OR REPLACE VIEW analytics.v_dashboard AS
SELECT
  project_name, COUNT(*) AS total_issues,
  COUNT(*) FILTER (WHERE status_name NOT IN ('Fermé','Resolu')) AS open_issues,
  COUNT(*) FILTER (WHERE status_name IN ('Fermé','Resolu')) AS closed_issues,
  AVG(CASE WHEN closed_on IS NOT NULL
    THEN EXTRACT(EPOCH FROM (closed_on - created_on))/3600 END) AS avg_resolution_hours
FROM staging.stg_issues GROUP BY project_name
""")

conn.execute("""
CREATE OR REPLACE VIEW analytics.v_team_kpis AS
SELECT team, project_name, COUNT(*) AS total_opened
FROM staging.stg_issues GROUP BY team, project_name
""")

conn.execute("""
CREATE OR REPLACE VIEW analytics.v_mapping_quality AS
SELECT 'team' AS field_name, COUNT(*) AS ticket_count,
  COUNT(*) FILTER (WHERE i.team <> '') AS mapped_count,
  COUNT(*) FILTER (WHERE i.team = '') AS source_empty_count,
  0::BIGINT AS source_absent_count, 0::BIGINT AS mapping_failure_count,
  0::BIGINT AS conflict_count,
  ROUND(100.0 * COUNT(*) FILTER (WHERE i.team <> '') / NULLIF(COUNT(*), 0), 2) AS coverage_pct
FROM staging.stg_issues i
UNION ALL SELECT 'technology', COUNT(*),
  COUNT(*) FILTER (WHERE i.technology <> ''), COUNT(*) FILTER (WHERE i.technology = ''), 0, 0, 0,
  ROUND(100.0 * COUNT(*) FILTER (WHERE i.technology <> '') / NULLIF(COUNT(*), 0), 2)
FROM staging.stg_issues i
UNION ALL SELECT 'source', COUNT(*),
  COUNT(*) FILTER (WHERE i.source <> ''), COUNT(*) FILTER (WHERE i.source = ''), 0, 0, 0,
  ROUND(100.0 * COUNT(*) FILTER (WHERE i.source <> '') / NULLIF(COUNT(*), 0), 2)
FROM staging.stg_issues i
UNION ALL SELECT 'satisfaction', COUNT(*),
  COUNT(*) FILTER (WHERE i.satisfaction <> ''), COUNT(*) FILTER (WHERE i.satisfaction = ''), 0, 0, 0,
  ROUND(100.0 * COUNT(*) FILTER (WHERE i.satisfaction <> '') / NULLIF(COUNT(*), 0), 2)
FROM staging.stg_issues i
""")

conn.execute("""
CREATE OR REPLACE VIEW analytics.v_mapping_issues AS
SELECT redmine_id::INT AS id, project_name, tracker_name AS tracker, subject,
  CASE WHEN team <> '' THEN 'mapped' ELSE 'unmapped' END AS quality_status,
  'team' AS field_name
FROM staging.stg_issues LIMIT 100
""")

conn.execute("""
CREATE OR REPLACE VIEW analytics.v_mapping_format_issues AS
SELECT redmine_id AS id, project_name, tracker_name AS tracker, subject,
  'date' AS field_name, '' AS source_value, 'invalid' AS issue_type
FROM staging.stg_issues
WHERE resolved_on IS NOT NULL AND created_on IS NOT NULL AND resolved_on < created_on LIMIT 50
""")

# v_mapping_quality
conn.execute("""
CREATE OR REPLACE VIEW analytics.v_mapping_quality AS
SELECT 'team' AS field_name, COUNT(*)::BIGINT AS ticket_count,
  COUNT(*) FILTER (WHERE i.team <> '')::BIGINT AS mapped_count,
  COUNT(*) FILTER (WHERE i.team = '')::BIGINT AS source_empty_count,
  CAST(0 AS BIGINT) AS source_absent_count, CAST(0 AS BIGINT) AS mapping_failure_count,
  CAST(0 AS BIGINT) AS conflict_count,
  CAST(ROUND(100.0 * COUNT(*) FILTER (WHERE i.team <> '') / NULLIF(COUNT(*), 0), 2) AS DOUBLE) AS coverage_pct
FROM staging.stg_issues i
UNION ALL SELECT 'technology', COUNT(*)::BIGINT, COUNT(*) FILTER (WHERE i.technology <> '')::BIGINT,
  COUNT(*) FILTER (WHERE i.technology = '')::BIGINT, CAST(0 AS BIGINT), CAST(0 AS BIGINT), CAST(0 AS BIGINT),
  ROUND(100.0 * COUNT(*) FILTER (WHERE i.technology <> '') / NULLIF(COUNT(*), 0), 2)
FROM staging.stg_issues i
UNION ALL SELECT 'source', COUNT(*)::BIGINT, COUNT(*) FILTER (WHERE i.source <> '')::BIGINT,
  COUNT(*) FILTER (WHERE i.source = '')::BIGINT, CAST(0 AS BIGINT), CAST(0 AS BIGINT), CAST(0 AS BIGINT),
  ROUND(100.0 * COUNT(*) FILTER (WHERE i.source <> '') / NULLIF(COUNT(*), 0), 2)
FROM staging.stg_issues i
UNION ALL SELECT 'satisfaction', COUNT(*)::BIGINT, COUNT(*) FILTER (WHERE i.satisfaction <> '')::BIGINT,
  COUNT(*) FILTER (WHERE i.satisfaction = '')::BIGINT, CAST(0 AS BIGINT), CAST(0 AS BIGINT), CAST(0 AS BIGINT),
  ROUND(100.0 * COUNT(*) FILTER (WHERE i.satisfaction <> '') / NULLIF(COUNT(*), 0), 2)
FROM staging.stg_issues i
""")
# v_mapping_issues
conn.execute("""
CREATE OR REPLACE VIEW analytics.v_mapping_issues AS
SELECT redmine_id::INT AS id, project_name, tracker_name AS tracker, subject,
  CASE WHEN team <> '' THEN 'mapped' ELSE 'unmapped' END AS quality_status,
  'team' AS field_name
FROM staging.stg_issues LIMIT 100
""")
# v_mapping_format_issues  
conn.execute("""
CREATE OR REPLACE VIEW analytics.v_mapping_format_issues AS
SELECT redmine_id AS id, project_name, tracker_name AS tracker, subject,
  'date' AS field_name, '' AS source_value, 'invalid' AS issue_type
FROM staging.stg_issues WHERE resolved_on IS NOT NULL AND resolved_on < created_on LIMIT 50
""")
# v_dashboard
conn.execute("""
CREATE OR REPLACE VIEW analytics.v_dashboard AS SELECT project_name,
  COUNT(*) AS total_issues,
  COUNT(*) FILTER (WHERE NOT(status IN ('Fermé','Résolu'))) AS open_issues,
  COUNT(*) FILTER (WHERE status IN ('Fermé','Résolu')) AS closed_issues
FROM analytics.fct_tickets GROUP BY project_name
""")
# v_team_kpis
conn.execute("""
CREATE OR REPLACE VIEW analytics.v_team_kpis AS SELECT team, project_name,
  COUNT(*) AS total_opened FROM analytics.fct_tickets GROUP BY team, project_name
""")
# Verify
r = conn.execute("SELECT COUNT(*) FROM analytics.fct_tickets").fetchone()[0]
v = [x[0] for x in conn.execute("SELECT table_name FROM information_schema.tables WHERE table_schema='analytics'").fetchall()]
print(f'✅ {r} tickets across {len(v)} views: {v}')
conn.close()
