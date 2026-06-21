param(
  [string]$ProjectRef = "wxfssqmuubdnaxtqbiba",
  [string]$SupabaseUrl = "https://wxfssqmuubdnaxtqbiba.supabase.co",
  [switch]$SkipReset,
  [switch]$SkipSeed,
  [switch]$Force,
  [int]$MaxBatchAttempts = 100,
  [int]$BatchSleepSeconds = 5
)

$ErrorActionPreference = "Stop"

function Require-Env {
  param([string]$Name)
  $value = [Environment]::GetEnvironmentVariable($Name)
  if ([string]::IsNullOrWhiteSpace($value)) {
    throw "Missing required environment variable: $Name"
  }
  return $value.Trim()
}

function Optional-Env {
  param([string]$Name)
  $value = [Environment]::GetEnvironmentVariable($Name)
  if ([string]::IsNullOrWhiteSpace($value)) {
    return $null
  }
  return $value.Trim()
}

function Reject-Placeholder {
  param([string]$Name, [string]$Value)
  if ($Value -match '^(PASTE_|CHANGE_ME|replace_with_|your_)') {
    throw "Environment variable $Name is still a placeholder."
  }
}

function Run-Supabase {
  param([string[]]$Arguments)
  $displayArguments = $Arguments
  if ($Arguments.Length -ge 2 -and $Arguments[0] -eq "secrets" -and $Arguments[1] -eq "set") {
    $displayArguments = @("secrets", "set", "--project-ref", $ProjectRef, "[redacted]")
  }
  if (Get-Command supabase -ErrorAction SilentlyContinue) {
    Write-Host "> supabase $($displayArguments -join ' ')" -ForegroundColor Cyan
    & supabase @Arguments
  } else {
    Write-Host "> npx supabase@latest $($displayArguments -join ' ')" -ForegroundColor Cyan
    & npx supabase@latest @Arguments
  }
  if ($LASTEXITCODE -ne 0) {
    throw "Supabase command failed: $($Arguments -join ' ')"
  }
}

function Invoke-Ingest {
  param([hashtable]$Payload, [string]$ServiceRoleKey)
  $headers = @{
    Authorization = "Bearer $ServiceRoleKey"
    "Content-Type" = "application/json"
  }
  $body = $Payload | ConvertTo-Json -Compress
  return Invoke-RestMethod `
    -Uri "$SupabaseUrl/functions/v1/redmine-ingest" `
    -Method Post `
    -Headers $headers `
    -Body $body
}

if (-not (Get-Command supabase -ErrorAction SilentlyContinue) -and -not (Get-Command npx -ErrorAction SilentlyContinue)) {
  throw "Supabase CLI is not on PATH and npx is unavailable. Install the Supabase CLI first, then rerun this script."
}

$env:SUPABASE_ACCESS_TOKEN = Require-Env "SUPABASE_ACCESS_TOKEN"
$env:SUPABASE_DB_PASSWORD = Require-Env "SUPABASE_DB_PASSWORD"
$serviceRoleKey = Require-Env "SUPABASE_SERVICE_ROLE_KEY"
$anonKey = Require-Env "SUPABASE_ANON_KEY"
$redmineUrl = Require-Env "REDMINE_URL"
$redmineApiKey = Require-Env "REDMINE_API_KEY"
$lovableKey = Optional-Env "LOVABLE_API_KEY"
$groqKey = Optional-Env "GROQ_API_KEY"
$aiProviderOrder = Optional-Env "AI_PROVIDER_ORDER"
if (-not $aiProviderOrder) {
  $aiProviderOrder = "lovable,groq"
}
if (-not $lovableKey -and -not $groqKey) {
  throw "Set at least one AI key: LOVABLE_API_KEY or GROQ_API_KEY."
}

Reject-Placeholder "SUPABASE_ACCESS_TOKEN" $env:SUPABASE_ACCESS_TOKEN
Reject-Placeholder "SUPABASE_DB_PASSWORD" $env:SUPABASE_DB_PASSWORD
Reject-Placeholder "SUPABASE_SERVICE_ROLE_KEY" $serviceRoleKey
Reject-Placeholder "SUPABASE_ANON_KEY" $anonKey
Reject-Placeholder "REDMINE_URL" $redmineUrl
Reject-Placeholder "REDMINE_API_KEY" $redmineApiKey
if ($lovableKey) {
  Reject-Placeholder "LOVABLE_API_KEY" $lovableKey
}
if ($groqKey) {
  Reject-Placeholder "GROQ_API_KEY" $groqKey
}

Write-Host "Target Supabase project: $ProjectRef" -ForegroundColor Yellow
Write-Host "Target Supabase URL:     $SupabaseUrl" -ForegroundColor Yellow
if (-not $Force) {
  $confirmation = Read-Host "Type the project ref to continue"
  if ($confirmation -ne $ProjectRef) {
    throw "Confirmation did not match $ProjectRef."
  }
}

Run-Supabase @("link", "--project-ref", $ProjectRef)
Run-Supabase @("migration", "list", "--linked")

if (-not $SkipReset) {
  Write-Host "Resetting linked Supabase database because this deployment targets a fresh project." -ForegroundColor Yellow
  Run-Supabase @("db", "reset", "--linked", "--yes")
}

Run-Supabase @("db", "push")
Run-Supabase @("functions", "deploy", "chat", "--project-ref", $ProjectRef)
Run-Supabase @("functions", "deploy", "redmine-ingest", "--project-ref", $ProjectRef)

$secretArgs = @(
  "secrets", "set",
  "--project-ref", $ProjectRef,
  "REDMINE_URL=$redmineUrl",
  "REDMINE_API_KEY=$redmineApiKey",
  "AI_PROVIDER_ORDER=$aiProviderOrder"
)
if ($lovableKey) {
  $secretArgs += "LOVABLE_API_KEY=$lovableKey"
}
if ($groqKey) {
  $secretArgs += "GROQ_API_KEY=$groqKey"
}
Run-Supabase $secretArgs

if (-not $SkipSeed) {
  Write-Host "Starting initial Redmine batch seed." -ForegroundColor Yellow
  $first = Invoke-Ingest -Payload @{ mode = "reset"; resetCursor = $true } -ServiceRoleKey $serviceRoleKey
  Write-Host ("reset: projectsProcessed={0} nextOffset={1} issuesUpserted={2} cycleCompleted={3}" -f `
    $first.projectsProcessed, $first.nextOffset, $first.issuesUpserted, $first.cycleCompleted)

  $completed = [bool]$first.cycleCompleted
  $attempt = 0
  while (-not $completed -and $attempt -lt $MaxBatchAttempts) {
    $attempt += 1
    Start-Sleep -Seconds $BatchSleepSeconds
    $result = Invoke-Ingest -Payload @{ mode = "batch" } -ServiceRoleKey $serviceRoleKey
    Write-Host ("batch {0}: projectsProcessed={1} nextOffset={2} issuesUpserted={3} cycleCompleted={4}" -f `
      $attempt, $result.projectsProcessed, $result.nextOffset, $result.issuesUpserted, $result.cycleCompleted)
    $completed = [bool]$result.cycleCompleted
  }

  if (-not $completed) {
    throw "Initial seed did not reach cycleCompleted=true after $MaxBatchAttempts batch attempts."
  }
}

Write-Host ""
Write-Host "Supabase cloud deployment complete." -ForegroundColor Green
Write-Host "Verify seed state with:"
Write-Host "select count(*) from public.redmine_projects;"
Write-Host "select count(*) from public.redmine_issues;"
Write-Host "select * from public.sync_state where source = 'redmine';"
Write-Host "select status, count(*) from public.sync_runs group by status;"
