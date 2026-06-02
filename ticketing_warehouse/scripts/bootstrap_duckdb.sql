INSTALL postgres;
LOAD postgres;

CREATE SCHEMA IF NOT EXISTS public;

ATTACH 'host=127.0.0.1 port=54322 dbname=postgres user=postgres password=postgres'
AS supabase_db
(TYPE postgres);

DROP TABLE IF EXISTS public.redmine_projects;
CREATE TABLE public.redmine_projects AS
SELECT * FROM supabase_db.public.redmine_projects;

DROP TABLE IF EXISTS public.redmine_issues;
CREATE TABLE public.redmine_issues AS
SELECT * FROM supabase_db.public.redmine_issues;

DROP TABLE IF EXISTS public.sla_plan_config;
CREATE TABLE public.sla_plan_config AS
SELECT * FROM supabase_db.public.sla_plan_config;
