param(
  [switch]$DryRun
)

$root = Resolve-Path (Join-Path $PSScriptRoot '..')
Push-Location $root

try {
  $targets = @(
    'ticketing_warehouse\warehouse.duckdb',
    'ticketing_warehouse\warehouse.duckdb.wal',
    'ticketing_warehouse\target',
    'ticketing_warehouse\logs'
  )

  foreach ($path in $targets) {
    if (Test-Path $path) {
      $size = if ((Get-Item $path).PSIsContainer) {
        "{0:N1} MB" -f ((Get-ChildItem $path -Recurse -File | Measure-Object -Property Length -Sum).Sum / 1MB)
      } else {
        "{0:N1} MB" -f ((Get-Item $path).Length / 1MB)
      }

      if ($DryRun) {
        Write-Host "[dry-run] would remove $path ($size)" -ForegroundColor Yellow
      } else {
        Remove-Item -LiteralPath $path -Recurse -Force
        Write-Host "Removed $path ($size)" -ForegroundColor Green
      }
    } else {
      Write-Host "Skip (not found): $path" -ForegroundColor Gray
    }
  }

  $drive = (Get-Item $root).PSDrive.Name
  $disk = Get-PSDrive $drive
  Write-Host ("`nFree space on {0}: {1:N1} GB" -f "$drive`:", ($disk.Free / 1GB)) -ForegroundColor Cyan
} finally {
  Pop-Location
}
