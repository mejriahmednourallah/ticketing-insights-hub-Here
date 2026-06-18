#!/usr/bin/env python3
from __future__ import annotations

import datetime as dt
import http.client
import json
import os
import socket
import time
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any


DOCKER_SOCKET = os.getenv("DOCKER_SOCKET", "/var/run/docker.sock")
PORT = int(os.getenv("DOCKER_EXPORTER_PORT", "9323"))
PROJECT_FILTER = {
    item.strip()
    for item in os.getenv("DOCKER_EXPORTER_PROJECT_FILTER", "").split(",")
    if item.strip()
}


class UnixHTTPConnection(http.client.HTTPConnection):
    def __init__(self, unix_socket: str, timeout: float = 8.0) -> None:
        super().__init__("localhost", timeout=timeout)
        self.unix_socket = unix_socket

    def connect(self) -> None:
        self.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.sock.settimeout(self.timeout)
        self.sock.connect(self.unix_socket)


def docker_request(path: str) -> tuple[int, bytes]:
    conn = UnixHTTPConnection(DOCKER_SOCKET)
    try:
        conn.request("GET", path, headers={"Host": "docker"})
        response = conn.getresponse()
        return response.status, response.read()
    finally:
        conn.close()


def docker_json(path: str) -> Any:
    status, payload = docker_request(path)
    if status >= 400:
        raise RuntimeError(f"Docker API {path} returned HTTP {status}: {payload[:200]!r}")
    return json.loads(payload.decode("utf-8"))


def escape_label(value: Any) -> str:
    return str(value or "").replace("\\", "\\\\").replace("\n", "\\n").replace('"', '\\"')


def metric_line(name: str, labels: dict[str, Any], value: float | int) -> str:
    label_text = ",".join(f'{key}="{escape_label(labels[key])}"' for key in sorted(labels))
    return f"{name}{{{label_text}}} {float(value):.12g}"


def parse_docker_time(value: str | None) -> float | None:
    if not value or value.startswith("0001-01-01"):
        return None
    normalized = value
    if normalized.endswith("Z"):
        normalized = normalized[:-1] + "+00:00"
    if "." in normalized:
        prefix, suffix = normalized.split(".", 1)
        timezone_start = max(suffix.find("+"), suffix.find("-"))
        if timezone_start == -1:
            fraction = suffix
            timezone = ""
        else:
            fraction = suffix[:timezone_start]
            timezone = suffix[timezone_start:]
        normalized = f"{prefix}.{fraction[:6].ljust(6, '0')}{timezone}"
    return dt.datetime.fromisoformat(normalized).timestamp()


def container_name(container: dict[str, Any]) -> str:
    names = container.get("Names") or []
    if names:
        return str(names[0]).lstrip("/")
    return str(container.get("Id", ""))[:12]


def compose_service(container: dict[str, Any], name: str) -> str:
    labels = container.get("Labels") or {}
    return labels.get("com.docker.compose.service") or name


def compose_project(container: dict[str, Any]) -> str:
    labels = container.get("Labels") or {}
    return labels.get("com.docker.compose.project") or "standalone"


def cpu_usage_ratio(stats: dict[str, Any]) -> float:
    cpu_stats = stats.get("cpu_stats") or {}
    previous_stats = stats.get("precpu_stats") or {}
    cpu_usage = cpu_stats.get("cpu_usage") or {}
    previous_usage = previous_stats.get("cpu_usage") or {}

    cpu_delta = float(cpu_usage.get("total_usage") or 0) - float(previous_usage.get("total_usage") or 0)
    system_delta = float(cpu_stats.get("system_cpu_usage") or 0) - float(
        previous_stats.get("system_cpu_usage") or 0
    )
    online_cpus = int(cpu_stats.get("online_cpus") or 0)
    if online_cpus <= 0:
        online_cpus = len(cpu_usage.get("percpu_usage") or []) or 1
    if cpu_delta <= 0 or system_delta <= 0:
        return 0.0
    return max((cpu_delta / system_delta) * online_cpus, 0.0)


def memory_values(stats: dict[str, Any]) -> tuple[float, float, float]:
    memory = stats.get("memory_stats") or {}
    usage = float(memory.get("usage") or 0)
    limit = float(memory.get("limit") or 0)
    memory_detail = memory.get("stats") or {}
    inactive_file = float(memory_detail.get("inactive_file") or 0)
    cache = float(memory_detail.get("cache") or 0)
    subtractable = inactive_file if inactive_file > 0 else cache
    working_set = max(usage - min(subtractable, usage), 0.0)
    return usage, working_set, limit


def network_values(stats: dict[str, Any]) -> tuple[float, float]:
    networks = stats.get("networks") or {}
    rx_bytes = sum(float(item.get("rx_bytes") or 0) for item in networks.values())
    tx_bytes = sum(float(item.get("tx_bytes") or 0) for item in networks.values())
    return rx_bytes, tx_bytes


def collect_metrics() -> str:
    started = time.monotonic()
    now = time.time()
    lines = [
        "# HELP ticketing_docker_exporter_scrape_success Whether the Docker exporter scrape succeeded.",
        "# TYPE ticketing_docker_exporter_scrape_success gauge",
        "# HELP ticketing_docker_exporter_scrape_duration_seconds Docker exporter scrape duration.",
        "# TYPE ticketing_docker_exporter_scrape_duration_seconds gauge",
        "# HELP ticketing_container_up Whether the container state is running.",
        "# TYPE ticketing_container_up gauge",
        "# HELP ticketing_container_uptime_seconds Seconds since the current container process started.",
        "# TYPE ticketing_container_uptime_seconds gauge",
        "# HELP ticketing_container_restart_count Docker restart count for the container.",
        "# TYPE ticketing_container_restart_count gauge",
        "# HELP ticketing_container_cpu_usage_ratio Current CPU usage ratio. 1.0 equals one full CPU core.",
        "# TYPE ticketing_container_cpu_usage_ratio gauge",
        "# HELP ticketing_container_memory_usage_bytes Container memory usage in bytes.",
        "# TYPE ticketing_container_memory_usage_bytes gauge",
        "# HELP ticketing_container_memory_working_set_bytes Container memory working set in bytes.",
        "# TYPE ticketing_container_memory_working_set_bytes gauge",
        "# HELP ticketing_container_memory_limit_bytes Container memory limit in bytes.",
        "# TYPE ticketing_container_memory_limit_bytes gauge",
        "# HELP ticketing_container_network_receive_bytes_total Container network receive bytes.",
        "# TYPE ticketing_container_network_receive_bytes_total counter",
        "# HELP ticketing_container_network_transmit_bytes_total Container network transmit bytes.",
        "# TYPE ticketing_container_network_transmit_bytes_total counter",
    ]

    success = 1.0
    try:
        containers = docker_json("/containers/json?all=1")
        for container in containers:
            name = container_name(container)
            project = compose_project(container)
            if PROJECT_FILTER and project not in PROJECT_FILTER:
                continue
            service = compose_service(container, name)
            container_id = str(container.get("Id", ""))[:12]
            inspect = docker_json(f"/containers/{urllib.parse.quote(container_id, safe='')}/json")
            state = inspect.get("State") or {}
            status = str(state.get("Status") or container.get("State") or "unknown")
            labels = {
                "container_id": container_id,
                "name": name,
                "project": project,
                "service": service,
                "state": status,
            }
            is_running = 1.0 if status == "running" else 0.0
            started_at = parse_docker_time(state.get("StartedAt"))
            uptime = max(now - started_at, 0.0) if is_running and started_at else 0.0

            lines.append(metric_line("ticketing_container_up", labels, is_running))
            lines.append(metric_line("ticketing_container_uptime_seconds", labels, uptime))
            lines.append(metric_line("ticketing_container_restart_count", labels, inspect.get("RestartCount") or 0))

            if not is_running:
                continue

            stats = docker_json(
                f"/containers/{urllib.parse.quote(container_id, safe='')}/stats?stream=false&one-shot=true"
            )
            usage, working_set, limit = memory_values(stats)
            rx_bytes, tx_bytes = network_values(stats)

            lines.append(metric_line("ticketing_container_cpu_usage_ratio", labels, cpu_usage_ratio(stats)))
            lines.append(metric_line("ticketing_container_memory_usage_bytes", labels, usage))
            lines.append(metric_line("ticketing_container_memory_working_set_bytes", labels, working_set))
            lines.append(metric_line("ticketing_container_memory_limit_bytes", labels, limit))
            lines.append(metric_line("ticketing_container_network_receive_bytes_total", labels, rx_bytes))
            lines.append(metric_line("ticketing_container_network_transmit_bytes_total", labels, tx_bytes))
    except Exception as exc:  # pragma: no cover - reported as Prometheus metric.
        success = 0.0
        lines.append(f"# Docker exporter scrape failed: {escape_label(exc)}")

    duration = time.monotonic() - started
    lines.append(f"ticketing_docker_exporter_scrape_success {success:.0f}")
    lines.append(f"ticketing_docker_exporter_scrape_duration_seconds {duration:.12g}")
    return "\n".join(lines) + "\n"


class Handler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:
        if self.path == "/healthz":
            try:
                status, payload = docker_request("/_ping")
                healthy = status == 200 and payload.strip() == b"OK"
            except Exception:
                healthy = False
            self.send_response(200 if healthy else 503)
            self.end_headers()
            self.wfile.write(b"ok\n" if healthy else b"unhealthy\n")
            return

        if self.path not in {"/", "/metrics"}:
            self.send_response(404)
            self.end_headers()
            return

        payload = collect_metrics().encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "text/plain; version=0.0.4; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, format: str, *args: Any) -> None:
        return


if __name__ == "__main__":
    server = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    server.serve_forever()
