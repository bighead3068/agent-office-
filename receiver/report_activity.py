#!/usr/bin/env python3
"""Report a local Codex worker's own start or explicit result."""

from __future__ import annotations

import argparse
import hashlib
import http.client
import json
import re
import sys
from pathlib import Path
from urllib.parse import urlsplit

if __package__:
    from . import self_report_server as srv
    from .codex_activity import WORKER_RESULTS, valid_event
else:
    import self_report_server as srv
    from codex_activity import WORKER_RESULTS, valid_event

DEFAULT_URL = f"http://127.0.0.1:{srv.OFFICE_PORT}{srv.CODEX_ACTIVITY_PATH}"
HEADER_RE = re.compile(r"Authorization: (Bearer [A-Za-z0-9_-]+)")


def receiver_port(url: str) -> int:
    parsed = urlsplit(url)
    if (
        parsed.scheme != "http"
        or parsed.hostname not in ("127.0.0.1", "localhost")
        or parsed.username is not None
        or parsed.path != srv.CODEX_ACTIVITY_PATH
        or parsed.query
        or parsed.fragment
        or parsed.port == 0
    ):
        raise ValueError("expected a loopback Codex activity endpoint")
    return parsed.port if parsed.port is not None else srv.OFFICE_PORT


def build_report(args: argparse.Namespace) -> dict:
    # The same phase can be retried after an uncertain delivery or a new process.
    identity = json.dumps([args.session_id, args.agent_id, args.job_id, args.status])
    digest = hashlib.sha256(identity.encode("utf-8")).hexdigest()
    event = {
        "eventId": f"worker-{digest}",
        "kind": args.status,
        "sessionId": args.session_id,
        "agentId": args.agent_id,
        "agentType": "Codex worker",
        "turnId": None,
        "jobId": args.job_id,
    }
    if args.task is not None:
        event["taskTitle"] = args.task
    if not valid_event(event):
        raise ValueError("invalid report")
    return event


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--session-id", required=True)
    parser.add_argument("--agent-id", required=True)
    parser.add_argument("--job-id", required=True)
    parser.add_argument("--status", required=True, choices=("started", *WORKER_RESULTS))
    parser.add_argument("--task", help="Task title, required when reporting started")
    parser.add_argument("--runtime-dir", type=Path, default=srv.default_runtime_dir("codex"))
    parser.add_argument("--url", default=DEFAULT_URL)
    args = parser.parse_args(argv)

    try:
        port = receiver_port(args.url)
        event = build_report(args)
        header_path = srv.header_file(args.runtime_dir.expanduser(), srv.CODEX_HOOK_SOURCE)
        header = HEADER_RE.fullmatch(header_path.read_text(encoding="utf-8").strip())
        if header is None:
            raise ValueError("invalid header")
    except (OSError, ValueError, RuntimeError):
        print("report_status=0\nresult=rejected", file=sys.stderr)
        return 2

    # Connect directly to the loopback address. http.client does not use a
    # proxy or follow redirects, so the header stays with this local request.
    connection = http.client.HTTPConnection("127.0.0.1", port, timeout=5)
    try:
        connection.request(
            "POST",
            srv.CODEX_ACTIVITY_PATH,
            json.dumps(event, ensure_ascii=False).encode("utf-8"),
            {"Authorization": header[1], "Content-Type": "application/json; charset=utf-8"},
        )
        response = connection.getresponse()
        status = response.status
        raw = response.read(4096)
    except (OSError, http.client.HTTPException):
        print("report_status=0\nresult=unreachable", file=sys.stderr)
        return 3
    finally:
        connection.close()

    try:
        payload = json.loads(raw)
    except (UnicodeDecodeError, json.JSONDecodeError):
        payload = None
    accepted = status == 200 and isinstance(payload, dict) and payload.get("ok") is True
    if accepted:
        result = "deduped" if payload.get("deduped") is True else "ok"
    else:
        result = "rejected"
    print(f"report_status={status}\nresult={result}")
    return 0 if accepted else 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
