#!/usr/bin/env python3
"""
write_env_local.py — Read deploy/secrets/runtime.env and generate .env.local
for the Supabase edge functions (redmine-ingest + chat).

Usage: python3 write_env_local.py <secrets_file> <output_file>
"""
import sys
import os

secrets_file = sys.argv[1]
env_local = sys.argv[2]

# Read vars from runtime.env
vars_dict = {}
with open(secrets_file) as f:
    for line in f:
        line = line.strip()
        if not line or line.startswith('#'):
            continue
        if '=' in line:
            k, v = line.split('=', 1)
            v = v.strip().strip('"').strip("'")
            vars_dict[k] = v

# Required keys
required = {
    'REDMINE_URL': vars_dict.get('REDMINE_URL'),
    'REDMINE_API_KEY': vars_dict.get('REDMINE_API_KEY'),
    'LOVABLE_API_KEY': vars_dict.get('LOVABLE_API_KEY'),
    'GROQ_API_KEY': vars_dict.get('GROQ_API_KEY'),
}
missing = [k for k, v in required.items() if not v and k != 'LOVABLE_API_KEY' and k != 'GROQ_API_KEY']
if not required['LOVABLE_API_KEY'] and not required['GROQ_API_KEY']:
    missing.append('LOVABLE_API_KEY or GROQ_API_KEY')
if missing:
    print(f'ERROR: Missing required env vars in {secrets_file}: {", ".join(missing)}', file=sys.stderr)
    sys.exit(1)

# Build output dict
output = {
    'REDMINE_URL': required['REDMINE_URL'],
    'REDMINE_API_KEY': required['REDMINE_API_KEY'],
    'REDMINE_PAGE_SIZE': vars_dict.get('REDMINE_PAGE_SIZE', '500'),
    'REDMINE_PROJECT_BATCH_SIZE': vars_dict.get('REDMINE_PROJECT_BATCH_SIZE', '20'),
    'LOVABLE_API_KEY': required['LOVABLE_API_KEY'] or '',
    'GROQ_API_KEY': required['GROQ_API_KEY'] or '',
    'GROQ_MODEL': vars_dict.get('GROQ_MODEL', 'llama-3.3-70b-versatile'),
    'AI_PROVIDER_ORDER': vars_dict.get('AI_PROVIDER_ORDER', 'lovable,groq'),
    'INGEST_SUPABASE_URL': 'http://127.0.0.1:54321',
    'INGEST_SUPABASE_SERVICE_ROLE_KEY': vars_dict.get('SERVICE_ROLE_KEY', ''),
    'REDMINE_FIELD_TEAM': vars_dict.get('REDMINE_FIELD_TEAM', 'Equipe Affectee,team'),
    'REDMINE_FIELD_TECHNOLOGY': vars_dict.get('REDMINE_FIELD_TECHNOLOGY', 'CMS / Framework,technology,technology_used'),
    'REDMINE_FIELD_NATURE': vars_dict.get('REDMINE_FIELD_NATURE', 'Nature,nature'),
    'REDMINE_FIELD_INTERVENTION_TYPE': vars_dict.get('REDMINE_FIELD_INTERVENTION_TYPE', "Type d'intervention,intervention_type"),
    'REDMINE_FIELD_RESOLVED_DATE': vars_dict.get('REDMINE_FIELD_RESOLVED_DATE', 'Date Resolved,resolved_date'),
    'REDMINE_FIELD_SATISFACTION': vars_dict.get('REDMINE_FIELD_SATISFACTION', 'Degre de satisfaction,csat_score,satisfaction'),
    'REDMINE_FIELD_SOURCE': vars_dict.get('REDMINE_FIELD_SOURCE', 'Source,source'),
    'REDMINE_FIELD_CANAL': vars_dict.get('REDMINE_FIELD_CANAL', 'Canal,channel,canal'),
    'REDMINE_FIELD_SEGMENT_CLIENT': vars_dict.get('REDMINE_FIELD_SEGMENT_CLIENT', 'Segment client,customer_segment,segment_client'),
    'REDMINE_FIELD_REGION': vars_dict.get('REDMINE_FIELD_REGION', 'Region,region'),
    'REDMINE_FIELD_REOPENED': vars_dict.get('REDMINE_FIELD_REOPENED', 'Reouvert,reopened'),
    'REDMINE_FIELD_SLA_PLAN': vars_dict.get('REDMINE_FIELD_SLA_PLAN', 'SLA plan,sla_plan'),
}

with open(env_local, 'w') as f:
    for k, v in output.items():
        f.write(f'{k}={v}\n')

print(f'.env.local written ({len(output)} vars)')
