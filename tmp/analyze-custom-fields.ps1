$ErrorActionPreference = 'Stop'

$serviceKey = (Select-String -Path .env.functions.local -Pattern '^SUPABASE_SERVICE_ROLE_KEY=' | Select-Object -Last 1).Line.Split('=', 2)[1].Trim('"')
$headers = @{
  apikey = $serviceKey
  Authorization = "Bearer $serviceKey"
  Accept = 'application/json'
}

$pageSize = 1000
$offset = 0
$nameCounts = @{}
$nameNonEmptyCounts = @{}

while ($true) {
  $url = "http://127.0.0.1:54321/rest/v1/redmine_issues?select=custom_fields_json&offset=$offset&limit=$pageSize"
  $resp = Invoke-WebRequest -Uri $url -Headers $headers -Method GET -TimeoutSec 120 -UseBasicParsing
  $rows = @($resp.Content | ConvertFrom-Json)

  foreach ($row in $rows) {
    $fields = $row.custom_fields_json
    if ($fields -is [System.Array]) {
      foreach ($cf in $fields) {
        $name = [string]$cf.name
        if ([string]::IsNullOrWhiteSpace($name)) { continue }

        if (-not $nameCounts.ContainsKey($name)) { $nameCounts[$name] = 0 }
        $nameCounts[$name] = $nameCounts[$name] + 1

        $value = [string]$cf.value
        if (-not [string]::IsNullOrWhiteSpace($value)) {
          if (-not $nameNonEmptyCounts.ContainsKey($name)) { $nameNonEmptyCounts[$name] = 0 }
          $nameNonEmptyCounts[$name] = $nameNonEmptyCounts[$name] + 1
        }
      }
    }
  }

  if ($rows.Count -lt $pageSize) { break }
  $offset += $pageSize
}

$out = New-Object System.Collections.Generic.List[Object]
foreach ($k in $nameCounts.Keys) {
  $nonEmpty = 0
  if ($nameNonEmptyCounts.ContainsKey($k)) { $nonEmpty = $nameNonEmptyCounts[$k] }
  $out.Add([pscustomobject]@{
    name = $k
    seen = $nameCounts[$k]
    nonEmpty = $nonEmpty
  }) | Out-Null
}

$sorted = $out | Sort-Object @{ Expression = 'nonEmpty'; Descending = $true }, @{ Expression = 'seen'; Descending = $true }

New-Item -ItemType Directory -Force -Path tmp | Out-Null
$sorted | ConvertTo-Json -Depth 5 | Set-Content -Encoding UTF8 tmp/custom_field_name_counts.json
$sorted | Select-Object -First 60 | ForEach-Object { "{0} | seen={1} | nonEmpty={2}" -f $_.name, $_.seen, $_.nonEmpty } | Set-Content -Encoding UTF8 tmp/custom_field_name_counts_top.txt

Write-Host 'WROTE=tmp/custom_field_name_counts.json'
Write-Host 'WROTE=tmp/custom_field_name_counts_top.txt'
