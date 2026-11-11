import http.client
import io
import json
import os
import stat
import subprocess
import sys
from unittest import mock
import tempfile
import threading
import unittest
from contextlib import closing, redirect_stderr, redirect_stdout
from pathlib import Path

import register_agent
import report_task
import self_report_server as srv

A = "bot-alpha"
B = "bot-beta"
NOW = 1_700_000_000_000
ACTIVITY = "/api/codex-activity"
DEMO_NAMES = ["林知夏", "陳墨白", "高小滿", "方寧遠"]


def body(agent=A, kind="task.started", job="job-a", at=NOW, event_id="evt-a", title="核對座位", **extra):
    payload = {
        "eventId": event_id,
        "type": kind,
        "jobId": job,
        "at": at,
        "sourceId": agent,
        "agentId": agent,
        "taskTitle": title,
    }
    if title is None:
        payload.pop("taskTitle")
    payload.update(extra)
    return payload


def activity(event_id="activity-start", kind="started", session="session-a", agent="worker-1", turn="turn-a", **extra):
    return {
        "eventId": event_id,
        "kind": kind,
        "sessionId": session,
        "agentId": agent,
        "agentType": "驗證 reviewer",
        "turnId": turn,
        **extra,
    }


class StoreTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.runtime = Path(self.tmp.name)
        self.store = srv.OfficeStore(self.runtime / "office.sqlite3")
        self.now = NOW
        srv.register_agent(self.runtime, A, "阿法", now=NOW)
        srv.register_agent(self.runtime, B, "貝塔", now=NOW)

    def tearDown(self):
        self.tmp.cleanup()

    def accept(self, payload, now=None):
        status, result = self.store.accept(payload["agentId"], payload, self.now if now is None else now)
        return {"status": status, **result}

    def test_never_reported_is_unknown_and_not_idle(self):
        view = self.store.project(self.now, 300_000)
        self.assertEqual([item["effectiveStatus"] for item in view["agents"]], ["unknown", "unknown"])
        self.assertTrue(all(item["reason"] == "missing_report" for item in view["agents"]))
        self.assertNotIn("idle", json.dumps(view))
        for name in DEMO_NAMES:
            self.assertNotIn(name, json.dumps(view, ensure_ascii=False))
        self.assertNotIn("demo", json.dumps(view))
        for key in srv.TOP_LEVEL_FORBIDDEN:
            self.assertNotIn(key, view)

    def test_failed_stays_failed_and_completed_is_not_idle(self):
        self.assertTrue(self.accept(body(title="做事"))["ok"])
        self.assertTrue(self.accept(body(kind="task.completed", at=NOW + 5, event_id="done", title="做事"), now=NOW + 5)["ok"])
        self.assertTrue(self.accept(body(B, "task.started", "job-b", NOW, "evt-b", "另一件"), now=NOW)["ok"])
        self.assertTrue(self.accept(body(B, "task.failed", "job-b", NOW + 5, "evt-b-fail", "另一件"), now=NOW + 5)["ok"])
        view = self.store.project(NOW + 6, 300_000)
        self.assertEqual(view["agents"][0]["effectiveStatus"], "completed")
        self.assertEqual(view["agents"][0]["terminalAt"], NOW + 5)
        self.assertEqual(view["agents"][1]["effectiveStatus"], "failed")
        self.assertNotEqual(view["agents"][1]["effectiveStatus"], "blocked")
        self.assertNotIn("idle", [item["effectiveStatus"] for item in view["agents"]])

    def test_ttl_boundary_keeps_last_known(self):
        self.assertTrue(self.accept(body(), now=NOW)["ok"])
        self.assertTrue(self.accept(body(kind="task.completed", at=NOW + 10, event_id="done"), now=NOW + 10)["ok"])
        ttl = 5_000
        fresh = self.store.project(NOW + 10 + ttl - 1_000, ttl)
        edge = self.store.project(NOW + 10 + ttl, ttl)
        stale = self.store.project(NOW + 10 + ttl + 1_000, ttl)
        self.assertEqual(fresh["agents"][0]["effectiveStatus"], "completed")
        self.assertEqual(fresh["agents"][0]["freshness"], "fresh")
        self.assertEqual(edge["agents"][0]["effectiveStatus"], "completed")
        self.assertEqual(stale["agents"][0]["effectiveStatus"], "unknown")
        self.assertEqual(stale["agents"][0]["freshness"], "stale")
        self.assertEqual(stale["agents"][0]["lastKnownStatus"], "completed")
        self.assertEqual(stale["agents"][0]["taskTitle"], "核對座位")

    def test_undefined_status_is_rejected(self):
        for kind in ("idle", "unknown", "working", "blocked", "task.nope"):
            result = self.accept(body(kind=kind, event_id=f"bad-{kind}"))
            self.assertEqual(result["status"], 400, result)
            self.assertEqual(result["error"], "malformed")
        view = self.store.project(NOW, 300_000)
        self.assertTrue(all(item["effectiveStatus"] == "unknown" for item in view["agents"]))

    def test_explicit_idle_is_not_implied_by_anything_else(self):
        payload = self.accept(body(kind="task.idle", event_id="idle-1", title=None))
        self.assertEqual(payload["status"], 200, payload)
        self.assertTrue(payload["ok"])
        idle = self.store.project(NOW + 1, 300_000)["agents"][0]
        self.assertEqual(idle["effectiveStatus"], "idle")
        self.assertEqual(self.accept(body(kind="task.progress", at=NOW + 2, event_id="prog", title="沒開始"))["status"], 409)

    def test_resend_same_event_does_not_move_last_report(self):
        first = self.accept(body(), now=NOW)
        self.assertEqual(first["status"], 200)
        self.assertEqual(first["deduped"], False)
        before = self.store.project(NOW, 300_000)
        again = self.accept(body(), now=NOW + 50_000)
        self.assertEqual(again["status"], 200)
        self.assertEqual(again["deduped"], True)
        after = self.store.project(NOW + 50_000, 300_000)
        self.assertEqual(after["agents"][0]["lastReportAt"], before["agents"][0]["lastReportAt"])
        self.assertEqual(after["recent"], before["recent"])
        changed = body(title="另一個標題")
        conflict = self.accept(changed, now=NOW + 60_000)
        self.assertEqual(conflict["status"], 409)
        self.assertEqual(conflict["error"], "event_id_conflict")
        still = self.store.project(NOW + 60_000, 300_000)
        self.assertEqual(still["agents"][0]["taskTitle"], "核對座位")
        self.assertEqual(still["agents"][0]["lastReportAt"], before["agents"][0]["lastReportAt"])

    def test_older_event_and_old_job_do_not_overwrite(self):
        self.assertTrue(self.accept(body(), now=NOW)["ok"])
        old = self.accept(body(kind="task.completed", at=NOW - 1, event_id="old"), now=NOW)
        self.assertEqual(old["error"], "out_of_order")
        self.assertTrue(self.accept(body(kind="task.started", job="job-new", at=NOW + 5, event_id="new", title="新工作"), now=NOW + 5)["ok"])
        stale_job = self.accept(body(kind="task.completed", at=NOW + 6, event_id="old-done"), now=NOW + 6)
        self.assertEqual(stale_job["error"], "stale_job")
        view = self.store.project(NOW + 7, 300_000)
        self.assertEqual(view["agents"][0]["jobId"], "job-new")
        self.assertEqual(view["agents"][0]["effectiveStatus"], "working")
        self.assertEqual(view["agents"][0]["taskTitle"], "新工作")

    def test_token_of_a_cannot_write_b_and_label_is_not_the_name(self):
        spoof = body(B, job="job-b", event_id="spoof", title="冒充")
        parsed = srv.parse_event(spoof, A)
        self.assertEqual(parsed["error"], "identity_mismatch")
        ok = self.accept(body(label="別人的名字"))
        self.assertTrue(ok["ok"])
        view = self.store.project(NOW + 1, 300_000)
        self.assertEqual(view["agents"][0]["name"], "阿法")
        self.assertEqual(view["agents"][0]["callerLabel"], "別人的名字")
        self.assertEqual(view["agents"][1]["reason"], "missing_report")

    def test_demo_payload_is_rejected_and_does_not_create_a_partition(self):
        status, payload = self.store.accept(A, {**body(), "mode": "demo"}, NOW)
        self.assertEqual(status, 403)
        self.assertEqual(payload["error"], "demo_rejected")
        self.assertTrue(all(item["reason"] == "missing_report" for item in self.store.project(NOW, 300_000)["agents"]))

    def test_register_does_not_replace_identity_without_rotate(self):
        first = srv.register_agent(self.runtime, A, "阿法")
        self.assertFalse(first["ok"])
        self.assertEqual(first["error"], "identity_exists")
        token = (self.runtime / "headers" / f"{A}.header").read_text(encoding="utf-8")
        renamed = srv.register_agent(self.runtime, A, "新名字", rotate=True)
        self.assertEqual(renamed["error"], "identity_conflict")
        self.assertEqual((self.runtime / "headers" / f"{A}.header").read_text(encoding="utf-8"), token)
        rotated = srv.register_agent(self.runtime, A, "阿法", rotate=True)
        self.assertTrue(rotated["ok"])
        self.assertNotEqual((self.runtime / "headers" / f"{A}.header").read_text(encoding="utf-8"), token)
        self.assertNotIn(token.split()[-1], json.dumps(rotated))
        self.assertEqual(self.store.get_agent(A)["seat"], 0)
        self.assertEqual(self.store.get_agent(B)["seat"], 1)
        third = srv.register_agent(self.runtime, "bot-gamma", "伽马", now=NOW)
        self.assertEqual(third["seat"], 2)

    def test_restart_restores_state_and_not_idle(self):
        self.accept(body(), now=NOW)
        restored = srv.OfficeStore(self.runtime / "office.sqlite3")
        view = restored.project(NOW + 10, 300_000)
        self.assertEqual(view["agents"][0]["effectiveStatus"], "working")
        self.assertNotEqual(view["agents"][0]["effectiveStatus"], "idle")
        disk = (self.runtime / "office.sqlite3").read_bytes()
        token = (self.runtime / "headers" / f"{A}.header").read_text(encoding="utf-8").split()[-1]
        self.assertNotIn(token.encode(), disk)

    def test_started_for_a_seen_job_does_not_replace_the_current_job(self):
        self.assertEqual(self.accept(body(job="job-old", event_id="old-start", at=NOW), now=NOW)["status"], 200)
        done = self.accept(body(kind="task.completed", job="job-old", event_id="old-done", at=NOW + 2), now=NOW + 2)
        self.assertEqual(done["status"], 200)
        current = self.accept(body(job="job-new", event_id="new-start", at=NOW + 4, title="現在這件"), now=NOW + 4)
        self.assertEqual(current["status"], 200)
        rewind = self.accept(body(job="job-old", event_id="old-again", at=NOW + 8, title="舊工作回來"), now=NOW + 8)
        self.assertEqual(rewind["status"], 409)
        self.assertEqual(rewind["error"], "stale_job")
        same = self.accept(body(job="job-new", event_id="new-again", at=NOW + 9, title="再開始現在這件"), now=NOW + 9)
        self.assertEqual(same["status"], 409)
        self.assertEqual(same["error"], "stale_job")
        view = self.store.project(NOW + 9, 300_000)
        self.assertEqual(view["agents"][0]["jobId"], "job-new")
        self.assertEqual(view["agents"][0]["effectiveStatus"], "working")
        self.assertEqual(view["agents"][0]["taskTitle"], "現在這件")
        fresh = self.accept(body(job="job-fresh", event_id="fresh-start", at=NOW + 10, title="全新"), now=NOW + 10)
        self.assertEqual(fresh["status"], 200)
        self.assertFalse(fresh["deduped"])
        moved = self.store.project(NOW + 10, 300_000)
        self.assertEqual(moved["agents"][0]["jobId"], "job-fresh")
        self.assertEqual(moved["agents"][0]["taskTitle"], "全新")

    def test_report_command_is_pasteable(self):
        command = srv.report_command("bot-a", Path("/tmp/my dir"), "http://127.0.0.1:8795/api/self-report")
        self.assertNotIn("<", command)
        self.assertNotIn(">", command)
        self.assertIn("JOB_ID", command)
        self.assertIn("TITLE", command)
        self.assertIn("python3", command)
        self.assertIn("'/tmp/my dir'", command)

    def test_legacy_header_is_read_without_old_state(self):
        legacy = self.runtime / "legacy" / "agent-office-multi-report"
        srv.write_private(srv.header_file(legacy, "bot-old"), "Authorization: Bearer legacy-token-value\n")
        (legacy / "state.json").write_text('{"phase": "idle"}', encoding="utf-8")
        with mock.patch.object(srv, "legacy_runtime_dirs", return_value=[legacy]):
            line = report_task.read_own_header(self.runtime / "fresh-runtime", "bot-old")
        self.assertIn("legacy-token-value", line)
        self.assertFalse((self.runtime / "fresh-runtime" / "state.json").exists())

    def test_directory_acl_is_inheritable_and_granted_before_inheritance_is_removed(self):
        directory = self.runtime / "acl-dir"
        directory.mkdir()
        token = directory / "secret.header"
        token.write_text("x", encoding="utf-8")
        calls = []

        def fake_run(args, **kwargs):
            calls.append(list(args))
            return subprocess.CompletedProcess(args, 0)

        with mock.patch.dict(os.environ, {"USERNAME": "tester", "USERDOMAIN": "DESK"}):
            with mock.patch.object(srv.os, "name", "nt"):
                with mock.patch("subprocess.run", side_effect=fake_run):
                    srv.restrict(directory)
                    directory_calls = list(calls)
                    calls.clear()
                    srv.restrict(token)
        self.assertEqual(directory_calls[0][2], "/grant:r")
        self.assertTrue(directory_calls[0][3].endswith(":(OI)(CI)(F)"))
        self.assertNotIn("/inheritance:r", directory_calls[0])
        self.assertEqual(directory_calls[1][2:], ["/inheritance:r"])
        self.assertLess(directory_calls.index(directory_calls[0]), directory_calls.index(directory_calls[1]))
        self.assertTrue(calls[0][3].endswith(":(F)"))
        self.assertNotIn("(OI)", calls[0][3])
        self.assertEqual(calls[1][2:], ["/inheritance:r"])
        self.assertEqual(len({command[3].split(":")[0] for command in (directory_calls[0], calls[0])}), 1)

    def test_windows_icacls_failure_does_not_leave_a_header(self):
        fake = subprocess.CompletedProcess(args=["icacls"], returncode=1, stdout="", stderr="denied")
        with mock.patch.dict(os.environ, {"USERNAME": "tester", "USERDOMAIN": "DESK"}):
            with mock.patch.object(srv.os, "name", "nt"):
                with mock.patch("subprocess.run", return_value=fake):
                    with self.assertRaises(OSError):
                        srv.issue_header(self.runtime, "bot-locked")
        self.assertFalse((self.runtime / "headers" / "bot-locked.header").exists())

    def test_discussion_order_dedupe_and_self_target(self):
        early = self.store.accept(A, {
            "eventId": "end-early", "type": "discussion.ended", "discussionId": "talk-1",
            "at": NOW, "sourceId": A, "agentId": A, "outcome": "cancel",
        }, NOW)
        self.assertTrue(early[1].get("ignored"))
        started = self.store.accept(A, {
            "eventId": "start-1", "type": "discussion.started", "discussionId": "talk-1",
            "at": NOW + 1, "sourceId": A, "agentId": A, "withAgentId": B, "topic": "對座位",
        }, NOW + 1)
        self.assertEqual(started[0], 200, started)
        again = self.store.accept(A, {
            "eventId": "start-1", "type": "discussion.started", "discussionId": "talk-1",
            "at": NOW + 1, "sourceId": A, "agentId": A, "withAgentId": B, "topic": "對座位",
        }, NOW + 2)
        self.assertTrue(again[1]["deduped"])
        selfish = self.store.accept(A, {
            "eventId": "start-self", "type": "discussion.started", "discussionId": "talk-2",
            "at": NOW + 3, "sourceId": A, "agentId": A, "withAgentId": A,
        }, NOW + 3)
        self.assertEqual(selfish[1]["error"], "with_self")
        joined = self.store.accept(B, {
            "eventId": "join-1", "type": "discussion.joined", "discussionId": "talk-1",
            "at": NOW + 4, "sourceId": B, "agentId": B,
        }, NOW + 4)
        self.assertEqual(joined[0], 200, joined)
        view = self.store.project(NOW + 5, 300_000)
        self.assertEqual(view["discussions"][0]["hostId"], A)
        self.assertEqual(len(view["discussions"][0]["members"]), 2)
        self.assertEqual(view["agents"][0]["effectiveStatus"], "unknown")


class HttpTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.runtime = Path(self.tmp.name)
        self.app = srv.App(self.runtime, 300_000, False, None)
        srv.register_agent(self.runtime, A, "阿法", now=NOW)
        srv.register_agent(self.runtime, B, "貝塔", now=NOW)
        self.httpd = srv.serve(self.app, "127.0.0.1", 0)
        self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)
        self.thread.start()
        self.port = self.httpd.server_address[1]

    def tearDown(self):
        self.httpd.shutdown()
        self.httpd.server_close()
        self.thread.join(timeout=3)
        self.tmp.cleanup()

    def token(self, agent_id):
        return srv.read_token(self.runtime, agent_id)

    def request(self, method, path, token=None, payload=None, extra_headers=None, port=None):
        connection = http.client.HTTPConnection("127.0.0.1", port or self.port, timeout=3)
        headers = dict(extra_headers or {})
        data = None
        if payload is not None:
            data = json.dumps(payload).encode("utf-8")
            headers["Content-Type"] = "application/json"
        if token:
            headers["Authorization"] = f"Bearer {token}"
        connection.request(method, path, body=data, headers=headers)
        response = connection.getresponse()
        raw = response.read()
        header_map = {key.lower(): value for key, value in response.getheaders()}
        connection.close()
        return response.status, header_map, raw

    def test_health_and_get_have_no_secrets_or_demo(self):
        status, headers, raw = self.request("GET", "/health", extra_headers={"Origin": "https://evil.example"})
        self.assertEqual(status, 200)
        self.assertNotIn("access-control-allow-origin", headers)
        health = json.loads(raw)
        self.assertEqual(health["version"], srv.VERSION)
        self.assertEqual(health["service"], "agent-office")
        self.assertTrue(health["receiverId"])
        self.assertEqual(health["getAuth"], "loopback-only")
        self.assertEqual(len(health["runtimeMarker"]), 16)
        self.assertNotIn(str(self.runtime), raw.decode())
        self.assertNotIn("Bearer", raw.decode())
        self.assertNotIn(self.token(A), raw.decode())
        state_status, state_headers, state_raw = self.request("GET", "/api/state")
        self.assertEqual(state_status, 200)
        self.assertNotIn("access-control-allow-origin", state_headers)
        state = json.loads(state_raw)
        self.assertEqual(state["partition"], "real")
        for key in srv.TOP_LEVEL_FORBIDDEN:
            self.assertNotIn(key, state)
        self.assertNotIn("demo", state_raw.decode())
        report = json.loads(self.request("GET", "/api/self-report")[2])
        self.assertEqual(report["agents"], state["agents"])
        stream = self.request("GET", "/api/state/stream")
        self.assertEqual(stream[0], 200)
        self.assertTrue(stream[2].startswith(b"data: "))
        options = self.request("OPTIONS", "/api/self-report", extra_headers={"Origin": "https://evil.example"})
        self.assertEqual(options[0], 204)
        self.assertNotIn("access-control-allow-origin", options[1])

    def test_missing_and_wrong_token_and_cross_agent_write(self):
        missing, _, _ = self.request("POST", "/api/self-report", payload=body())
        self.assertEqual(missing, 401)
        wrong, _, wrong_body = self.request("POST", "/api/self-report", token="not-the-token", payload=body())
        self.assertEqual(wrong, 401)
        self.assertNotIn(self.token(A), wrong_body.decode())
        cross, _, cross_body = self.request("POST", "/api/self-report", token=self.token(A), payload=body(B, job="job-b", event_id="spoof", title="冒充"))
        self.assertEqual(cross, 403)
        self.assertEqual(json.loads(cross_body)["error"], "identity_mismatch")
        demo, _, demo_body = self.request("POST", "/api/self-report", token=self.token(A), payload={**body(), "mode": "demo"})
        self.assertEqual(demo, 403)
        self.assertEqual(json.loads(demo_body)["error"], "demo_rejected")
        after = json.loads(self.request("GET", "/api/self-report")[2])
        self.assertTrue(all(item["reason"] == "missing_report" for item in after["agents"]))
        self.assertNotIn(self.token(A), json.dumps(after))

    def test_legacy_path_on_the_new_port_and_register_route(self):
        started, _, raw = self.request("POST", "/api/self-report", token=self.token(A), payload=body())
        self.assertEqual(started, 200, raw)
        self.assertEqual(json.loads(raw)["deduped"], False)
        again, _, raw = self.request("POST", "/api/self-report", token=self.token(A), payload=body())
        self.assertEqual(again, 200)
        self.assertTrue(json.loads(raw)["deduped"])
        key = srv.read_register_key(self.runtime)
        denied, _, _ = self.request("POST", "/api/agents/register", payload={"agentId": "bot-new", "displayName": "新人"})
        self.assertEqual(denied, 401)
        created, _, raw = self.request(
            "POST",
            "/api/agents/register",
            token=key,
            payload={"agentId": "bot-new", "displayName": "新人"},
        )
        self.assertEqual(created, 200, raw)
        registered = json.loads(raw)
        self.assertEqual(registered["seat"], 2)
        self.assertNotIn(self.token("bot-new"), raw.decode())
        self.assertIn("reportCommand", registered)
        self.assertNotIn("Bearer", registered["reportCommand"])
        conflict, _, _ = self.request(
            "POST",
            "/api/agents/register",
            token=key,
            payload={"agentId": "bot-new", "displayName": "新人"},
        )
        self.assertEqual(conflict, 409)

    def test_refuses_retired_ports_bad_host_and_a_busy_port(self):
        err = io.StringIO()
        with redirect_stderr(err):
            self.assertEqual(srv.main(["--port", "8792", "--runtime-dir", str(self.runtime / "fresh")]), 2)
            self.assertEqual(srv.main(["--port", "8793", "--runtime-dir", str(self.runtime / "fresh")]), 2)
            self.assertEqual(srv.main(["--port", "8794", "--runtime-dir", str(self.runtime / "fresh")]), 2)
            self.assertEqual(srv.main(["--host", "0.0.0.0", "--runtime-dir", str(self.runtime / "fresh")]), 2)
            self.assertEqual(srv.main(["--runtime-dir", str(self.runtime / "agent-office-self-report")]), 2)
        self.assertNotIn("Bearer", err.getvalue())
        self.assertNotIn(self.token(A), err.getvalue())
        unused = self.runtime / "unused-runtime"
        with redirect_stderr(io.StringIO()):
            result = srv.main(["--port", str(self.port), "--runtime-dir", str(unused)])
        self.assertEqual(result, 2)
        self.assertFalse(unused.exists())

    def test_activity_credential_dedupe_and_restart(self):
        denied, _, _ = self.request("POST", ACTIVITY, token=self.token(A), payload=activity())
        self.assertEqual(denied, 401)
        missing, _, _ = self.request("POST", ACTIVITY, payload=activity())
        self.assertEqual(missing, 401)
        ok, _, raw = self.request("POST", ACTIVITY, token=self.token(srv.CODEX_HOOK_SOURCE), payload=activity(jobId="job-1", taskTitle="驗證"))
        self.assertEqual(ok, 200, raw)
        again, _, raw = self.request("POST", ACTIVITY, token=self.token(srv.CODEX_HOOK_SOURCE), payload=activity(jobId="job-1", taskTitle="驗證"))
        self.assertTrue(json.loads(raw)["deduped"])
        conflict, _, raw = self.request(
            "POST",
            ACTIVITY,
            token=self.token(srv.CODEX_HOOK_SOURCE),
            payload=activity(jobId="job-1", taskTitle="不同"),
        )
        self.assertEqual(conflict, 409)
        self.assertEqual(json.loads(raw)["error"], "event_id_conflict")
        stopped = activity(event_id="activity-stop", kind="stopped", turn="turn-a")
        self.assertEqual(self.request("POST", ACTIVITY, token=self.token(srv.CODEX_HOOK_SOURCE), payload=stopped)[0], 200)
        snap = json.loads(self.request("GET", ACTIVITY)[2])
        agent = snap["sessions"][0]["agents"][0]
        self.assertIsNone(agent.get("outcome"))
        office = json.loads(self.request("GET", "/api/state")[2])
        self.assertTrue(all(item["effectiveStatus"] == "unknown" for item in office["agents"]))
        restarted = srv.App(self.runtime, 300_000, False, None)
        restored = restarted.activity.snapshot()
        self.assertEqual(restored["sessions"][0]["agents"][0]["agentId"], "worker-1")

    def test_hook_token_cannot_change_another_agents_seat(self):
        status, _, raw = self.request(
            "POST",
            ACTIVITY,
            token=self.token(srv.CODEX_HOOK_SOURCE),
            payload=activity(agent=B, jobId="job-x", taskTitle="被冒充"),
        )
        self.assertEqual(status, 200, raw)
        state = json.loads(self.request("GET", "/api/state")[2])
        beta = next(item for item in state["agents"] if item["agentId"] == B)
        self.assertEqual(beta["effectiveStatus"], "unknown")
        self.assertIsNone(beta["taskTitle"])
        self.assertEqual(beta["name"], "貝塔")


class CliTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.runtime = Path(self.tmp.name)
        self.app = srv.App(self.runtime, 300_000, False, None)
        registered = srv.register_agent(self.runtime, A, "阿法", now=NOW)
        self.header = registered["headerFile"]
        self.httpd = srv.serve(self.app, "127.0.0.1", 0)
        self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)
        self.thread.start()
        self.port = self.httpd.server_address[1]
        self.url = f"http://127.0.0.1:{self.port}/api/self-report"

    def tearDown(self):
        self.httpd.shutdown()
        self.httpd.server_close()
        self.thread.join(timeout=3)
        self.tmp.cleanup()

    def run_report(self, extra, url=None):
        argv = [
            "--agent-id", A,
            "--job-id", "job-cli",
            "--runtime-dir", str(self.runtime),
            "--url", url or self.url,
            *extra,
        ]
        out, err = io.StringIO(), io.StringIO()
        with redirect_stdout(out), redirect_stderr(err):
            code = report_task.main(argv)
        text = out.getvalue() + err.getvalue()
        token = srv.read_token(self.runtime, A)
        self.assertNotIn(token, text)
        self.assertNotIn("Bearer", text)
        return code, text

    def office(self):
        status, _, raw = HttpTests.request(self, "GET", "/api/state")
        self.assertEqual(status, 200)
        return json.loads(raw)

    def test_legacy_command_resend_conflict_order_and_server_down(self):
        code, text = self.run_report(["--status", "started", "--task", "畫座位", "--event-id", "cli-1", "--at", str(NOW)])
        self.assertEqual(code, 0, text)
        self.assertIn("report_status=200", text)
        self.assertIn("result=ok", text)
        code, text = self.run_report(["--status", "started", "--task", "畫座位", "--event-id", "cli-1", "--at", str(NOW + 5)])
        self.assertEqual(code, 0, text)
        self.assertIn("result=deduped", text)
        self.assertEqual(self.office()["agents"][0]["lastReportAt"] is not None, True)
        seen = self.office()["agents"][0]["lastReportAt"]
        code, text = self.run_report(["--status", "started", "--task", "改標題", "--event-id", "cli-1", "--at", str(NOW + 9)])
        self.assertEqual(code, 1, text)
        self.assertIn("result=event_id_conflict", text)
        self.assertEqual(self.office()["agents"][0]["taskTitle"], "畫座位")
        self.assertEqual(self.office()["agents"][0]["lastReportAt"], seen)
        code, text = self.run_report(["--status", "completed", "--at", str(NOW - 5), "--event-id", "cli-old"])
        self.assertEqual(code, 1, text)
        self.assertIn("result=out_of_order", text)
        self.assertEqual(self.office()["agents"][0]["effectiveStatus"], "working")
        code, text = self.run_report(["--status", "completed", "--at", str(NOW + 20), "--event-id", "cli-done", "--task", "畫座位"])
        self.assertEqual(code, 0, text)
        done = self.office()["agents"][0]
        self.assertEqual(done["effectiveStatus"], "completed")
        self.assertNotEqual(done["effectiveStatus"], "idle")
        code, text = self.run_report(["--status", "failed", "--event-id", "cli-fail", "--at", str(NOW + 30)], url="http://127.0.0.1:9/api/self-report")
        self.assertEqual(code, 3, text)
        self.assertIn("report_status=0", text)
        self.assertIn("result=unreachable", text)
        imposter = self.runtime / "imposter"
        srv.write_private(srv.header_file(imposter, A), "Authorization: Bearer not-the-real-token\n")
        argv = [
            "--agent-id", A, "--job-id", "job-cli", "--status", "started", "--task", "不該寫入",
            "--runtime-dir", str(imposter), "--url", self.url, "--event-id", "nope", "--at", str(NOW + 40),
        ]
        out, err = io.StringIO(), io.StringIO()
        with redirect_stdout(out), redirect_stderr(err):
            code = report_task.main(argv)
        text = out.getvalue() + err.getvalue()
        self.assertEqual(code, 1, text)
        self.assertIn("result=unauthorized", text)
        self.assertNotIn("not-the-real-token", text)
        self.assertEqual(self.office()["agents"][0]["effectiveStatus"], "completed")

    def test_register_command_hides_the_token(self):
        out, err = io.StringIO(), io.StringIO()
        with redirect_stdout(out), redirect_stderr(err):
            code = register_agent.main([
                "--agent-id", "bot-cli",
                "--display-name", "命令列",
                "--runtime-dir", str(self.runtime),
                "--url", self.url,
            ])
        text = out.getvalue() + err.getvalue()
        self.assertEqual(code, 0, text)
        token = srv.read_token(self.runtime, "bot-cli")
        self.assertTrue(token)
        self.assertNotIn(token, text)
        self.assertNotIn("Bearer", text)
        self.assertIn("header_file=", text)
        self.assertIn("report_command=", text)
        self.assertIn("--status started", text)
        mode = stat.S_IMODE((self.runtime / "headers" / "bot-cli.header").stat().st_mode)
        if os.name != "nt":
            self.assertEqual(mode, 0o600)
        err2 = io.StringIO()
        with redirect_stdout(io.StringIO()), redirect_stderr(err2):
            again = register_agent.main([
                "--agent-id", "bot-cli",
                "--display-name", "命令列",
                "--runtime-dir", str(self.runtime),
            ])
        self.assertEqual(again, 2)
        self.assertIn("identity_exists", err2.getvalue())
        self.assertNotIn(token, err2.getvalue())

    def test_activity_cli_retries_on_this_receiver(self):
        script = Path(__file__).with_name("report_activity.py")
        command = [
            sys.executable, "-B", str(script),
            "--runtime-dir", str(self.runtime),
            "--session-id", "office-live",
            "--agent-id", "actual-worker-id",
            "--job-id", "dispatched-job",
            "--url", f"http://127.0.0.1:{self.port}{ACTIVITY}",
        ]
        for suffix, expected_exit, expected in (
            (["--url", "http://example.com/api/codex-activity", "--status", "started", "--task", "驗證"], 2, "rejected"),
            (["--status", "started"], 2, "rejected"),
            (["--status", "started", "--task", "驗證"], 0, "ok"),
            (["--status", "started", "--task", "驗證"], 0, "deduped"),
            (["--status", "completed"], 0, "ok"),
        ):
            argv = command + suffix
            result = subprocess.run(argv, capture_output=True, text=True, timeout=10)
            combined = result.stdout + result.stderr
            self.assertEqual(result.returncode, expected_exit, combined)
            self.assertIn(f"result={expected}", combined)
            self.assertNotIn(self.token(srv.CODEX_HOOK_SOURCE) if False else "Bearer ", combined)
        snap = json.loads(self.request_activity())
        self.assertEqual(snap["sessions"][0]["agents"][0]["outcome"], "completed")

    def request_activity(self):
        status, _, raw = HttpTests.request(self, "GET", ACTIVITY)
        self.assertEqual(status, 200)
        return raw

    def token(self, agent_id):
        return srv.read_token(self.runtime, agent_id)


if __name__ == "__main__":
    unittest.main()
