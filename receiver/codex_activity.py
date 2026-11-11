"""Durable lifecycle observations from local Codex hooks and workers."""

from __future__ import annotations

import re
import sqlite3
import threading
from collections import deque
from contextlib import closing
from dataclasses import dataclass, field
from pathlib import Path

ID_RE = re.compile(r"[A-Za-z0-9._:-]{1,128}")
FIELDS = ("eventId", "kind", "sessionId", "agentId", "agentType", "turnId")
FIELD_SET = set(FIELDS)
ALLOWED_FIELDS = FIELD_SET | {"jobId", "taskTitle"}
WORKER_RESULTS = ("completed", "failed")
MAX_TITLE = 160
MAX_RECENT = 20


def valid_id(value: object) -> bool:
    return isinstance(value, str) and ID_RE.fullmatch(value) is not None


def valid_event(body: object) -> bool:
    if not isinstance(body, dict) or not FIELD_SET <= body.keys() <= ALLOWED_FIELDS:
        return False
    kind = body["kind"]
    if "jobId" in body:
        if not valid_id(body["jobId"]) or kind not in ("started", *WORKER_RESULTS):
            return False
        if "taskTitle" in body:
            title = body["taskTitle"]
            if (
                not isinstance(title, str)
                or not 1 <= len(title) <= MAX_TITLE
                or not title.isprintable()
                or not title.strip()
            ):
                return False
        elif kind == "started":
            return False
    elif "taskTitle" in body or kind not in ("started", "stopped"):
        return False
    agent_type = body["agentType"]
    return (
        all(valid_id(body[key]) for key in ("eventId", "sessionId", "agentId"))
        and isinstance(agent_type, str)
        and 1 <= len(agent_type) <= 80
        and agent_type.isprintable()
        and bool(agent_type.strip())
        and (body["turnId"] is None or valid_id(body["turnId"]))
    )


@dataclass
class Session:
    agents: dict[str, dict] = field(default_factory=dict)
    recent: deque[dict] = field(default_factory=lambda: deque(maxlen=MAX_RECENT))
    turns: set[tuple[str, str]] = field(default_factory=set)

    def observe(self, event: dict) -> None:
        self.recent.append(event)
        agent_id = event["agentId"]
        turn_id = event["turnId"]
        at = event["at"]
        previous = self.agents.get(agent_id)
        if "jobId" in event:
            if event["kind"] == "started":
                self.agents[agent_id] = {
                    "agentId": agent_id,
                    "agentType": event["agentType"],
                    "turnId": turn_id,
                    "startedAt": at,
                    "stoppedAt": None,
                    "lastEventAt": at,
                    "outcome": None,
                    "taskTitle": event["taskTitle"],
                }
            else:
                self.agents[agent_id] = {
                    **previous,
                    "outcome": event["kind"],
                    "taskTitle": event.get("taskTitle", previous["taskTitle"]),
                    "stoppedAt": at,
                    "lastEventAt": at,
                }
            return
        if previous and "outcome" in previous:
            # Native hook events describe execution, without changing explicit results.
            return
        previous_turn = previous["turnId"] if previous else None
        same_turn = turn_id is None or previous_turn in (None, turn_id)
        if turn_id is not None:
            turn = (agent_id, turn_id)
            # Keep delayed observations of an earlier known turn in history.
            if not same_turn and turn in self.turns:
                return
            self.turns.add(turn)
        if previous and same_turn:
            started_at = previous["startedAt"]
            stopped_at = previous["stoppedAt"]
            turn_id = turn_id or previous_turn
        else:
            started_at = stopped_at = None

        if event["kind"] == "started" and started_at is None and stopped_at is None:
            started_at = at
        if event["kind"] == "stopped" and stopped_at is None:
            stopped_at = at
            if started_at is not None and started_at > stopped_at:
                started_at = None
        self.agents[agent_id] = {
            "agentId": agent_id,
            "agentType": event["agentType"],
            "turnId": turn_id,
            "startedAt": started_at,
            "stoppedAt": stopped_at,
            "lastEventAt": at,
        }


class ActivityStore:
    def __init__(self, path: Path) -> None:
        self.path = path
        self._sessions: dict[str, Session] = {}
        self._last_sequence = 0
        self._projection_lock = threading.Lock()
        with closing(sqlite3.connect(path)) as connection, connection:
            connection.execute("BEGIN IMMEDIATE")
            connection.execute("""
                CREATE TABLE IF NOT EXISTS events (
                    sequence INTEGER PRIMARY KEY,
                    event_id TEXT NOT NULL UNIQUE,
                    kind TEXT NOT NULL,
                    session_id TEXT NOT NULL,
                    agent_id TEXT NOT NULL,
                    agent_type TEXT NOT NULL,
                    turn_id TEXT,
                    at INTEGER NOT NULL,
                    job_id TEXT,
                    task_title TEXT
                )
            """)
            columns = {row[1] for row in connection.execute("PRAGMA table_info(events)")}
            if "job_id" not in columns:
                connection.execute("ALTER TABLE events ADD COLUMN job_id TEXT")
            if "task_title" not in columns:
                connection.execute("ALTER TABLE events ADD COLUMN task_title TEXT")
            connection.execute("""
                CREATE INDEX IF NOT EXISTS worker_events
                ON events (session_id, agent_id) WHERE job_id IS NOT NULL
            """)

    def accept(self, body: object, at: int) -> tuple[int, dict]:
        if not valid_event(body):
            return 400, {"ok": False, "error": "malformed"}
        job_id = body.get("jobId")
        values = (*(body[key] for key in FIELDS), job_id, body.get("taskTitle"))
        with closing(sqlite3.connect(self.path)) as connection, connection:
            connection.execute("BEGIN IMMEDIATE")
            saved = connection.execute("""
                SELECT event_id, kind, session_id, agent_id, agent_type, turn_id, job_id, task_title
                FROM events WHERE event_id = ?
            """, (body["eventId"],)).fetchone()
            if saved is not None:
                if saved == values:
                    return 200, {"ok": True, "deduped": True}
                return 409, {"ok": False, "error": "event_id_conflict"}
            if job_id is not None:
                latest = connection.execute("""
                    SELECT job_id, kind FROM events
                    WHERE session_id = ? AND agent_id = ? AND job_id IS NOT NULL
                    ORDER BY sequence DESC LIMIT 1
                """, (body["sessionId"], body["agentId"])).fetchone()
                if body["kind"] == "started":
                    if latest is not None:
                        return 409, {"ok": False, "error": "worker_already_started"}
                elif latest != (job_id, "started"):
                    return 409, {"ok": False, "error": "no_matching_start"}
            connection.execute("""
                INSERT INTO events (event_id, kind, session_id, agent_id, agent_type, turn_id, job_id, task_title, at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (*values, at))
            return 200, {"ok": True, "deduped": False}

    def snapshot(self) -> dict:
        with self._projection_lock:
            # Read new committed rows only. Replay the log once after a restart.
            with closing(sqlite3.connect(self.path)) as connection:
                rows = connection.execute("""
                    SELECT sequence, session_id, event_id, kind, agent_id, agent_type, turn_id, at, job_id, task_title
                    FROM events WHERE sequence > ? ORDER BY sequence
                """, (self._last_sequence,))
                for sequence, session_id, event_id, kind, agent_id, agent_type, turn_id, at, job_id, task_title in rows:
                    session = self._sessions.pop(session_id, None)
                    if session is None:
                        session = Session()
                    event = {
                        "eventId": event_id, "kind": kind, "agentId": agent_id,
                        "agentType": agent_type, "turnId": turn_id, "at": at,
                    }
                    if job_id is not None:
                        event["jobId"] = job_id
                    if task_title is not None:
                        event["taskTitle"] = task_title
                    session.observe(event)
                    self._sessions[session_id] = session
                    self._last_sequence = sequence
            return {
                "evidenceType": "codex-hook",
                "sessions": [
                    {"sessionId": session_id, "agents": list(session.agents.values()), "recent": list(session.recent)}
                    for session_id, session in reversed(self._sessions.items())
                ],
            }
