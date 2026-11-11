#!/usr/bin/env python3
"""Agent Office v0.2 local receiver.

One process, one port, loopback only. It accepts bot self-reports and Codex
activity. Tokens stay in per-agent header files under the runtime directory
(outside the git checkout). SQLite in that same directory is the office state.

GET is unauthenticated on purpose: the browser on this machine must be able to
draw the floor. That is safe only because the process refuses every bind except
127.0.0.1 and never sends credential CORS. Write routes require a bearer token
and do not look at Origin.

Terminal reports (completed and failed) expire the same way as other reports.
After lastReportAt + ttlMs the effective status becomes unknown, freshness is
stale, and lastKnownStatus stays. Equality with the TTL is still fresh; one
millisecond past it is unknown. Nothing here invents idle. Idle is stored only
when a caller sends task.idle.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import secrets
import sqlite3
import sys
import threading
import time
import uuid
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Iterator, Optional
from urllib.parse import urlparse

VERSION = "0.2.0"
EVIDENCE_TYPE = "bot-self-report"
SERVICE_NAME = "agent-office"
OFFICE_PORT = 8795
RETIRED_PORTS = {8792, 8793, 8794}
RUNTIME_NAME = "agent-office"
LEGACY_RUNTIME_NAMES = {
    "agent-office-self-report",
    "agent-office-multi-report",
    "agent-office-codex-report",
}
CODEX_ACTIVITY_PATH = "/api/codex-activity"
CODEX_HOOK_SOURCE = "codex-hook"
CODEX_PORT = OFFICE_PORT
MAX_BODY = 4096
MAX_TITLE = 160
MAX_RECENT = 20
FUTURE_SKEW_MS = 60_000
DEFAULT_TTL_MS = 300_000
ID_RE = re.compile(r"^[A-Za-z0-9._:-]{1,80}$")
DISPLAY_RE = re.compile(r"^[^\x00-\x1f\x7f]{1,40}$")
TITLE_BAD = re.compile(r"[\x00-\x1f\x7f]")
SECRET_RE = re.compile(r"Bearer\s+\S+|token_urlsafe\([^)]*\)", re.IGNORECASE)
ALLOWED_FIELDS = {"eventId", "type", "jobId", "at", "sourceId", "agentId", "label", "taskTitle"}
ALLOWED_TYPES = {
    "task.started",
    "task.progress",
    "task.waiting",
    "task.blocked",
    "task.completed",
    "task.failed",
    "task.idle",
}
PHASE_BY_TYPE = {
    "task.started": "working",
    "task.progress": "working",
    "task.waiting": "waiting",
    "task.blocked": "blocked",
    "task.completed": "completed",
    "task.failed": "failed",
    "task.idle": "idle",
}
OPEN_PHASES = {"working", "waiting", "blocked"}
TOP_LEVEL_FORBIDDEN = {
    "sourceId",
    "agentId",
    "effectiveStatus",
    "lastKnownStatus",
    "freshness",
    "reason",
    "jobId",
    "taskTitle",
    "startedAt",
    "terminalAt",
    "lastReportAt",
    "callerLabel",
    "provenance",
}


def redact(text: str) -> str:
    return SECRET_RE.sub("Bearer [redacted]", text)


def default_runtime_dir(roster: str = "bot") -> Path:
    """One runtime directory for self-report and Codex activity."""
    del roster
    if os.name == "nt":
        root = os.environ.get("LOCALAPPDATA") or str(Path.home())
        return Path(root) / RUNTIME_NAME
    data = os.environ.get("XDG_DATA_HOME")
    base = Path(data) if data else Path.home() / ".local" / "share"
    return base / RUNTIME_NAME


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


def read_token(runtime: Path, agent_id: str) -> Optional[str]:
    path = header_file(runtime, agent_id)
    if not path.is_file():
        return None
    line = path.read_text(encoding="utf-8").strip()
    prefix = "Authorization: Bearer "
    if not line.startswith(prefix) or line == prefix.rstrip():
        return None
    token = line[len(prefix) :].strip()
    if not token or not token.isascii() or " " in token:
        return None
    return token


def issue_header(runtime: Path, agent_id: str) -> str:
    token = secrets.token_urlsafe(32)
    write_private(header_file(runtime, agent_id), f"Authorization: Bearer {token}\n")
    return token


def ensure_header(runtime: Path, agent_id: str) -> str:
    existing = read_token(runtime, agent_id)
    if existing:
        return existing
    return issue_header(runtime, agent_id)


def match_token(runtime: Path, token: str) -> Optional[str]:
    directory = runtime / "headers"
    if not directory.is_dir():
        return None
    for path in sorted(directory.glob("*.header")):
        agent_id = path.name[: -len(".header")]
        if not ID_RE.fullmatch(agent_id):
            continue
        saved = read_token(runtime, agent_id)
        if saved and secrets.compare_digest(saved, token):
            return agent_id
    return None


def read_register_key(runtime: Path) -> Optional[str]:
    path = runtime / "register.key"
    if not path.is_file():
        return None
    key = path.read_text(encoding="utf-8").strip()
    if not key or not key.isascii():
        return None
    return key


def ensure_register_key(runtime: Path) -> str:
    existing = read_register_key(runtime)
    if existing:
        return existing
    key = secrets.token_urlsafe(32)
    write_private(runtime / "register.key", key + "\n")
    return key


def report_command(agent_id: str, runtime: Path, url: str) -> str:
    return (
        "python receiver/report_task.py"
        f" --agent-id {agent_id}"
        " --job-id <JOB>"
        " --status started"
        ' --task "<TITLE>"'
        f" --runtime-dir {runtime}"
        f" --url {url}"
    )


def legacy_runtime(path: Path) -> bool:
    names = {part.casefold() for part in path.expanduser().parts}
    return bool(names & {name.casefold() for name in LEGACY_RUNTIME_NAMES})


def now_ms() -> int:
    return int(time.time() * 1000)


def _title(value: object, required: bool) -> tuple[Optional[str], Optional[str]]:
    if value is None:
        if required:
            return None, "malformed"
        return None, None
    if not isinstance(value, str) or TITLE_BAD.search(value) or not (1 <= len(value) <= MAX_TITLE):
        return None, "malformed"
    return value, None


def is_demo_body(body: object) -> bool:
    if not isinstance(body, dict):
        return False
    for key in ("mode", "partition", "sourceId", "agentId", "source", "roster"):
        value = body.get(key)
        if isinstance(value, str) and value.lower() in {"demo", "demo-sim", "simulation"}:
            return True
    return False


def parse_event(body: object, bound_id: str) -> dict:
    if is_demo_body(body):
        return {"ok": False, "error": "demo_rejected"}
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
    if label is not None and (not isinstance(label, str) or not DISPLAY_RE.fullmatch(label)):
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


def payload_hash(event: dict) -> str:
    canonical = {
        "agentId": event["agentId"],
        "jobId": event["jobId"],
        "type": event["type"],
        "taskTitle": event.get("taskTitle"),
        "label": event.get("label"),
    }
    raw = json.dumps(canonical, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(raw).hexdigest()


def decide(state: Optional[dict], event: dict) -> dict:
    kind = event["type"]
    phase = None if state is None else state["phase"]
    job = None if state is None else state["job_id"]
    last_at = None if state is None else state["last_event_at"]
    if phase is None:
        if kind not in {"task.started", "task.idle"}:
            return {"ok": False, "error": "out_of_order"}
        return {"ok": True}
    if event["at"] <= last_at:
        return {"ok": False, "error": "out_of_order"}
    same_job = event["jobId"] == job
    if not same_job and kind != "task.started":
        return {"ok": False, "error": "stale_job"}
    if kind == "task.started":
        if same_job and phase in {"working", "completed", "failed"}:
            return {"ok": False, "error": "out_of_order"}
        return {"ok": True}
    if kind == "task.progress":
        if not same_job or phase != "working":
            return {"ok": False, "error": "out_of_order"}
        return {"ok": True}
    if kind in {"task.waiting", "task.blocked"}:
        if not same_job or phase not in OPEN_PHASES:
            return {"ok": False, "error": "out_of_order"}
        return {"ok": True}
    if kind in {"task.completed", "task.failed"}:
        if not same_job or phase not in OPEN_PHASES:
            return {"ok": False, "error": "out_of_order"}
        return {"ok": True}
    if kind == "task.idle":
        return {"ok": True}
    return {"ok": False, "error": "malformed"}


SCHEMA = """
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS agents (
  agent_id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  seat INTEGER NOT NULL UNIQUE,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS events (
  event_id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  job_id TEXT NOT NULL,
  type TEXT NOT NULL,
  at INTEGER NOT NULL,
  task_title TEXT,
  caller_label TEXT,
  payload_hash TEXT NOT NULL,
  accepted_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS agent_state (
  agent_id TEXT PRIMARY KEY,
  job_id TEXT,
  phase TEXT,
  task_title TEXT,
  started_at INTEGER,
  terminal_at INTEGER,
  last_report_at INTEGER,
  last_event_at INTEGER,
  last_event_id TEXT,
  last_type TEXT,
  caller_label TEXT
);
"""


class OfficeStore:
    def __init__(self, path: Path) -> None:
        self.path = path
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.connect() as db:
            db.executescript(SCHEMA)
            row = db.execute("SELECT value FROM meta WHERE key = 'receiver_id'").fetchone()
            if row is None:
                db.execute(
                    "INSERT INTO meta (key, value) VALUES ('receiver_id', ?)",
                    (str(uuid.uuid4()),),
                )

    @contextmanager
    def connect(self) -> Iterator[sqlite3.Connection]:
        connection = sqlite3.connect(self.path, timeout=5, isolation_level=None)
        connection.row_factory = sqlite3.Row
        try:
            connection.execute("PRAGMA journal_mode=WAL")
            connection.execute("PRAGMA busy_timeout=5000")
            yield connection
        finally:
            connection.close()

    def receiver_id(self) -> str:
        with self.connect() as db:
            row = db.execute("SELECT value FROM meta WHERE key = 'receiver_id'").fetchone()
        return str(row["value"])

    def get_agent(self, agent_id: str) -> Optional[dict]:
        with self.connect() as db:
            row = db.execute("SELECT * FROM agents WHERE agent_id = ?", (agent_id,)).fetchone()
            return dict(row) if row is not None else None

    def insert_agent(self, agent_id: str, display_name: str, now: int) -> int:
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            try:
                used = {row["seat"] for row in db.execute("SELECT seat FROM agents")}
                seat = 0
                while seat in used:
                    seat += 1
                db.execute(
                    "INSERT INTO agents (agent_id, display_name, seat, created_at) VALUES (?, ?, ?, ?)",
                    (agent_id, display_name, seat, now),
                )
                db.execute("COMMIT")
            except Exception:
                db.execute("ROLLBACK")
                raise
            return seat

    def accept(self, bound_id: str, body: object, now: int) -> tuple[int, dict]:
        if is_demo_body(body):
            return 403, {"ok": False, "error": "demo_rejected"}
        parsed = parse_event(body, bound_id)
        if not parsed["ok"]:
            code = 403 if parsed["error"] in {"identity_mismatch", "demo_rejected"} else 400
            return code, {"ok": False, "error": parsed["error"]}
        event = parsed["event"]
        if event["at"] > now + FUTURE_SKEW_MS:
            return 400, {"ok": False, "error": "malformed"}
        digest = payload_hash(event)
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            try:
                agent = db.execute("SELECT agent_id FROM agents WHERE agent_id = ?", (bound_id,)).fetchone()
                if agent is None:
                    db.execute("ROLLBACK")
                    return 403, {"ok": False, "error": "unknown_agent"}
                existing = db.execute(
                    "SELECT payload_hash FROM events WHERE event_id = ?",
                    (event["eventId"],),
                ).fetchone()
                if existing is not None:
                    db.execute("ROLLBACK")
                    if existing["payload_hash"] == digest:
                        return 200, {"ok": True, "deduped": True}
                    return 409, {"ok": False, "error": "event_id_conflict"}
                state_row = db.execute("SELECT * FROM agent_state WHERE agent_id = ?", (bound_id,)).fetchone()
                state = dict(state_row) if state_row is not None else None
                decision = decide(state, event)
                if not decision["ok"]:
                    db.execute("ROLLBACK")
                    return 409, decision
                self._write_event(db, state, event, digest, now)
                db.execute("COMMIT")
            except Exception:
                db.execute("ROLLBACK")
                raise
        return 200, {"ok": True, "deduped": False}

    def _write_event(self, db: sqlite3.Connection, state: Optional[dict], event: dict, digest: str, now: int) -> None:
        kind = event["type"]
        phase = PHASE_BY_TYPE[kind]
        previous_title = None if state is None else state["task_title"]
        title = event["taskTitle"] if event["taskTitle"] else previous_title
        label = event["label"] if event["label"] is not None else (None if state is None else state["caller_label"])
        if state is None or state["phase"] is None or (kind == "task.started" and event["jobId"] != state["job_id"]):
            started = event["at"] if kind == "task.started" else None
        else:
            started = state["started_at"]
        if kind in {"task.completed", "task.failed"}:
            terminal = event["at"]
        elif state is not None and event["jobId"] == state["job_id"]:
            terminal = state["terminal_at"]
        else:
            terminal = None
        if kind == "task.started":
            terminal = None
            started = event["at"]
        db.execute(
            """
            INSERT INTO events (event_id, agent_id, job_id, type, at, task_title, caller_label, payload_hash, accepted_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (event["eventId"], event["agentId"], event["jobId"], kind, event["at"], event["taskTitle"], event["label"], digest, now),
        )
        db.execute(
            """
            INSERT INTO agent_state (
              agent_id, job_id, phase, task_title, started_at, terminal_at, last_report_at, last_event_at,
              last_event_id, last_type, caller_label
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(agent_id) DO UPDATE SET
              job_id = excluded.job_id,
              phase = excluded.phase,
              task_title = excluded.task_title,
              started_at = excluded.started_at,
              terminal_at = excluded.terminal_at,
              last_report_at = excluded.last_report_at,
              last_event_at = excluded.last_event_at,
              last_event_id = excluded.last_event_id,
              last_type = excluded.last_type,
              caller_label = excluded.caller_label
            """,
            (
                event["agentId"],
                event["jobId"],
                phase,
                title,
                started,
                terminal,
                now,
                event["at"],
                event["eventId"],
                kind,
                label,
            ),
        )

    def project(self, now: int, ttl_ms: int, receiver_id: Optional[str] = None) -> dict:
        with self.connect() as db:
            rows = [
                dict(row)
                for row in db.execute(
                    """
                    SELECT a.agent_id, a.display_name, a.seat, s.job_id, s.phase, s.task_title, s.started_at,
                           s.terminal_at, s.last_report_at, s.last_event_at, s.last_event_id, s.last_type, s.caller_label
                    FROM agents a
                    LEFT JOIN agent_state s ON s.agent_id = a.agent_id
                    ORDER BY a.seat ASC, a.agent_id ASC
                    """
                )
            ]
            recent_rows = [
                dict(row)
                for row in db.execute(
                    """
                    SELECT event_id, type, agent_id, job_id, task_title, at, accepted_at
                    FROM events ORDER BY accepted_at ASC, rowid ASC
                    """
                )
            ]
        agents = [project_agent(row, now, ttl_ms) for row in rows]
        recent = [
            {
                "eventId": row["event_id"],
                "type": row["type"],
                "agentId": row["agent_id"],
                "jobId": row["job_id"],
                "taskTitle": row["task_title"],
                "at": row["at"],
                "acceptedAt": row["accepted_at"],
            }
            for row in recent_rows[-MAX_RECENT:]
        ]
        payload = {
            "ok": True,
            "version": VERSION,
            "partition": "real",
            "evidenceType": EVIDENCE_TYPE,
            "ttlMs": ttl_ms,
            "serverNow": now,
            "agents": agents,
            "recent": recent,
        }
        if receiver_id:
            payload["receiverId"] = receiver_id
        return payload


def project_agent(row: dict, now: int, ttl_ms: int) -> dict:
    base = {
        "agentId": row["agent_id"],
        "sourceId": row["agent_id"],
        "name": row["display_name"],
        "seat": row["seat"],
        "evidenceType": EVIDENCE_TYPE,
    }
    if row["phase"] is None or row["last_report_at"] is None:
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
    # Terminal phases expire too. lastKnownStatus keeps completed or failed.
    stale = now - row["last_report_at"] > ttl_ms
    base.update(
        {
            "effectiveStatus": "unknown" if stale else row["phase"],
            "lastKnownStatus": row["phase"],
            "freshness": "stale" if stale else "fresh",
            "reason": "ttl" if stale else "report",
            "jobId": row["job_id"],
            "taskTitle": row["task_title"],
            "startedAt": row["started_at"],
            "terminalAt": row["terminal_at"],
            "lastReportAt": row["last_report_at"],
            "callerLabel": row["caller_label"],
            "provenance": {
                "sourceId": row["agent_id"],
                "agentId": row["agent_id"],
                "eventId": row["last_event_id"],
                "type": row["last_type"],
                "at": row["last_event_at"],
                "evidenceType": EVIDENCE_TYPE,
            },
        }
    )
    return base


def register_agent(runtime: Path, agent_id: str, display_name: str, *, rotate: bool = False, now: Optional[int] = None, url: str = "") -> dict:
    if not ID_RE.fullmatch(agent_id) or not isinstance(display_name, str) or not DISPLAY_RE.fullmatch(display_name):
        return {"ok": False, "error": "malformed"}
    if is_demo_body({"agentId": agent_id, "sourceId": agent_id}):
        return {"ok": False, "error": "demo_rejected"}
    runtime.mkdir(parents=True, exist_ok=True)
    restrict(runtime)
    store = OfficeStore(runtime / "office.sqlite3")
    stamp = now_ms() if now is None else now
    existing = store.get_agent(agent_id)
    public_url = url or f"http://127.0.0.1:{OFFICE_PORT}/api/self-report"
    header = header_file(runtime, agent_id)
    if existing is not None and not rotate:
        return {
            "ok": False,
            "error": "identity_exists",
            "agentId": agent_id,
            "displayName": existing["display_name"],
            "seat": existing["seat"],
            "headerFile": str(header),
        }
    if existing is not None and display_name != existing["display_name"]:
        return {"ok": False, "error": "identity_conflict", "agentId": agent_id, "displayName": existing["display_name"]}
    if existing is None:
        seat = store.insert_agent(agent_id, display_name, stamp)
        rotated = False
    else:
        seat = int(existing["seat"])
        rotated = True
    issue_header(runtime, agent_id)
    return {
        "ok": True,
        "rotated": rotated,
        "agentId": agent_id,
        "displayName": display_name,
        "seat": seat,
        "headerFile": str(header),
        "runtimeDir": str(runtime),
        "reportCommand": report_command(agent_id, runtime, public_url),
    }


class App:
    def __init__(self, runtime: Path, ttl_ms: int, enable_fixtures: bool = False, static_dir: Optional[Path] = None) -> None:
        del enable_fixtures  # v0.2 has no demo/fixture partition.
        self.runtime = runtime
        self.ttl_ms = ttl_ms
        self.static_dir = static_dir
        runtime.mkdir(parents=True, exist_ok=True)
        restrict(runtime)
        self.store = OfficeStore(runtime / "office.sqlite3")
        restrict(self.store.path)
        self.register_key = ensure_register_key(runtime)
        if __package__:
            from .codex_activity import ActivityStore
        else:
            from codex_activity import ActivityStore

        activity_path = runtime / "codex-activity.sqlite3"
        self.activity = ActivityStore(activity_path)
        restrict(activity_path)
        self.activity_token = ensure_header(runtime, CODEX_HOOK_SOURCE)

    def classify(self, token: str) -> Optional[str]:
        return match_token(self.runtime, token)

    def snapshot(self) -> dict:
        return self.store.project(now_ms(), self.ttl_ms, self.store.receiver_id())

    def accept_report(self, bound_id: str, body: object) -> tuple[int, dict]:
        if bound_id == CODEX_HOOK_SOURCE:
            return 403, {"ok": False, "error": "identity_mismatch"}
        return self.store.accept(bound_id, body, now_ms())


def make_handler(app: App):
    class Handler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def log_message(self, fmt: str, *args) -> None:
            try:
                line = fmt % args
            except Exception:
                line = " ".join(str(arg) for arg in args)
            sys.stderr.write("office %s\n" % redact(line))

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

        def _bearer(self) -> Optional[str]:
            header = self.headers.get("Authorization", "")
            if not header.startswith("Bearer ") or header == "Bearer ":
                return None
            token = header[7:].strip()
            if not token or not token.isascii():
                return None
            return token

        def do_GET(self) -> None:  # noqa: N802
            path = urlparse(self.path).path
            if path == "/health":
                self._send(
                    200,
                    {
                        "ok": True,
                        "version": VERSION,
                        "service": SERVICE_NAME,
                        "receiverId": app.store.receiver_id(),
                        "evidenceType": EVIDENCE_TYPE,
                        "codexActivity": True,
                        "getAuth": "loopback-only",
                        "bind": "127.0.0.1",
                    },
                )
                return
            if path in {"/api/state", "/api/self-report"}:
                self._send(200, app.snapshot())
                return
            if path == "/api/state/stream":
                payload = json.dumps(app.snapshot(), ensure_ascii=False)
                self._send(200, body=f"data: {payload}\n\n".encode("utf-8"), content_type="text/event-stream; charset=utf-8")
                return
            if path == CODEX_ACTIVITY_PATH:
                self._send(200, app.activity.snapshot())
                return
            if path == "/api/fixture-report":
                self._send(404, {"ok": False, "error": "fixtures_disabled"})
                return
            self._static(path)

        def do_POST(self) -> None:  # noqa: N802
            path = urlparse(self.path).path
            if path == "/api/fixture-report":
                self._send(404, {"ok": False, "error": "fixtures_disabled"})
                return
            if path not in {"/api/self-report", "/api/agents/register", CODEX_ACTIVITY_PATH}:
                self._send(404, {"ok": False, "error": "not_found"})
                return
            token = self._bearer()
            if token is None:
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
            if path == "/api/agents/register":
                if not secrets.compare_digest(token, app.register_key):
                    self._send(401, {"ok": False, "error": "unauthorized"})
                    return
                status, payload = register_http(app, body)
                self._send(status, payload)
                return
            if path == CODEX_ACTIVITY_PATH:
                if not secrets.compare_digest(token, app.activity_token):
                    self._send(401, {"ok": False, "error": "unauthorized"})
                    return
                if is_demo_body(body):
                    self._send(403, {"ok": False, "error": "demo_rejected"})
                    return
                status, payload = app.activity.accept(body, now_ms())
                if status == 200 and isinstance(body, dict) and body.get("jobId") and body.get("kind") in {"started", "completed", "failed"}:
                    mirror_activity(app, body)
                self._send(status, payload)
                return
            found = app.classify(token)
            if found is None:
                self._send(401, {"ok": False, "error": "unauthorized"})
                return
            status, payload = app.accept_report(found, body)
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
            kind = "application/octet-stream"
            if candidate.suffix == ".html":
                kind = "text/html; charset=utf-8"
            elif candidate.suffix == ".js":
                kind = "text/javascript; charset=utf-8"
            elif candidate.suffix == ".css":
                kind = "text/css; charset=utf-8"
            elif candidate.suffix == ".svg":
                kind = "image/svg+xml"
            elif candidate.suffix == ".ttf":
                kind = "font/ttf"
            elif candidate.suffix == ".woff2":
                kind = "font/woff2"
            self._send(200, body=data, content_type=kind)

    return Handler


def register_http(app: App, body: object) -> tuple[int, dict]:
    if not isinstance(body, dict):
        return 400, {"ok": False, "error": "malformed"}
    allowed = {"agentId", "displayName", "rotate"}
    if set(body) - allowed or "agentId" not in body or "displayName" not in body:
        return 400, {"ok": False, "error": "malformed"}
    rotate = body.get("rotate", False)
    if not isinstance(rotate, bool):
        return 400, {"ok": False, "error": "malformed"}
    result = register_agent(app.runtime, str(body["agentId"]), str(body["displayName"]) if isinstance(body["displayName"], str) else "", rotate=rotate)
    if result.get("ok"):
        public = {key: result[key] for key in ("ok", "rotated", "agentId", "displayName", "seat", "headerFile", "reportCommand")}
        return 200, public
    code = 409 if result.get("error") in {"identity_exists", "identity_conflict"} else 400
    if result.get("error") == "demo_rejected":
        code = 403
    return code, {"ok": False, "error": result.get("error")}


def mirror_activity(app: App, body: dict) -> None:
    agent_id = body.get("agentId")
    if not isinstance(agent_id, str) or app.store.get_agent(agent_id) is None:
        return
    kind = {"started": "task.started", "completed": "task.completed", "failed": "task.failed"}[body["kind"]]
    mapped = {
        "eventId": body.get("eventId"),
        "type": kind,
        "jobId": body.get("jobId"),
        "at": now_ms(),
        "sourceId": agent_id,
        "agentId": agent_id,
    }
    if body.get("taskTitle"):
        mapped["taskTitle"] = body["taskTitle"]
    app.store.accept(agent_id, mapped, now_ms())


def serve(app: App, host: str, port: int) -> ThreadingHTTPServer:
    if host != "127.0.0.1":
        raise OSError("refusing non-loopback bind")
    httpd = ThreadingHTTPServer((host, port), BaseHTTPRequestHandler, bind_and_activate=False)
    try:
        httpd.allow_reuse_address = False
        if os.name == "nt":
            import socket

            httpd.socket.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        httpd.server_bind()
        httpd.server_activate()
        httpd.RequestHandlerClass = make_handler(app)
    except BaseException:
        httpd.server_close()
        raise
    return httpd


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Agent Office v0.2 receiver")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=OFFICE_PORT)
    parser.add_argument("--runtime-dir", default="")
    parser.add_argument("--static-dir", default="")
    parser.add_argument("--ttl-ms", type=int, default=DEFAULT_TTL_MS)
    parser.add_argument("--enable-fixtures", action="store_true")
    return parser


def main(argv: list[str]) -> int:
    args = build_parser().parse_args(argv)
    if args.host != "127.0.0.1":
        print("refusing bind host. Agent Office listens on 127.0.0.1 only.", file=sys.stderr)
        return 2
    if args.port in RETIRED_PORTS:
        print(
            f"port {args.port} is retired. v0.1 listeners 8792, 8793 and 8794 are not served. Use {OFFICE_PORT}.",
            file=sys.stderr,
        )
        return 2
    if args.port <= 0 or args.port > 65535:
        print("port is not usable", file=sys.stderr)
        return 2
    if args.ttl_ms <= 0:
        print("ttl-ms must be positive", file=sys.stderr)
        return 2
    runtime = Path(args.runtime_dir).expanduser() if args.runtime_dir else default_runtime_dir()
    if legacy_runtime(runtime):
        print("refusing a runtime directory reserved for a v0.1 receiver", file=sys.stderr)
        return 2
    static_dir = Path(args.static_dir).expanduser() if args.static_dir else None
    try:
        # Bind before creating the runtime so a busy port does not touch a new directory.
        httpd = ThreadingHTTPServer((args.host, args.port), BaseHTTPRequestHandler, bind_and_activate=False)
        httpd.allow_reuse_address = False
        if os.name == "nt":
            import socket

            httpd.socket.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        httpd.server_bind()
        httpd.server_activate()
    except OSError as error:
        errno = getattr(error, "errno", None)
        if errno in {98, 48, 10048}:
            print(f"port {args.port} is already in use. Refusing to switch ports.", file=sys.stderr)
        else:
            print(redact(f"receiver startup failed: {error}"), file=sys.stderr)
        return 2
    try:
        app = App(runtime, args.ttl_ms, args.enable_fixtures, static_dir)
        httpd.RequestHandlerClass = make_handler(app)
    except Exception as error:
        httpd.server_close()
        print(redact(f"receiver startup failed: {error}"), file=sys.stderr)
        return 2
    print(f"bind=127.0.0.1:{args.port}")
    print(f"ui=http://127.0.0.1:{args.port}/")
    print(f"runtime_dir={runtime}")
    print(f"header_dir={runtime / 'headers'}")
    print(f"register_key_file={runtime / 'register.key'}")
    print(f"ttl_ms={args.ttl_ms}")
    print(f"version={VERSION}")
    print(f"evidence={EVIDENCE_TYPE}")
    print("get_auth=loopback-only-no-token")
    print("token_not_printed=yes")
    print(
        "warning: GET /api/state and /api/self-report have no bearer token. "
        "This is only safe because the listener is 127.0.0.1 and write auth ignores Origin.",
        file=sys.stderr,
    )
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        return 0
    finally:
        httpd.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
