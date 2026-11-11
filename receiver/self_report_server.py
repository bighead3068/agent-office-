#!/usr/bin/env python3
"""Local multi-source self-report receiver.

Python 3.10 stdlib only. The default Bot roster uses 127.0.0.1:8793 and
agent-office-multi-report. The optional Codex roster uses 127.0.0.1:8794
and agent-office-codex-report. Port 8792 and agent-office-self-report are
reserved for the existing single-agent receiver.

Each trusted source gets its own header file. The token is never printed.
A request cannot choose a different source than the token. GET is same-origin,
unauthenticated, and sends no credential CORS. Freshness is calculated when
the snapshot is read. Nothing writes a fake heartbeat, idle, or timer status.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import secrets
import socket
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Callable, Optional

EVIDENCE_TYPE = "bot-self-report"
LEGACY_PORT = 8792
BOT_PORT = 8793
CODEX_PORT = 8794
LEGACY_RUNTIME_NAME = "agent-office-self-report"
RUNTIME_NAME = "agent-office-multi-report"
CODEX_RUNTIME_NAME = "agent-office-codex-report"
CODEX_ACTIVITY_PATH = "/api/codex-activity"
CODEX_HOOK_SOURCE = "codex-hook"
FIXTURE_SOURCE = "fixture-local"
FIXTURE_AGENT = "fixture-agent"
FIXTURE_NAME = "夾具代理人"
MAX_BODY = 4096
MAX_TITLE = 160
MAX_SEEN = 500
MAX_RECENT = 200
FUTURE_SKEW_MS = 60_000
DEFAULT_TTL_MS = 300_000
STATE_VERSION = 2
ID_RE = re.compile(r"^[A-Za-z0-9._:-]{1,80}$")
LABEL_RE = re.compile(r"^[A-Za-z0-9\u4e00-\u9fff ._-]{1,32}$")
TITLE_BAD = re.compile(r"[\x00-\x1f\x7f]")
TRUSTED = (
    {"agentId": "5be5c071-b5bd-4ed5-ba91-5c474954d171", "name": "專案／產品助手（協調）"},
    {"agentId": "7a961a88-8d6c-4afe-ada6-e28542084d0c", "name": "Agent Office 開發助手"},
    {"agentId": "892250dc-215a-4817-b9ae-64e538a22fe3", "name": "Agent Office 互動設計"},
    {"agentId": "cf8d7f4a-569c-48f8-86e0-a2d8b543c4e1", "name": "Agent Office 測試與授權"},
)
TRUSTED_IDS = tuple(item["agentId"] for item in TRUSTED)
COORDINATOR_ID = TRUSTED_IDS[0]
CODEX = (
    {"agentId": "codex-lead", "name": "Codex 協調"},
    {"agentId": "codex-api", "name": "Codex 接收器"},
    {"agentId": "codex-ui", "name": "Codex 看板"},
    {"agentId": "codex-qa", "name": "Codex 驗證"},
)
ROSTERS = {"bot": TRUSTED, "codex": CODEX}
ALLOWED_FIELDS = {"eventId", "type", "jobId", "at", "sourceId", "agentId", "label", "taskTitle"}
ALLOWED_TYPES = {"task.started", "task.completed", "task.failed", "task.progress"}


def default_runtime_dir(roster: str = "bot") -> Path:
    name = CODEX_RUNTIME_NAME if roster == "codex" else RUNTIME_NAME
    if os.name == "nt":
        root = os.environ.get("LOCALAPPDATA") or str(Path.home())
        return Path(root) / name
    data = os.environ.get("XDG_DATA_HOME")
    base = Path(data) if data else Path.home() / ".local" / "share"
    return base / name


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


def header_file(runtime: Path, agent_id: str) -> Path:
    if not ID_RE.fullmatch(agent_id):
        raise ValueError("bad agent id")
    directory = (runtime / "headers").resolve()
    path = (directory / f"{agent_id}.header").resolve()
    if path.parent != directory:
        raise ValueError("bad header path")
    return path


def issue_header(runtime: Path, agent_id: str) -> str:
    token = secrets.token_urlsafe(32)
    write_private(header_file(runtime, agent_id), f"Authorization: Bearer {token}\n")
    return token


def empty_state(partition: str, roster: tuple[dict, ...]) -> dict:
    return {
        "version": STATE_VERSION,
        "partition": partition,
        "seen": [],
        "events": [],
        "agents": {item["agentId"]: None for item in roster},
    }


def load_state(path: Path, partition: str, roster: tuple[dict, ...]) -> dict:
    if not path.exists():
        return empty_state(partition, roster)
    raw = json.loads(path.read_text(encoding="utf-8"))
    expected = [item["agentId"] for item in roster]
    if raw.get("version") != STATE_VERSION or raw.get("partition") != partition:
        raise SystemExit(f"refusing to load mismatched state file: {path}")
    if list(raw.get("agents", {})) != expected:
        raise SystemExit(f"refusing to load a state file for a different roster: {path}")
    return raw


def save_state(path: Path, state: dict) -> None:
    write_private(path, json.dumps(state, ensure_ascii=False, separators=(",", ":")))


def _title(value: object, required: bool) -> tuple[Optional[str], Optional[str]]:
    if value is None:
        if required:
            return None, "malformed"
        return None, None
    if not isinstance(value, str) or TITLE_BAD.search(value) or not (1 <= len(value) <= MAX_TITLE):
        return None, "malformed"
    return value, None


def parse_event(body: dict, bound_id: str) -> dict:
    if not isinstance(body, dict):
        return {"ok": False, "error": "malformed"}
    if set(body) - ALLOWED_FIELDS:
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
    if body["sourceId"] != bound_id or body["agentId"] != bound_id:
        return {"ok": False, "error": "identity_mismatch"}
    label = body.get("label")
    if label is not None and (not isinstance(label, str) or not LABEL_RE.fullmatch(label)):
        return {"ok": False, "error": "malformed"}
    title, title_error = _title(body.get("taskTitle"), required=body["type"] == "task.started")
    if title_error:
        return {"ok": False, "error": title_error}
    return {
        "ok": True,
        "event": {
            "eventId": body["eventId"],
            "type": body["type"],
            "jobId": body["jobId"],
            "at": body["at"],
            "sourceId": bound_id,
            "agentId": bound_id,
            "label": label,
            "taskTitle": title,
        },
    }


def apply_event(state: dict, event: dict, server_now: int) -> dict:
    if event["eventId"] in state["seen"]:
        return {"ok": True, "deduped": True}
    if event["agentId"] not in state["agents"]:
        return {"ok": False, "error": "identity_mismatch"}
    if event["at"] > server_now + FUTURE_SKEW_MS:
        return {"ok": False, "error": "malformed"}
    job = state["agents"][event["agentId"]]
    if job is not None and event["at"] <= job["lastEventAt"]:
        return {"ok": False, "error": "out_of_order"}
    phase = None if job is None else job["phase"]
    kind = event["type"]
    if kind == "task.started":
        if phase == "working":
            return {"ok": False, "error": "out_of_order"}
        if job is not None and job["jobId"] == event["jobId"] and phase in {"completed", "failed"}:
            return {"ok": False, "error": "out_of_order"}
        state["agents"][event["agentId"]] = {
            "jobId": event["jobId"],
            "phase": "working",
            "taskTitle": event["taskTitle"],
            "startedAt": event["at"],
            "terminalAt": None,
            "lastReportAt": server_now,
            "lastEventAt": event["at"],
            "lastEventId": event["eventId"],
            "lastType": kind,
            "callerLabel": event["label"],
        }
    elif kind == "task.progress":
        if job is None or phase != "working" or job["jobId"] != event["jobId"]:
            return {"ok": False, "error": "out_of_order"}
        if event["taskTitle"]:
            job["taskTitle"] = event["taskTitle"]
        job["lastReportAt"] = server_now
        job["lastEventAt"] = event["at"]
        job["lastEventId"] = event["eventId"]
        job["lastType"] = kind
    else:
        if job is None or phase != "working" or job["jobId"] != event["jobId"]:
            return {"ok": False, "error": "out_of_order"}
        job["phase"] = "completed" if kind == "task.completed" else "failed"
        job["terminalAt"] = event["at"]
        job["lastReportAt"] = server_now
        job["lastEventAt"] = event["at"]
        job["lastEventId"] = event["eventId"]
        job["lastType"] = kind
        if event["taskTitle"]:
            job["taskTitle"] = event["taskTitle"]
        if event["label"] is not None:
            job["callerLabel"] = event["label"]
    state["seen"].append(event["eventId"])
    del state["seen"][:-MAX_SEEN]
    state["events"].append(
        {
            "eventId": event["eventId"],
            "type": kind,
            "jobId": event["jobId"],
            "at": event["at"],
            "acceptedAt": server_now,
            "sourceId": event["sourceId"],
            "agentId": event["agentId"],
            "taskTitle": event["taskTitle"],
            "evidenceType": EVIDENCE_TYPE,
        }
    )
    del state["events"][:-MAX_RECENT]
    return {"ok": True, "deduped": False}


def project_agent(state: dict, agent_id: str, name: str, now: int, ttl_ms: int) -> dict:
    job = state["agents"].get(agent_id)
    base = {
        "agentId": agent_id,
        "sourceId": agent_id if state["partition"] == "real" else FIXTURE_SOURCE if agent_id == FIXTURE_AGENT else agent_id,
        "name": name,
        "evidenceType": EVIDENCE_TYPE if state["partition"] == "real" else "fixture",
    }
    if state["partition"] == "fixture":
        base["sourceId"] = FIXTURE_SOURCE
    if job is None:
        base.update(
            {
                "effectiveStatus": "unknown",
                "lastKnownStatus": None,
                "freshness": "none",
                "reason": "missing_report",
                "jobId": None,
                "taskTitle": None,
                "startedAt": None,
                "terminalAt": None,
                "lastReportAt": None,
                "callerLabel": None,
                "provenance": None,
            }
        )
        return base
    stale = now - job["lastReportAt"] > ttl_ms
    base.update(
        {
            "effectiveStatus": "unknown" if stale else job["phase"],
            "lastKnownStatus": job["phase"],
            "freshness": "stale" if stale else "fresh",
            "reason": "ttl" if stale else "report",
            "jobId": job["jobId"],
            "taskTitle": job["taskTitle"],
            "startedAt": job["startedAt"],
            "terminalAt": job["terminalAt"],
            "lastReportAt": job["lastReportAt"],
            "callerLabel": job["callerLabel"],
            "provenance": {
                "sourceId": base["sourceId"],
                "agentId": agent_id,
                "eventId": job["lastEventId"],
                "type": job["lastType"],
                "at": job["lastEventAt"],
                "evidenceType": base["evidenceType"],
            },
        }
    )
    return base


def project(state: dict, roster: tuple[dict, ...], now: int, ttl_ms: int) -> dict:
    agents = [project_agent(state, item["agentId"], item["name"], now, ttl_ms) for item in roster]
    primary = dict(agents[0])
    recent = [dict(item) for item in state["events"][-20:]]
    return {
        "partition": state["partition"],
        "evidenceType": EVIDENCE_TYPE if state["partition"] == "real" else "fixture",
        "ttlMs": ttl_ms,
        "serverNow": now,
        "agents": agents,
        "recent": recent,
        "sourceId": primary["sourceId"],
        "agentId": primary["agentId"],
        "effectiveStatus": primary["effectiveStatus"],
        "lastKnownStatus": primary["lastKnownStatus"],
        "freshness": primary["freshness"],
        "reason": primary["reason"],
        "jobId": primary["jobId"],
        "taskTitle": primary["taskTitle"],
        "startedAt": primary["startedAt"],
        "terminalAt": primary["terminalAt"],
        "lastReportAt": primary["lastReportAt"],
        "callerLabel": primary["callerLabel"],
        "provenance": primary["provenance"],
    }


class App:
    def __init__(
        self, runtime: Path, ttl_ms: int, enable_fixtures: bool, static_dir: Optional[Path], *, roster: str = "bot"
    ) -> None:
        self.runtime = runtime
        self.ttl_ms = ttl_ms
        self.static_dir = static_dir
        self.lock = threading.Lock()
        self.roster_name = roster
        self.roster = ROSTERS[roster]
        self.real_state_path = runtime / "state.json"
        self.real_state = load_state(self.real_state_path, "real", self.roster)
        self.fixture_token = None
        self.fixture_state = None
        self.fixture_state_path = None
        self.fixture_roster = ({"agentId": FIXTURE_AGENT, "name": FIXTURE_NAME},)
        if enable_fixtures:
            self.fixture_state_path = runtime / "fixture-state.json"
            self.fixture_state = load_state(self.fixture_state_path, "fixture", self.fixture_roster)
        foreign_roster = CODEX if roster == "bot" else TRUSTED
        if any(header_file(runtime, item["agentId"]).exists() for item in foreign_roster):
            raise SystemExit(f"refusing to use a runtime directory for a different roster: {runtime}")
        runtime.mkdir(parents=True, exist_ok=True)
        # Claim a fresh runtime before issuing credentials, even if no reports are saved yet.
        marker = runtime / "roster"
        try:
            with marker.open("x", encoding="ascii") as stream:
                stream.write(roster)
        except FileExistsError:
            try:
                saved_roster = marker.read_text(encoding="ascii")
            except PermissionError:
                if os.name != "nt":
                    raise
                # Older receivers could leave this marker without an inherited Windows ACL.
                restrict(marker)
                saved_roster = marker.read_text(encoding="ascii")
            if saved_roster != roster:
                raise SystemExit(f"refusing to use a runtime directory for a different roster: {runtime}")
        else:
            restrict(marker)
        restrict(runtime)
        self.activity = None
        self.activity_token = None
        if roster == "codex":
            if __package__:
                from .codex_activity import ActivityStore
            else:
                from codex_activity import ActivityStore

            activity_path = runtime / "codex-activity.sqlite3"
            self.activity = ActivityStore(activity_path)
            restrict(activity_path)
            self.activity_token = issue_header(runtime, CODEX_HOOK_SOURCE)
        self.tokens = {item["agentId"]: issue_header(runtime, item["agentId"]) for item in self.roster}
        if enable_fixtures:
            self.fixture_token = issue_header(runtime, FIXTURE_AGENT)

    def classify(self, token: str) -> Optional[tuple[str, str]]:
        for agent_id, saved in self.tokens.items():
            if secrets.compare_digest(token, saved):
                return ("real", agent_id)
        if self.fixture_token and secrets.compare_digest(token, self.fixture_token):
            return ("fixture", FIXTURE_AGENT)
        return None

    def snapshot(self, partition: str) -> dict:
        with self.lock:
            if partition == "fixture":
                if self.fixture_state is None:
                    return {"ok": False, "error": "fixtures_disabled"}
                return project(self.fixture_state, self.fixture_roster, now_ms(), self.ttl_ms)
            snapshot = project(self.real_state, self.roster, now_ms(), self.ttl_ms)
            if self.roster_name == "codex":
                snapshot["roster"] = self.roster_name
            return snapshot

    def accept(self, partition: str, kind: str, bound_id: str, body: dict) -> tuple[int, dict]:
        if kind != partition:
            return 403, {"ok": False, "error": "wrong_partition"}
        if partition == "fixture" and self.fixture_state is None:
            return 404, {"ok": False, "error": "fixtures_disabled"}
        parsed = parse_event(body, bound_id)
        if not parsed["ok"]:
            code = 403 if parsed["error"] == "identity_mismatch" else 400
            return code, parsed
        with self.lock:
            state = self.real_state if partition == "real" else self.fixture_state
            before = json.dumps(state, ensure_ascii=False, sort_keys=True)
            result = apply_event(state, parsed["event"], now_ms())
            if result["ok"] and not result["deduped"]:
                path = self.real_state_path if partition == "real" else self.fixture_state_path
                save_state(path, state)
            elif json.dumps(state, ensure_ascii=False, sort_keys=True) != before and not result["ok"]:
                raise RuntimeError("rejected event mutated state")
        status = 200 if result["ok"] else 409 if result["error"] == "out_of_order" else 400
        return status, result


def now_ms() -> int:
    return int(time.time() * 1000)


def make_handler(app: App):
    class Handler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def log_message(self, fmt: str, *args) -> None:
            sys.stderr.write("multi-report %s\n" % (fmt % args))

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
                service = CODEX_RUNTIME_NAME if app.roster_name == "codex" else RUNTIME_NAME
                payload = {"ok": True, "service": service, "evidenceType": EVIDENCE_TYPE}
                if app.activity is not None:
                    payload["codexActivity"] = True
                self._send(200, payload)
                return
            if path == CODEX_ACTIVITY_PATH:
                if app.activity is None:
                    self._send(404, {"ok": False, "error": "not_found"})
                else:
                    self._send(200, app.activity.snapshot())
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
            activity = app.activity if path == CODEX_ACTIVITY_PATH else None
            if partition is None and activity is None:
                self._send(404, {"ok": False, "error": "not_found"})
                return
            header = self.headers.get("Authorization", "")
            if not header.startswith("Bearer ") or header == "Bearer ":
                self._send(401, {"ok": False, "error": "unauthorized"})
                return
            token = header[7:].strip()
            if not token.isascii():
                self._send(401, {"ok": False, "error": "unauthorized"})
                return
            if activity is not None:
                if not secrets.compare_digest(token, app.activity_token):
                    self._send(401, {"ok": False, "error": "unauthorized"})
                    return
            else:
                found = app.classify(token)
                if found is None:
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
            except (UnicodeDecodeError, json.JSONDecodeError, RecursionError):
                self._send(400, {"ok": False, "error": "malformed"})
                return
            if activity is not None:
                status, payload = activity.accept(body, now_ms())
            else:
                kind, bound_id = found
                status, payload = app.accept(partition, kind, bound_id, body)
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


def serve(app: App | Callable[[], App], host: str, port: int) -> ThreadingHTTPServer:
    httpd = ThreadingHTTPServer((host, port), BaseHTTPRequestHandler, bind_and_activate=False)
    try:
        if os.name == "nt":
            # On Windows SO_REUSEADDR can permit a second server to bind a live port.
            httpd.allow_reuse_address = False
            httpd.socket.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        httpd.server_bind()
        httpd.server_activate()
        httpd.RequestHandlerClass = make_handler(app() if callable(app) else app)
    except BaseException:
        httpd.server_close()
        raise
    return httpd


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Agent Office multi-source self-report receiver")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int)
    parser.add_argument("--roster", choices=ROSTERS, default="bot")
    parser.add_argument("--runtime-dir", default="")
    parser.add_argument("--static-dir", default="")
    parser.add_argument("--ttl-ms", type=int, default=DEFAULT_TTL_MS)
    parser.add_argument("--enable-fixtures", action="store_true")
    return parser


def main(argv: list[str]) -> int:
    args = build_parser().parse_args(argv)
    codex = args.roster == "codex"
    default_port = CODEX_PORT if codex else BOT_PORT
    port = args.port if args.port is not None else default_port
    if port == LEGACY_PORT:
        print(f"refusing port 8792; leave the existing receiver running and use {default_port}", file=sys.stderr)
        return 2
    if codex and port == BOT_PORT:
        print(f"refusing port {port}; it belongs to the other roster", file=sys.stderr)
        return 2
    if args.ttl_ms <= 0:
        print("ttl-ms must be positive", file=sys.stderr)
        return 2
    runtime = Path(args.runtime_dir).expanduser() if args.runtime_dir else default_runtime_dir(args.roster)
    runtime_parts = {part.casefold() for part in (*runtime.absolute().parts, *runtime.resolve().parts)}
    foreign_runtime = RUNTIME_NAME if codex else CODEX_RUNTIME_NAME
    if LEGACY_RUNTIME_NAME in runtime_parts or foreign_runtime in runtime_parts:
        print("refusing a runtime directory reserved for another receiver", file=sys.stderr)
        return 2
    static_dir = Path(args.static_dir).expanduser() if args.static_dir else None
    if args.host not in {"127.0.0.1", "::1", "localhost"}:
        print("warning: bind is not loopback. GET has no auth. Do not open a firewall.", file=sys.stderr)
    try:
        with serve(lambda: App(runtime, args.ttl_ms, args.enable_fixtures, static_dir, roster=args.roster), args.host, port) as httpd:
            bound_host, bound_port = httpd.server_address[:2]
            print(f"bind={bound_host}:{bound_port}")
            print(f"runtime_dir={runtime}")
            print(f"header_dir={runtime / 'headers'}")
            print("agents=" + ",".join(item["agentId"] for item in ROSTERS[args.roster]))
            print(f"ttl_ms={args.ttl_ms}")
            print(f"evidence={EVIDENCE_TYPE}")
            print("token_not_printed=yes")
            httpd.serve_forever()
    except KeyboardInterrupt:
        return 0
    except OSError as error:
        print(f"receiver startup failed: {error}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
