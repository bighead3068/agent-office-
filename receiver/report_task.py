#!/usr/bin/env python3
"""Post one self-report for the agent id you pass.

Python 3.10 stdlib only. Reads only that agent's header file. Does not print
the header or the token. Loopback HTTP only. This does not start a task by
itself; the caller has to be that bot.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from urllib.parse import urlparse

import self_report_server as srv

STATUS_TYPE = {
    "started": "task.started",
    "completed": "task.completed",
    "failed": "task.failed",
    "progress": "task.progress",
}


def normalize_url(url: str) -> str:
    parsed = urlparse(url)
    if parsed.scheme != "http" or parsed.hostname not in {"127.0.0.1", "localhost"}:
        raise ValueError("url must be loopback http")
    path = parsed.path or ""
    if path in {"", "/"}:
        path = "/api/self-report"
    if path not in {"/api/self-report", "/api/fixture-report"}:
        raise ValueError("url path must be the self-report endpoint")
    return f"http://{parsed.hostname}:{parsed.port or 8793}{path}"


def read_own_header(runtime: Path, agent_id: str) -> str:
    path = srv.header_file(runtime, agent_id)
    if not path.is_file():
        raise FileNotFoundError(agent_id)
    line = path.read_text(encoding="utf-8").strip()
    if not line.startswith("Authorization: Bearer ") or line == "Authorization: Bearer":
        raise ValueError("header file is not usable")
    return line


def build_body(agent_id: str, job_id: str, status: str, title: str | None, event_id: str | None, at: int | None) -> dict:
    if status not in STATUS_TYPE:
        raise ValueError("status must be started, completed, failed, or progress")
    if not srv.ID_RE.fullmatch(job_id):
        raise ValueError("job id is not usable")
    if title is not None and (srv.TITLE_BAD.search(title) or not (1 <= len(title) <= srv.MAX_TITLE)):
        raise ValueError("task title must be 1 to 160 characters without control characters")
    if status == "started" and not title:
        raise ValueError("started requires a task title")
    stamp = int(time.time() * 1000) if at is None else at
    body = {
        "eventId": event_id or f"cli-{agent_id[:8]}-{status}-{stamp}",
        "type": STATUS_TYPE[status],
        "jobId": job_id,
        "at": stamp,
        "sourceId": agent_id,
        "agentId": agent_id,
    }
    if title:
        body["taskTitle"] = title
    if not srv.ID_RE.fullmatch(body["eventId"]):
        raise ValueError("event id is not usable")
    return body


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description="Post one local bot self-report")
    parser.add_argument("--agent-id", required=True)
    parser.add_argument("--job-id", required=True)
    parser.add_argument("--status", required=True, choices=sorted(STATUS_TYPE))
    parser.add_argument("--task", default="")
    parser.add_argument("--task-file", default="")
    parser.add_argument("--runtime-dir", default="")
    parser.add_argument("--url", default="http://127.0.0.1:8793/api/self-report")
    parser.add_argument("--event-id", default="")
    parser.add_argument("--at", type=int, default=0)
    args = parser.parse_args(argv)
    runtime = Path(args.runtime_dir).expanduser() if args.runtime_dir else srv.default_runtime_dir()
    title = args.task
    if args.task_file:
        title = Path(args.task_file).read_text(encoding="utf-8").strip("\ufeff\r\n")
    title_value = title if title else None
    try:
        header = read_own_header(runtime, args.agent_id)
        url = normalize_url(args.url)
        body = build_body(args.agent_id, args.job_id, args.status, title_value, args.event_id or None, args.at or None)
    except (ValueError, FileNotFoundError, OSError):
        print("report_status=0", file=sys.stderr)
        print("result=rejected", file=sys.stderr)
        return 2
    data = json.dumps(body, ensure_ascii=False).encode("utf-8")
    request = urllib.request.Request(url, data=data, method="POST")
    request.add_header("Authorization", header.split(": ", 1)[1])
    request.add_header("Content-Type", "application/json; charset=utf-8")
    try:
        with urllib.request.urlopen(request, timeout=5) as response:
            raw = response.read()
            status = response.status
    except urllib.error.HTTPError as error:
        raw = error.read()
        status = error.code
    except urllib.error.URLError:
        print(f"report_status=0", file=sys.stderr)
        print("result=unreachable", file=sys.stderr)
        return 3
    try:
        payload = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        payload = {}
    result = "deduped" if payload.get("deduped") else "ok" if payload.get("ok") else str(payload.get("error") or "rejected")
    print(f"report_status={status}")
    print(f"result={result}")
    return 0 if payload.get("ok") else 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
