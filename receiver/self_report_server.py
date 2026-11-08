#!/usr/bin/env python3
"""Local self-report receiver for Agent Office.

Python 3.10 stdlib only. Default bind is 127.0.0.1. This is a local-network
tool, not an internet service. The write token is generated at startup and
stored only in the runtime directory, which must sit outside the source tree.
The token is never printed. GET is same-origin and unauthenticated so the
browser does not embed the write token. No CORS credential headers are sent.

The real token is bound to one source and agent id. A caller-supplied label
is not identity. Fixture credentials use a different token and partition.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import secrets
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Optional

REAL_ID = "5be5c071-b5bd-4ed5-ba91-5c474954d171"
FIXTURE_SOURCE = "fixture-local"
FIXTURE_AGENT = "fixture-agent"
MAX_BODY = 2048
MAX_SEEN = 500
MAX_RECENT = 200
FUTURE_SKEW_MS = 60_000
ID_RE = re.compile(r"^[A-Za-z0-9._:-]{1,80}$")
LABEL_RE = re.compile(r"^[A-Za-z0-9\u4e00-\u9fff ._-]{1,32}$")
ALLOWED_FIELDS = {"eventId", "type", "jobId", "at", "sourceId", "agentId", "label"}
ALLOWED_TYPES = {"task.started", "task.completed", "task.failed"}
STATE_VERSION = 1


def default_runtime_dir() -> Path:
    if os.name == "nt":
        root = os.environ.get("LOCALAPPDATA") or str(Path.home())
        return Path(root) / "agent-office-self-report"
    data = os.environ.get("XDG_DATA_HOME")
    base = Path(data) if data else Path.home() / ".local" / "share"
    return base / "agent-office-self-report"


def restrict(path: Path) -> None:
    if os.name == "nt":
        user = os.environ.get("USERNAME") or ""
        domain = os.environ.get("USERDOMAIN") or ""
        account = f"{domain}\\{user}" if domain and user else user
        if not account:
            return
        import subprocess

        subprocess.run(
            ["icacls", str(path), "/inheritance:r", "/grant:r", f"{account}:(F)"],
            check=False,
            capture_output=True,
            text=True,
        )
        return
    os.chmod(path, 0o600 if path.is_file() else 0o700)


def write_private(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    restrict(path.parent)
    temporary = path.with_name(path.name + ".tmp")
    temporary.write_text(text, encoding="utf-8", newline="\n")
    restrict(temporary)
    os.replace(temporary, path)
    restrict(path)


def empty_state(partition: str, source_id: str, agent_id: str) -> dict:
    return {
        "version": STATE_VERSION,
        "partition": partition,
        "sourceId": source_id,
        "agentId": agent_id,
        "seen": [],
        "events": [],
        "job": None,
    }


def load_state(path: Path, partition: str, source_id: str, agent_id: str) -> dict:
    if not path.exists():
        return empty_state(partition, source_id, agent_id)
    raw = json.loads(path.read_text(encoding="utf-8"))
    if raw.get("version") != STATE_VERSION or raw.get("partition") != partition:
        raise SystemExit(f"refusing to load mismatched state file: {path}")
    if raw.get("sourceId") != source_id or raw.get("agentId") != agent_id:
        raise SystemExit(f"refusing to load state bound to a different identity: {path}")
    return raw


def save_state(path: Path, state: dict) -> None:
    write_private(path, json.dumps(state, ensure_ascii=False, separators=(",", ":")))


def issue_token(directory: Path, stem: str) -> str:
    token = secrets.token_urlsafe(32)
    write_private(directory / stem, token + "\n")
    write_private(directory / f"{stem}-auth.header", f"Authorization: Bearer {token}\n")
    return token


def parse_event(body: dict, binding: dict) -> dict:
    if not isinstance(body, dict):
        return {"ok": False, "error": "malformed"}
    extra = set(body) - ALLOWED_FIELDS
    if extra:
        return {"ok": False, "error": "unexpected_field"}
    for key in ("eventId", "type", "jobId", "at", "sourceId", "agentId"):
        if key not in body:
            return {"ok": False, "error": "malformed"}
    if not isinstance(body["eventId"], str) or not ID_RE.fullmatch(body["eventId"]):
        return {"ok": False, "error": "malformed"}
    if not isinstance(body["jobId"], str) or not ID_RE.fullmatch(body["jobId"]):
        return {"ok": False, "error": "malformed"}
    if body["type"] not in ALLOWED_TYPES:
        return {"ok": False, "error": "malformed"}
    if type(body["at"]) is not int:
        return {"ok": False, "error": "malformed"}
    if body["sourceId"] != binding["sourceId"] or body["agentId"] != binding["agentId"]:
        return {"ok": False, "error": "identity_mismatch"}
    label = body.get("label")
    if label is not None:
        if not isinstance(label, str) or not LABEL_RE.fullmatch(label):
            return {"ok": False, "error": "malformed"}
    return {
        "ok": True,
        "event": {
            "eventId": body["eventId"],
            "type": body["type"],
            "jobId": body["jobId"],
            "at": body["at"],
            "sourceId": binding["sourceId"],
            "agentId": binding["agentId"],
            "label": label,
        },
    }


def apply_event(state: dict, event: dict, server_now: int) -> dict:
    if event["eventId"] in state["seen"]:
        return {"ok": True, "deduped": True}
    if event["at"] > server_now + FUTURE_SKEW_MS:
        return {"ok": False, "error": "malformed"}
    job = state["job"]
    if job is not None and event["at"] <= job["lastEventAt"]:
        return {"ok": False, "error": "out_of_order"}
    phase = None if job is None else job["phase"]
    if event["type"] == "task.started":
        if phase == "working":
            return {"ok": False, "error": "out_of_order"}
        if job is not None and job["jobId"] == event["jobId"] and phase in {"completed", "failed"}:
            return {"ok": False, "error": "out_of_order"}
        state["job"] = {
            "jobId": event["jobId"],
            "phase": "working",
            "startedAt": event["at"],
            "terminalAt": None,
            "lastReportAt": server_now,
            "lastEventAt": event["at"],
            "lastEventId": event["eventId"],
            "lastType": event["type"],
            "callerLabel": event["label"],
        }
    else:
        if job is None or phase != "working" or job["jobId"] != event["jobId"]:
            return {"ok": False, "error": "out_of_order"}
        job["phase"] = "completed" if event["type"] == "task.completed" else "failed"
        job["terminalAt"] = event["at"]
        job["lastReportAt"] = server_now
        job["lastEventAt"] = event["at"]
        job["lastEventId"] = event["eventId"]
        job["lastType"] = event["type"]
        if event["label"] is not None:
            job["callerLabel"] = event["label"]
    state["seen"].append(event["eventId"])
    del state["seen"][:-MAX_SEEN]
    state["events"].append(
        {
            "eventId": event["eventId"],
            "type": event["type"],
            "jobId": event["jobId"],
            "at": event["at"],
            "acceptedAt": server_now,
            "sourceId": event["sourceId"],
            "agentId": event["agentId"],
        }
    )
    del state["events"][:-MAX_RECENT]
    return {"ok": True, "deduped": False}


def project(state: dict, now: int, ttl_ms: int) -> dict:
    job = state["job"]
    base = {
        "partition": state["partition"],
        "sourceId": state["sourceId"],
        "agentId": state["agentId"],
        "ttlMs": ttl_ms,
        "serverNow": now,
        "recent": list(state["events"][-20:]),
    }
    if job is None:
        base.update(
            {
                "effectiveStatus": "unknown",
                "lastKnownStatus": None,
                "freshness": "none",
                "reason": "missing_report",
                "jobId": None,
                "startedAt": None,
                "terminalAt": None,
                "lastReportAt": None,
                "callerLabel": None,
                "provenance": None,
            }
        )
        return base
    stale = now - job["lastReportAt"] > ttl_ms
    provenance = {
        "sourceId": state["sourceId"],
        "agentId": state["agentId"],
        "eventId": job["lastEventId"],
        "type": job["lastType"],
        "at": job["lastEventAt"],
    }
    base.update(
        {
            "effectiveStatus": "unknown" if stale else job["phase"],
            "lastKnownStatus": job["phase"],
            "freshness": "stale" if stale else "fresh",
            "reason": "ttl" if stale else "report",
            "jobId": job["jobId"],
            "startedAt": job["startedAt"],
            "terminalAt": job["terminalAt"],
            "lastReportAt": job["lastReportAt"],
            "callerLabel": job["callerLabel"],
            "provenance": provenance,
        }
    )
    return base


class App:
    def __init__(self, runtime: Path, ttl_ms: int, enable_fixtures: bool, static_dir: Optional[Path]) -> None:
        self.runtime = runtime
        self.ttl_ms = ttl_ms
        self.static_dir = static_dir
        self.lock = threading.Lock()
        runtime.mkdir(parents=True, exist_ok=True)
        restrict(runtime)
        self.real_token = issue_token(runtime, "token")
        self.real_state_path = runtime / "state.json"
        self.real_state = load_state(self.real_state_path, "real", REAL_ID, REAL_ID)
        self.fixture_token = None
        self.fixture_state = None
        self.fixture_state_path = None
        if enable_fixtures:
            self.fixture_token = issue_token(runtime, "fixture")
            self.fixture_state_path = runtime / "fixture-state.json"
            self.fixture_state = load_state(self.fixture_state_path, "fixture", FIXTURE_SOURCE, FIXTURE_AGENT)

    def classify(self, token: str) -> Optional[str]:
        if secrets.compare_digest(token, self.real_token):
            return "real"
        if self.fixture_token and secrets.compare_digest(token, self.fixture_token):
            return "fixture"
        return None

    def binding(self, partition: str) -> dict:
        if partition == "real":
            return {"partition": "real", "sourceId": REAL_ID, "agentId": REAL_ID}
        return {"partition": "fixture", "sourceId": FIXTURE_SOURCE, "agentId": FIXTURE_AGENT}

    def snapshot(self, partition: str) -> dict:
        with self.lock:
            state = self.real_state if partition == "real" else self.fixture_state
            if state is None:
                return {"ok": False, "error": "fixtures_disabled"}
            return project(state, now_ms(), self.ttl_ms)

    def accept(self, partition: str, token_partition: str, body: dict) -> tuple[int, dict]:
        if token_partition != partition:
            return 403, {"ok": False, "error": "wrong_partition"}
        if partition == "fixture" and self.fixture_state is None:
            return 404, {"ok": False, "error": "fixtures_disabled"}
        parsed = parse_event(body, self.binding(partition))
        if not parsed["ok"]:
            code = 403 if parsed["error"] == "identity_mismatch" else 400
            return code, parsed
        with self.lock:
            state = self.real_state if partition == "real" else self.fixture_state
            result = apply_event(state, parsed["event"], now_ms())
            if result["ok"] and not result["deduped"]:
                path = self.real_state_path if partition == "real" else self.fixture_state_path
                save_state(path, state)
        status = 200 if result["ok"] else 409 if result["error"] == "out_of_order" else 400
        return status, result


def now_ms() -> int:
    return int(time.time() * 1000)


def make_handler(app: App):
    class Handler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def log_message(self, fmt: str, *args) -> None:
            sys.stderr.write("self-report %s\n" % (fmt % args))

        def _send(self, status: int, payload: Optional[dict] = None, body: bytes = b"", content_type: str = "application/json; charset=utf-8") -> None:
            data = body if payload is None else json.dumps(payload, ensure_ascii=False).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Connection", "close")
            self.end_headers()
            self.wfile.write(data)

        def _partition(self, path: str) -> Optional[str]:
            if path == "/api/self-report":
                return "real"
            if path == "/api/fixture-report":
                return "fixture"
            return None

        def do_GET(self) -> None:  # noqa: N802
            path = self.path.split("?", 1)[0]
            if path == "/health":
                self._send(200, {"ok": True, "service": "agent-office-self-report"})
                return
            partition = self._partition(path)
            if partition:
                if partition == "fixture" and app.fixture_state is None:
                    self._send(404, {"ok": False, "error": "fixtures_disabled"})
                    return
                self._send(200, app.snapshot(partition))
                return
            self._static(path)

        def do_POST(self) -> None:  # noqa: N802
            path = self.path.split("?", 1)[0]
            partition = self._partition(path)
            if partition is None:
                self._send(404, {"ok": False, "error": "not_found"})
                return
            header = self.headers.get("Authorization", "")
            if not header.startswith("Bearer ") or header == "Bearer ":
                self._send(401, {"ok": False, "error": "unauthorized"})
                return
            token = header[7:].strip()
            kind = app.classify(token)
            if kind is None:
                self._send(401, {"ok": False, "error": "unauthorized"})
                return
            try:
                length = int(self.headers.get("Content-Length", "0"))
            except ValueError:
                self._send(400, {"ok": False, "error": "malformed"})
                return
            if length <= 0 or length > MAX_BODY:
                self._send(413 if length > MAX_BODY else 400, {"ok": False, "error": "too_large" if length > MAX_BODY else "malformed"})
                return
            raw = self.rfile.read(length)
            try:
                body = json.loads(raw.decode("utf-8"))
            except (UnicodeDecodeError, json.JSONDecodeError):
                self._send(400, {"ok": False, "error": "malformed"})
                return
            status, payload = app.accept(partition, kind, body)
            self._send(status, payload)

        def do_OPTIONS(self) -> None:  # noqa: N802
            self._send(204, body=b"", content_type="text/plain; charset=utf-8")

        def _static(self, path: str) -> None:
            root = app.static_dir
            if root is None:
                self._send(404, {"ok": False, "error": "no_frontend"})
                return
            relative = "index.html" if path in {"", "/"} else path.lstrip("/")
            candidate = (root / relative).resolve()
            try:
                candidate.relative_to(root.resolve())
            except ValueError:
                self._send(404, {"ok": False, "error": "not_found"})
                return
            if not candidate.is_file():
                self._send(404, {"ok": False, "error": "not_found"})
                return
            data = candidate.read_bytes()
            kind = "text/html; charset=utf-8"
            if candidate.suffix == ".js":
                kind = "text/javascript; charset=utf-8"
            elif candidate.suffix == ".css":
                kind = "text/css; charset=utf-8"
            elif candidate.suffix == ".svg":
                kind = "image/svg+xml"
            self._send(200, body=data, content_type=kind)

    return Handler


def serve(app: App, host: str, port: int) -> ThreadingHTTPServer:
    httpd = ThreadingHTTPServer((host, port), make_handler(app))
    httpd.daemon_threads = True
    return httpd


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Agent Office local self-report receiver")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8792)
    parser.add_argument("--runtime-dir", default="")
    parser.add_argument("--static-dir", default="")
    parser.add_argument("--ttl-ms", type=int, default=45000)
    parser.add_argument("--enable-fixtures", action="store_true")
    return parser


def main(argv: list[str]) -> int:
    args = build_parser().parse_args(argv)
    if args.ttl_ms <= 0:
        print("ttl-ms must be positive", file=sys.stderr)
        return 2
    runtime = Path(args.runtime_dir).expanduser() if args.runtime_dir else default_runtime_dir()
    static_dir = Path(args.static_dir).expanduser() if args.static_dir else None
    if args.host not in {"127.0.0.1", "::1", "localhost"}:
        print(
            "warning: bind is not loopback. GET has no auth. This is still not an internet service. Do not open a firewall.",
            file=sys.stderr,
        )
    app = App(runtime, args.ttl_ms, args.enable_fixtures, static_dir)
    httpd = serve(app, args.host, args.port)
    bound_host, bound_port = httpd.server_address[:2]
    print(f"bind={bound_host}:{bound_port}")
    print(f"runtime_dir={runtime}")
    print(f"auth_header={runtime / 'token-auth.header'}")
    if args.enable_fixtures:
        print(f"fixture_auth_header={runtime / 'fixture-auth.header'}")
    print(f"static_dir={static_dir if static_dir else 'none'}")
    print("token_not_printed=yes")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        return 0
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
