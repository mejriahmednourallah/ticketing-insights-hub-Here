# Dot-source this file before running deploy-supabase-cloud.ps1:
#   . .\scripts\cloud-supabase-env.ps1
#   .\scripts\deploy-supabase-cloud.ps1
#
# Public/derived values are filled in. Replace only PASTE_* values.

$env:SUPABASE_PROJECT_REF = "wxfssqmuubdnaxtqbiba"
$env:SUPABASE_URL = "https://wxfssqmuubdnaxtqbiba.supabase.co"
$env:REDMINE_URL = "https://maintenance.medianet.tn"
$env:AI_PROVIDER_ORDER = "lovable,groq"

$env:SUPABASE_ACCESS_TOKEN = "PASTE_SUPABASE_ACCESS_TOKEN"
$env:SUPABASE_DB_PASSWORD = "PASTE_SUPABASE_DB_PASSWORD"
$env:SUPABASE_SERVICE_ROLE_KEY = "PASTE_SUPABASE_SERVICE_ROLE_KEY"
$env:SUPABASE_ANON_KEY = "PASTE_SUPABASE_ANON_KEY"
$env:REDMINE_API_KEY = "PASTE_REDMINE_API_KEY"
$env:LOVABLE_API_KEY = "PASTE_LOVABLE_API_KEY"
$env:GROQ_API_KEY = ""

Write-Host "Loaded public defaults for Supabase project $env:SUPABASE_PROJECT_REF." -ForegroundColor Green
Write-Host "Replace every PASTE_* value before running deploy-supabase-cloud.ps1." -ForegroundColor Yellow
