param(
  [switch]$NoCache,
  [switch]$SkipIngest,
  [switch]$DeployFunctions,
  [int]$MaxBatches = 20
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Write-Step([string]$Message) {
  Write-Host "`n==> $Message" -ForegroundColor Cyan
}

function Parse-DotEnv([string]$Path) {
  $map = @{}
  foreach ($line in Get-Content $Path) {
    if ($line -match '^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$') {
      $key = $matches[1]
      $value = $matches[2].Trim()
      if (
        ($value.StartsWith('"') -and $value.EndsWith('"')) -or
        ($value.StartsWith("'") -and $value.EndsWith("'"))
      ) {
        $value = $value.Substring(1, $value.Length - 2)
      }
      $map[$key] = $value
    }
  }
  return $map
}

function Require-Command([string]$CommandName) {
  $cmd = Get-Command $CommandName -ErrorAction SilentlyContinue
  if (-not $cmd) {
    throw "Missing required command: $CommandName"
  }
}

function Run-SupabaseCli([string[]]$Args) {
  & npm exec --package supabase@latest -- supabase @Args
  if ($LASTEXITCODE -ne 0) {
    throw "Supabase CLI command failed: supabase $($Args -join ' ')"
  }
}

function First-Row($Value) {
  if ($null -eq $Value) { return $null }
  if ($Value -is [System.Array]) {
    if ($Value.Count -eq 0) { return $null }
    return $Value[0]
  }
  return $Value
}

if ($MaxBatches -le 0) {
  throw 'MaxBatches must be > 0'
}

$root = Resolve-Path (Join-Path $PSScriptRoot '..')
Push-Location $root

try {
  Require-Command 'docker'
  Require-Command 'npm'

  if (-not (Test-Path '.env')) {
    throw 'Missing .env. Copy .env.example to .env and fill required values first.'
  }

  Write-Step 'Loading .env into process environment'
  $envMap = Parse-DotEnv '.env'
  foreach ($entry in $envMap.GetEnumerator()) {
    [System.Environment]::SetEnvironmentVariable([string]$entry.Key, [string]$entry.Value, 'Process')
  }

  if (-not $SkipIngest) {
    foreach ($required in @('REDMINE_URL', 'REDMINE_API_KEY')) {
      if (-not $envMap.ContainsKey($required) -or [string]::IsNullOrWhiteSpace($envMap[$required])) {
        throw "Missing required env var in .env: $required"
      }
    }
  }

  Write-Step 'Starting local Supabase stack (images are pulled automatically when missing)'
  Run-SupabaseCli @('start')

  Write-Step 'Reading local Supabase runtime values'
  $statusOutput = & npm exec --package supabase@latest -- supabase status -o env
  if ($LASTEXITCODE -ne 0) {
    throw 'Failed to read supabase status -o env'
  }

  $statusVars = @{}
  foreach ($line in ($statusOutput -split "`r?`n")) {
    if ($line -match '^\s*([A-Z0-9_]+)=(.*)$') {
      $statusVars[$matches[1]] = $matches[2]
    }
  }

  $apiUrl = $statusVars['API_URL']
  $anonKey = $statusVars['ANON_KEY']
  $serviceRoleKey = $statusVars['SERVICE_ROLE_KEY']

  if ([string]::IsNullOrWhiteSpace($apiUrl) -or [string]::IsNullOrWhiteSpace($anonKey) -or [string]::IsNullOrWhiteSpace($serviceRoleKey)) {
    throw 'Could not parse API_URL, ANON_KEY, or SERVICE_ROLE_KEY from supabase status -o env'
  }

  Write-Step 'Generating .env.local.runtime for private runtime values'
  @(
    "SUPABASE_URL=$apiUrl"
    "SUPABASE_FUNCTIONS_URL=$apiUrl/functions/v1"
    "SUPABASE_SERVICE_ROLE_KEY=$serviceRoleKey"
  ) | Set-Content -Encoding UTF8 '.env.local.runtime'

  Write-Step 'Generating .env.local.web for frontend public values'
  @(
    "VITE_SUPABASE_URL=$apiUrl"
    "VITE_SUPABASE_PUBLISHABLE_KEY=$anonKey"
  ) | Set-Content -Encoding UTF8 '.env.local.web'

  Write-Step 'Generating .env.local.functions for function runtime'
  $functionEnvLines = @(
    "REDMINE_URL=$($envMap['REDMINE_URL'])"
    "REDMINE_API_KEY=$($envMap['REDMINE_API_KEY'])"
    "REDMINE_PAGE_SIZE=$($envMap['REDMINE_PAGE_SIZE'])"
    "REDMINE_PROJECT_BATCH_SIZE=$($envMap['REDMINE_PROJECT_BATCH_SIZE'])"
    "REDMINE_MAX_RETRIES=$($envMap['REDMINE_MAX_RETRIES'])"
    "REDMINE_REQUEST_TIMEOUT_MS=$($envMap['REDMINE_REQUEST_TIMEOUT_MS'])"
    "REDMINE_FIELD_TEAM=$($envMap['REDMINE_FIELD_TEAM'])"
    "REDMINE_FIELD_TECHNOLOGY=$($envMap['REDMINE_FIELD_TECHNOLOGY'])"
    "REDMINE_FIELD_TYPE=$($envMap['REDMINE_FIELD_TYPE'])"
    "REDMINE_FIELD_SATISFACTION=$($envMap['REDMINE_FIELD_SATISFACTION'])"
    "REDMINE_FIELD_SOURCE=$($envMap['REDMINE_FIELD_SOURCE'])"
    "REDMINE_FIELD_CANAL=$($envMap['REDMINE_FIELD_CANAL'])"
    "REDMINE_FIELD_SEGMENT_CLIENT=$($envMap['REDMINE_FIELD_SEGMENT_CLIENT'])"
    "REDMINE_FIELD_REGION=$($envMap['REDMINE_FIELD_REGION'])"
    "REDMINE_FIELD_REOPENED=$($envMap['REDMINE_FIELD_REOPENED'])"
    "REDMINE_FIELD_SLA_PLAN=$($envMap['REDMINE_FIELD_SLA_PLAN'])"
    "SUPABASE_URL=$apiUrl"
    "SUPABASE_SERVICE_ROLE_KEY=$serviceRoleKey"
    "SUPABASE_FUNCTIONS_URL=$apiUrl/functions/v1"
  )

  $filteredFunctionEnvLines = $functionEnvLines | Where-Object {
    -not [string]::IsNullOrWhiteSpace($_) -and ($_ -notmatch '=\s*$')
  }
  $filteredFunctionEnvLines | Set-Content -Encoding UTF8 '.env.local.functions'

  Write-Step 'Applying database migrations'
  Run-SupabaseCli @('db', 'push', '--local')

  if ($DeployFunctions) {
    Write-Step 'Deploying edge functions to cloud project'
    if (-not $envMap.ContainsKey('SUPABASE_PROJECT_REF') -or [string]::IsNullOrWhiteSpace($envMap['SUPABASE_PROJECT_REF'])) {
      throw 'DeployFunctions requires SUPABASE_PROJECT_REF in .env'
    }

    $projectRef = $envMap['SUPABASE_PROJECT_REF']
    $functionDirs = @(Get-ChildItem 'supabase/functions' -Directory | Select-Object -ExpandProperty Name)

    foreach ($fn in $functionDirs) {
      Write-Host "Deploying function: $fn"
      Run-SupabaseCli @('functions', 'deploy', $fn, '--project-ref', $projectRef, '--no-verify-jwt')
    }
  }

  Write-Step 'Starting web service in Docker'
  if ($NoCache) {
    docker compose build --no-cache web
    if ($LASTEXITCODE -ne 0) { throw 'docker compose build --no-cache web failed' }
    docker compose up -d web
    if ($LASTEXITCODE -ne 0) { throw 'docker compose up -d web failed' }
  } else {
    docker compose up -d --build web
    if ($LASTEXITCODE -ne 0) { throw 'docker compose up -d --build web failed' }
  }

  if (-not $SkipIngest) {
    Write-Step "Running resumable ingestion batches (max $MaxBatches)"
    $functionUrl = "$apiUrl/functions/v1/redmine-ingest"
    $invokeHeaders = @{ 'Content-Type' = 'application/json' }
    $restHeaders = @{
      apikey = $serviceRoleKey
      Authorization = "Bearer $serviceRoleKey"
      Accept = 'application/json'
    }

    for ($i = 1; $i -le $MaxBatches; $i++) {
      $body = if ($i -eq 1) {
        '{"mode":"batch","resetCursor":true}'
      } else {
        '{"mode":"batch"}'
      }

      try {
        Invoke-WebRequest -Uri $functionUrl -Method POST -Headers $invokeHeaders -Body $body -TimeoutSec 600 -UseBasicParsing | Out-Null
      } catch {
        # Continue and inspect persisted state below.
      }

      $stateRows = @(Invoke-RestMethod -Uri "$apiUrl/rest/v1/sync_state?source=eq.redmine&select=last_offset,last_error,last_sync_at,last_success_at" -Headers $restHeaders -Method GET -TimeoutSec 60)
      $runRows = @(Invoke-RestMethod -Uri "$apiUrl/rest/v1/sync_runs?source=eq.redmine&select=status,metrics_json,error_text,started_at,ended_at&order=started_at.desc&limit=1" -Headers $restHeaders -Method GET -TimeoutSec 60)

      $state = First-Row $stateRows
      $run = First-Row $runRows

      $offset = if ($state -and $state.PSObject.Properties.Name -contains 'last_offset') { [int]$state.last_offset } else { -1 }
      $status = if ($run -and $run.PSObject.Properties.Name -contains 'status') { [string]$run.status } else { 'unknown' }
      $cycleCompleted = $false
      if ($run -and $run.metrics_json -and $run.metrics_json.PSObject.Properties.Name -contains 'cycleCompleted') {
        $cycleCompleted = [bool]$run.metrics_json.cycleCompleted
      }

      Write-Host ("Batch {0}: status={1} offset={2} cycleCompleted={3}" -f $i, $status, $offset, $cycleCompleted)

      if ($status -eq 'success' -and $cycleCompleted -and $offset -eq 0) {
        Write-Host 'Ingestion cycle completed successfully.' -ForegroundColor Green
        break
      }
    }
  }

  Write-Step 'Done'
  Write-Host "Supabase API: $apiUrl"
  Write-Host 'Web app: http://127.0.0.1:8080'
  Write-Host 'Frontend env file: .env.local.web'
  Write-Host 'Runtime env file: .env.local.runtime'
  Write-Host 'Function env file: .env.local.functions'
} finally {
  Pop-Location
}
