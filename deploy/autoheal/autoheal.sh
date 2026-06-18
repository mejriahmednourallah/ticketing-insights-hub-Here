#!/bin/sh
set -eu

interval="${AUTOHEAL_INTERVAL_SECONDS:-15}"
threshold="${AUTOHEAL_FAILURE_THRESHOLD:-3}"
state_dir="/tmp/autoheal"
mkdir -p "$state_dir"

while true; do
  docker ps --filter "label=com.ticketing.autoheal=true" --format '{{.ID}}' | while read -r container_id; do
    [ -n "$container_id" ] || continue
    health="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$container_id" 2>/dev/null || true)"
    counter_file="$state_dir/$container_id"

    if [ "$health" = "unhealthy" ]; then
      failures="$(( $(cat "$counter_file" 2>/dev/null || echo 0) + 1 ))"
      printf '%s\n' "$failures" > "$counter_file"
      if [ "$failures" -ge "$threshold" ]; then
        name="$(docker inspect --format '{{.Name}}' "$container_id" | sed 's#^/##')"
        echo "[autoheal] restarting unhealthy container: $name"
        docker restart "$container_id" >/dev/null
        rm -f "$counter_file"
      fi
    else
      rm -f "$counter_file"
    fi
  done
  sleep "$interval"
done
