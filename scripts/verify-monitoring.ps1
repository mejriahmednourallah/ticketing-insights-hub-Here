param(
  [string]$PrometheusUrl = 'http://127.0.0.1:9090',
  [string]$GrafanaUrl = 'http://127.0.0.1:3000',
  [int]$MaxAttempts = 24
)

$ErrorActionPreference = 'Stop'

$grafanaUser = if ($env:GRAFANA_ADMIN_USER) { $env:GRAFANA_ADMIN_USER } else { 'admin' }
$grafanaPassword = if ($env:GRAFANA_ADMIN_PASSWORD) { $env:GRAFANA_ADMIN_PASSWORD } else { 'change_me' }
$basicToken = [Convert]::ToBase64String(
  [Text.Encoding]::ASCII.GetBytes("${grafanaUser}:${grafanaPassword}")
)
$grafanaHeaders = @{ Authorization = "Basic $basicToken" }
$expectedJobs = @(
  'prometheus',
  'analytics-api',
  'warehouse-refresh',
  'postgres',
  'cadvisor',
  'node',
  'blackbox'
)

for ($attempt = 1; $attempt -le $MaxAttempts; $attempt++) {
  try {
    $targets = Invoke-RestMethod "$PrometheusUrl/api/v1/targets" -TimeoutSec 10
    $activeTargets = @($targets.data.activeTargets)
    $jobs = @($activeTargets | ForEach-Object { $_.labels.job } | Sort-Object -Unique)
    $missingJobs = @($expectedJobs | Where-Object { $_ -notin $jobs })
    $unhealthy = @($activeTargets | Where-Object { $_.health -ne 'up' })

    $grafanaHealth = Invoke-RestMethod "$GrafanaUrl/api/health" -TimeoutSec 10
    $dashboard = Invoke-RestMethod "$GrafanaUrl/api/dashboards/uid/ticketing-operations" `
      -Headers $grafanaHeaders -TimeoutSec 10

    if (
      $missingJobs.Count -eq 0 -and
      $unhealthy.Count -eq 0 -and
      $grafanaHealth.database -eq 'ok' -and
      $dashboard.dashboard.uid -eq 'ticketing-operations'
    ) {
      Write-Host 'Monitoring verification passed.' -ForegroundColor Green
      Write-Host "Prometheus targets: $($activeTargets.Count)"
      Write-Host "Grafana dashboard: $($dashboard.dashboard.title)"
      exit 0
    }

    Write-Host "Attempt ${attempt}: waiting for monitoring readiness..." -ForegroundColor Yellow
    if ($missingJobs.Count) {
      Write-Host "Missing jobs: $($missingJobs -join ', ')"
    }
    if ($unhealthy.Count) {
      Write-Host "Unhealthy targets: $(($unhealthy | ForEach-Object { $_.scrapeUrl }) -join ', ')"
    }
  } catch {
    Write-Host "Attempt ${attempt}: $($_.Exception.Message)" -ForegroundColor Yellow
  }

  Start-Sleep -Seconds 5
}

throw "Monitoring did not become healthy after $MaxAttempts attempts."
