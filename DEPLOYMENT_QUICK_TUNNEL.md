# Container Deployment with a Cloudflare Quick Tunnel

This deployment runs the web application, Supabase-compatible API services,
Edge Functions, DuckDB analytics, monitoring, backups, autohealing, and the
temporary Cloudflare tunnel in one Docker Compose project.

Cloudflare Quick Tunnels are intended for testing and development. Their random
`trycloudflare.com` URL changes whenever the tunnel is recreated, and the laptop
remains a single point of failure.

## 1. Rotate exposed external credentials

Rotate the Redmine API key and Lovable AI key at their providers. The previously
tracked values must not be reused.

Generate fresh local database, JWT, API, Grafana, and gateway credentials:

```bash
./deploy/scripts/init-secrets.sh
```

Edit `deploy/secrets/runtime.env` and replace both
`CHANGE_ME_ROTATE_THE_EXPOSED_KEY` placeholders.

Credentials for Studio and Grafana are written once to:

```text
deploy/secrets/initial-admin-credentials.txt
```

Both files are ignored by Git and created with mode `0600`.

## 2. Remove old secrets from Git history

After installing `git-filter-repo`, run:

```bash
./scripts/purge-secrets-history.sh
```

Review the rewritten history and force-push with lease. Everyone using an old
clone must reclone afterward.

## 3. Deploy

Ensure the current user belongs to the Docker group, then run:

```bash
./deploy/scripts/deploy.sh
```

The script validates Compose, pulls pinned images, builds local images, starts
the stack, runs a local smoke test, and prints the generated public URL.

Enable Docker at boot once using an administrator account:

```bash
sudo systemctl enable --now docker
```

Useful commands:

```bash
./deploy/scripts/status.sh
./deploy/scripts/smoke-test.sh
./deploy/scripts/update.sh
./deploy/scripts/stop.sh
docker compose --env-file deploy/secrets/runtime.env \
  -f docker-compose.production.yml logs -f
```

The current URL is also stored in `runtime/quick-tunnel-url.txt`.

## Routes

- `/` — public dashboard
- `/api/analytics/` — authenticated DuckDB API used by the dashboard
- `/functions/v1/chat` — non-streaming AI chat
- `/admin/studio` — HTTP Basic Auth, then Supabase Studio
- `/admin/grafana/` — HTTP Basic Auth, then Grafana login

Local emergency access:

- Gateway: `http://127.0.0.1:8080`
- Grafana: `http://127.0.0.1:3000`
- Studio: `http://127.0.0.1:3001`

No database, Prometheus, exporter, Docker API, or Edge Runtime port is published.

## Backups and recovery

Postgres dumps and configuration manifests are stored under `deploy/backups/`.
The backup container retains 14 daily and 8 weekly backups and verifies one
restore per month against the current ticket count.

These local backups do not protect against disk failure, theft, fire, or loss of
the laptop. Copy the backup directory to independent storage when possible.

## Health and recovery

Long-running services use health checks and `restart: unless-stopped`. The
repository-owned autoheal service restarts labeled containers after three
consecutive unhealthy checks. It mounts the Docker socket read-only at the
filesystem level, though Docker socket access is inherently privileged.

To confirm automatic startup after reboot:

```bash
sudo systemctl is-enabled docker
sudo reboot
```

After reboot, run `./deploy/scripts/status.sh`; the Quick Tunnel URL may be new.
