SELECT COUNT(*) AS project_count FROM public.redmine_projects;
SELECT COUNT(*) AS issue_count FROM public.redmine_issues;
SELECT COUNT(*) AS sla_plan_count FROM public.sla_plan_config;

SELECT COUNT(*) AS stg_project_count FROM staging.stg_projects;
SELECT COUNT(*) AS stg_issue_count FROM staging.stg_issues;

SELECT COUNT(*) AS daily_volume_count FROM marts.mart_daily_volume;
SELECT COUNT(*) AS team_velocity_count FROM marts.mart_team_velocity;
SELECT COUNT(*) AS sla_compliance_count FROM marts.mart_sla_compliance;
SELECT COUNT(*) AS age_bands_count FROM marts.mart_age_bands;
SELECT COUNT(*) AS similarity_features_count FROM marts.mart_similarity_features;

SELECT COUNT(*) AS dashboard_count FROM analytics.v_dashboard;
SELECT COUNT(*) AS team_kpis_count FROM analytics.v_team_kpis;
SELECT COUNT(*) AS backlog_health_count FROM analytics.v_backlog_health;
