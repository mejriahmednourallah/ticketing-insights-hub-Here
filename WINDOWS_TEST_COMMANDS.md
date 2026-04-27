# Windows Test Commands

This guide provides PowerShell commands to run and test the project on Windows.

## 1) Prerequisites (one-time)

```powershell
winget install -e --id Git.Git
winget install -e --id Docker.DockerDesktop
winget install -e --id OpenJS.NodeJS.LTS
```

Restart PowerShell after installation, then verify:

```powershell
git --version
docker --version
npm --version
```

If script execution is blocked, allow local scripts for current user:

```powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
```

## 2) Get the project

```powershell
git clone https://github.com/Rimenmouhamed/ticketing-insights-hub.git
cd ticketing-insights-hub
```

## 3) Prepare environment file

```powershell
Copy-Item .env.example .env
notepad .env
```

Minimum recommended values in .env:
- For full ingestion: set real REDMINE_URL and REDMINE_API_KEY.
- For app-only test: you can keep placeholders and run with -SkipIngest.

## 4) Clean rebuild + run (recommended)

### Option A: Full run with ingestion (requires valid Redmine credentials)

```powershell
powershell -ExecutionPolicy Bypass -File scripts/run-local-e2e.ps1
```

### Option B: Run without ingestion (frontend + local Supabase)

```powershell
powershell -ExecutionPolicy Bypass -File scripts/run-local-e2e.ps1 -SkipIngest
```

### Option C: Force fresh image build

```powershell
powershell -ExecutionPolicy Bypass -File scripts/run-local-e2e.ps1 -NoCache -SkipIngest
```

## 5) Verify services

```powershell
docker compose ps
npm exec --package supabase@latest -- supabase status --local
```

Check app endpoint:

```powershell
Invoke-WebRequest -Uri http://127.0.0.1:8080 -UseBasicParsing | Select-Object StatusCode
```

Check local function endpoint:

```powershell
$apiUrl = (npm exec --package supabase@latest -- supabase status -o env | Select-String '^API_URL=').ToString().Split('=')[1]
Invoke-WebRequest -Method Options -Uri "$apiUrl/functions/v1/redmine-ingest" -UseBasicParsing | Select-Object StatusCode
```

## 6) Validate env separation (important)

Web env must NOT contain service role key:

```powershell
Select-String -Path .env.local.web -Pattern '^SUPABASE_SERVICE_ROLE_KEY=' -SimpleMatch
```

Runtime env must contain service role key:

```powershell
Select-String -Path .env.local.runtime -Pattern '^SUPABASE_SERVICE_ROLE_KEY='
```

Expected result:
- First command returns no match.
- Second command returns one match.

## 7) Run automated tests

Install dependencies for host-based tests:

```powershell
npm ci
```

Run unit tests:

```powershell
npm run test
```

Run lint:

```powershell
npm run lint
```

Run Playwright tests (if needed):

```powershell
npx playwright install
npx playwright test
```

## 8) Useful troubleshooting commands

Show Docker service logs:

```powershell
docker compose logs --tail=200 web
```

Show local Supabase status details:

```powershell
npm exec --package supabase@latest -- supabase status --local
```

Repair local Supabase (PowerShell-native flow):

```powershell
npm exec --package supabase@latest -- supabase stop --local
docker system prune -f
npm exec --package supabase@latest -- supabase start
npm exec --package supabase@latest -- supabase db push --local
```

## 9) Stop and cleanup

Stop web container:

```powershell
docker compose down
```

Stop local Supabase stack:

```powershell
npm exec --package supabase@latest -- supabase stop --local
```

Full cleanup (volumes + dangling images):

```powershell
docker compose down -v
docker system prune -f
```
