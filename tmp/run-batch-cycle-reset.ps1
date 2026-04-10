$ErrorActionPreference = 'Stop'

$serviceKey = (Select-String -Path .env.functions.local -Pattern '^SUPABASE_SERVICE_ROLE_KEY=' | Select-Object -Last 1).Line.Split('=', 2)[1].Trim('"')
$restHeaders = @{
  apikey = $serviceKey
  Authorization = "Bearer $serviceKey"
  Accept = 'application/json'
}

# Reset cursor once, then continue in batches.
Invoke-WebRequest `
  -Uri 'http://127.0.0.1:54321/functions/v1/redmine-ingest' `
  -Method POST `
  -Headers @{ 'Content-Type' = 'application/json' } `
  -Body '{"mode":"batch","resetCursor":true}' `
  -TimeoutSec 300 `
  -UseBasicParsing | Out-Null

for ($i = 1; $i -le 14; $i++) {
  try {
    Invoke-WebRequest `
      -Uri 'http://127.0.0.1:54321/functions/v1/redmine-ingest' `
      -Method POST `
      -Headers @{ 'Content-Type' = 'application/json' } `
      -Body '{"mode":"batch"}' `
      -TimeoutSec 300 `
      -UseBasicParsing | Out-Null
  } catch {
    # Continue and inspect persisted state instead.
  }

  $state = Invoke-RestMethod `
    -Uri 'http://127.0.0.1:54321/rest/v1/sync_state?source=eq.redmine&select=last_offset,last_error,last_sync_at,last_success_at' `
    -Headers $restHeaders `
    -Method GET `
    -TimeoutSec 60

  $run = Invoke-RestMethod `
    -Uri 'http://127.0.0.1:54321/rest/v1/sync_runs?source=eq.redmine&select=status,metrics_json,error_text,started_at,ended_at&order=started_at.desc&limit=1' `
    -Headers $restHeaders `
    -Method GET `
    -TimeoutSec 60

  $offset = [int]$state.last_offset
  $status = [string]$run.status
  $completed = [bool]$run.metrics_json.cycleCompleted

  Write-Host "STEP=$i OFFSET=$offset STATUS=$status COMPLETED=$completed"

  if ($status -eq 'success' -and $completed -eq $true -and $offset -eq 0) {
    break
  }
}
