# Local Run Final Version

These are the commands used in the final local run, written exactly as they were run.

## Final command sequence

```powershell
npx supabase start
npx supabase status -o env
powershell -ExecutionPolicy Bypass -File scripts/run-local-e2e.ps1
```

## Verification command used during the run

```powershell
docker ps
```

## Outcome

The final `powershell -ExecutionPolicy Bypass -File scripts/run-local-e2e.ps1` run completed successfully after fixing the generated runtime env file format.
