import http.client
import io
import json
import os
import sqlite3
import stat
import subprocess
import sys
import tempfile
import threading
import unittest
from contextlib import closing, contextmanager, redirect_stderr, redirect_stdout
from pathlib import Path

import report_task
import self_report_server as srv

A = srv.TRUSTED_IDS[0]
B = srv.TRUSTED_IDS[1]
C = srv.TRUSTED_IDS[2]
D = srv.TRUSTED_IDS[3]
NOW = 1_700_000_000_000
ACTIVITY = "/api/codex-activity"


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


class LogicTests(unittest.TestCase):
    def setUp(self):
        self.state = srv.empty_state("real", srv.TRUSTED)
        self.now = NOW

    def accept(self, payload, now=None):
        parsed = srv.parse_event(payload, payload["agentId"])
        self.assertTrue(parsed["ok"], parsed)
        return srv.apply_event(self.state, parsed["event"], self.now if now is None else now)

    def test_four_missing_reports_are_unknown_and_not_idle(self):
        view = srv.project(self.state, srv.TRUSTED, self.now, 300_000)
        self.assertEqual(len(view["agents"]), 4)
        self.assertEqual([item["agentId"] for item in view["agents"]], list(srv.TRUSTED_IDS))
        self.assertTrue(all(item["effectiveStatus"] == "unknown" and item["reason"] == "missing_report" for item in view["agents"]))
        self.assertTrue(all(item["evidenceType"] == "bot-self-report" for item in view["agents"]))
        self.assertNotIn("idle", json.dumps(view))
        self.assertEqual(view["agentId"], A)
        self.assertEqual(view["agents"][0]["name"], "專案／產品助手（協調）")

    def test_independent_jobs_titles_and_terminals(self):
        self.assertTrue(self.accept(body(title="協調今天的範圍"))["ok"])
        self.assertTrue(self.accept(body(B, job="job-b", event_id="evt-b", title="改接收器的四個座位"), now=self.now)["ok"])
        view = srv.project(self.state, srv.TRUSTED, self.now + 10, 300_000)
        self.assertEqual(view["agents"][0]["taskTitle"], "協調今天的範圍")
        self.assertEqual(view["agents"][1]["effectiveStatus"], "working")
        self.assertEqual(view["agents"][2]["reason"], "missing_report")
        self.assertTrue(self.accept(body(kind="task.completed", at=self.now + 20, event_id="evt-a-done", title="協調今天的範圍"), now=self.now + 20)["ok"])
        failed = self.accept(body(B, "task.failed", "job-b", self.now + 20, "evt-b-fail", "改接收器的四個座位"), now=self.now + 20)
        self.assertTrue(failed["ok"])
        again = srv.project(self.state, srv.TRUSTED, self.now + 30, 300_000)
        self.assertEqual(again["agents"][0]["effectiveStatus"], "completed")
        self.assertEqual(again["agents"][1]["effectiveStatus"], "failed")
        self.assertNotEqual(again["agents"][0]["effectiveStatus"], again["agents"][1]["effectiveStatus"])

    def test_cross_source_label_is_not_identity(self):
        spoof = body(B, job="job-b", event_id="spoof", title="冒充")
        self.assertEqual(srv.parse_event(spoof, A)["error"], "identity_mismatch")
        ok = srv.parse_event({**body(), "label": "別人的名字"}, A)
        self.assertTrue(srv.apply_event(self.state, ok["event"], self.now)["ok"])
        self.assertEqual(self.state["agents"][A]["callerLabel"], "別人的名字")
        self.assertEqual(self.state["agents"][B], None)

    def test_title_limit_duplicate_order_and_stale_keeps_result(self):
        self.assertEqual(srv.parse_event(body(title="測" * 161), A)["error"], "malformed")
        self.assertEqual(srv.parse_event(body(title=None), A)["error"], "malformed")
        long_ok = "核" * 160
        self.assertTrue(self.accept(body(title=long_ok))["ok"])
        self.assertTrue(self.accept(body(title=long_ok))["deduped"])
        self.assertEqual(self.accept(body(kind="task.completed", at=self.now - 1, event_id="old"))["error"], "out_of_order")
        self.assertTrue(self.accept(body(kind="task.completed", at=self.now + 5, event_id="done", title="核對完成"), now=self.now + 5)["ok"])
        stale = srv.project(self.state, srv.TRUSTED, self.now + 300_006, 300_000)
        self.assertEqual(stale["agents"][0]["effectiveStatus"], "unknown")
        self.assertEqual(stale["agents"][0]["lastKnownStatus"], "completed")
        self.assertEqual(stale["agents"][0]["taskTitle"], "核對完成")
        self.assertEqual(stale["agents"][0]["freshness"], "stale")
        self.assertEqual(self.state["agents"][A]["phase"], "completed")
        self.assertEqual(self.state["agents"][B], None)

    def test_progress_does_not_invent_a_job(self):
        self.assertEqual(self.accept(body(kind="task.progress", title="還沒開始"))["error"], "out_of_order")
        self.accept(body())
        moved = self.accept(body(kind="task.progress", at=self.now + 3, event_id="prog", title="寫到一半"), now=self.now + 3)
        self.assertTrue(moved["ok"])
        self.assertEqual(self.state["agents"][A]["phase"], "working")
        self.assertEqual(self.state["agents"][A]["taskTitle"], "寫到一半")


class HttpTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.runtime = Path(self.tmp.name)
        self.app = srv.App(self.runtime, 300_000, True, None)
        self.httpd = srv.serve(self.app, "127.0.0.1", 0)
        self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)
        self.thread.start()
        self.port = self.httpd.server_address[1]

    def tearDown(self):
        self.httpd.shutdown()
        self.httpd.server_close()
        self.tmp.cleanup()

    def token(self, agent_id, runtime=None):
        path = (runtime or self.runtime) / "headers" / f"{agent_id}.header"
        self.assertTrue(path.is_file(), f"Missing credential file {path.name}")
        line = path.read_text(encoding="utf-8").strip()
        return line.split(" ")[2]

    def request(self, method, path, token=None, payload=None, extra_headers=None, port=None):
        connection = http.client.HTTPConnection("127.0.0.1", port or self.port, timeout=3)
        headers = dict(extra_headers or {})
        data = None
        if payload is not None:
            data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
            headers["Content-Type"] = "application/json"
            headers["Content-Length"] = str(len(data))
        if token is not None:
            headers["Authorization"] = f"Bearer {token}"
        connection.request(method, path, body=data, headers=headers)
        response = connection.getresponse()
        raw = response.read()
        found = {key.lower(): value for key, value in response.getheaders()}
        status = response.status
        connection.close()
        return status, found, raw

    @contextmanager
    def codex_receiver(self):
        runtime = self.runtime / "codex"
        app = srv.App(runtime, 300_000, True, None, roster="codex")
        with srv.serve(app, "127.0.0.1", 0) as httpd:
            thread = threading.Thread(target=httpd.serve_forever, daemon=True)
            thread.start()
            try:
                def request(method, path=ACTIVITY, **kwargs):
                    return self.request(method, path, port=httpd.server_address[1], **kwargs)

                yield runtime, request
            finally:
                httpd.shutdown()
                thread.join(timeout=3)

    def test_activity_requires_its_own_codex_receiver_credential(self):
        self.assertEqual(self.request("GET", ACTIVITY)[0], 404)
        self.assertEqual(self.request("POST", ACTIVITY, payload=activity())[0], 404)
        self.assertFalse((self.runtime / "headers" / "codex-hook.header").exists())
        with self.codex_receiver() as (runtime, request):
            status, headers, raw = request("GET", extra_headers={"Origin": "https://evil.example"})
            self.assertEqual(status, 200)
            self.assertNotIn("access-control-allow-origin", headers)
            self.assertEqual(json.loads(raw), {"evidenceType": "codex-hook", "sessions": []})
            self.assertEqual(request("POST", payload=activity())[0], 401)
            for name in ("codex-api", srv.FIXTURE_AGENT):
                wrong_token = self.token(name, runtime)
                self.assertEqual(request("POST", token=wrong_token, payload=activity())[0], 401)
            self.assertEqual(request("POST", token="é", payload=activity())[0], 401)
            self.assertEqual(request("POST", "/api/self-report", token="é", payload=body())[0], 401)
            hook_token = self.token("codex-hook", runtime)
            self.assertEqual(request("POST", "/api/self-report", token=hook_token, payload=body())[0], 401)
            self.assertEqual(request("POST", "/api/fixture-report", token=hook_token, payload=body())[0], 401)
            self.assertEqual(request("POST", token=hook_token, payload=activity())[0], 200)
            self.assertNotIn(hook_token, request("GET")[2].decode())

    def test_activity_keeps_sessions_and_dynamic_agents_separate_on_retry(self):
        with self.codex_receiver() as (runtime, request):
            token = self.token("codex-hook", runtime)
            first = activity()
            before = srv.now_ms()
            for event in (
                first,
                activity("other-agent", agent="worker-2", turn=None),
                activity("other-session", session="session-b"),
                activity("activity-stop", "stopped"),
            ):
                status, _, raw = request("POST", token=token, payload=event)
                self.assertEqual((status, json.loads(raw)), (200, {"ok": True, "deduped": False}))
            status, _, raw = request("POST", token=token, payload=first)
            self.assertEqual((status, json.loads(raw)), (200, {"ok": True, "deduped": True}))
            self.assertEqual(request("POST", token=token, payload={**first, "sessionId": "session-b"})[0], 409)
            sessions = json.loads(request("GET")[2])["sessions"]
            self.assertEqual([session["sessionId"] for session in sessions], ["session-a", "session-b"])
            agents = {agent["agentId"]: agent for agent in sessions[0]["agents"]}
            stopped = agents["worker-1"]
            self.assertEqual(set(agents), {"worker-1", "worker-2"})
            self.assertEqual(stopped["agentType"], "驗證 reviewer")
            self.assertEqual(stopped["turnId"], "turn-a")
            self.assertLessEqual(before, stopped["startedAt"])
            self.assertLessEqual(stopped["startedAt"], stopped["stoppedAt"])
            self.assertLessEqual(stopped["stoppedAt"], srv.now_ms())
            self.assertEqual(stopped["lastEventAt"], stopped["stoppedAt"])
            self.assertIsNone(agents["worker-2"]["turnId"])
            self.assertIsNone(sessions[1]["agents"][0]["stoppedAt"])
            recent = {entry["eventId"]: entry for entry in sessions[0]["recent"]}
            self.assertEqual(len(sessions[0]["recent"]), 3)
            self.assertEqual(recent["activity-stop"], {
                "eventId": "activity-stop", "kind": "stopped", "agentId": "worker-1",
                "agentType": "驗證 reviewer", "turnId": "turn-a", "at": stopped["stoppedAt"],
            })

    def test_activity_restart_preserves_events_and_replay_protection(self):
        event = activity(kind="stopped", turn=None)
        with self.codex_receiver() as (runtime, request):
            token = self.token("codex-hook", runtime)
            manual_token = self.token("codex-api", runtime)
            manual = body(agent="codex-api")
            self.assertEqual(request("POST", "/api/self-report", token=manual_token, payload=manual)[0], 200)
            state = (runtime / "state.json").read_bytes()
            self.assertEqual(request("POST", token=token, payload=event)[0], 200)
            snapshot = json.loads(request("GET")[2])
            self.assertEqual((runtime / "state.json").read_bytes(), state)
            self.assertIsNone(snapshot["sessions"][0]["agents"][0]["startedAt"])
        with self.codex_receiver() as (runtime, request):
            token = self.token("codex-hook", runtime)
            status, _, raw = request("POST", token=token, payload=event)
            self.assertEqual((status, json.loads(raw)), (200, {"ok": True, "deduped": True}))
            self.assertEqual(json.loads(request("GET")[2]), snapshot)
            self.assertEqual((runtime / "state.json").read_bytes(), state)

    def test_codex_can_reopen_a_marker_from_the_older_receiver(self):
        runtime = self.runtime / "codex"
        runtime.mkdir()
        (runtime / "roster").write_text("codex", encoding="ascii")
        srv.restrict(runtime)
        with self.codex_receiver() as (_, request):
            self.assertEqual(request("GET")[0], 200)

    def test_activity_late_start_leaves_a_known_stop_ended(self):
        with self.codex_receiver() as (runtime, request):
            token = self.token("codex-hook", runtime)
            for event in (activity("stop-first", "stopped"), activity("start-late")):
                self.assertEqual(request("POST", token=token, payload=event)[0], 200)
            agent = json.loads(request("GET")[2])["sessions"][0]["agents"][0]
            self.assertIsNone(agent["startedAt"])
            self.assertIsNotNone(agent["stoppedAt"])
            self.assertEqual(request("POST", token=token, payload=activity("next-start", turn="turn-b"))[0], 200)
            agent = json.loads(request("GET")[2])["sessions"][0]["agents"][0]
            self.assertEqual(agent["turnId"], "turn-b")
            self.assertIsNone(agent["stoppedAt"])
            self.assertEqual(request("POST", token=token, payload=activity("old-stop", "stopped"))[0], 200)
            agent = json.loads(request("GET")[2])["sessions"][0]["agents"][0]
            self.assertEqual(agent["turnId"], "turn-b")
            self.assertIsNone(agent["stoppedAt"])

    def test_activity_rejects_unbounded_or_extra_metadata(self):
        with self.codex_receiver() as (runtime, request):
            token = self.token("codex-hook", runtime)
            for event in (
                activity(prompt="private text"), activity(transcriptPath="private path"), activity(at=NOW),
                activity("x" * 1024), activity(kind=["started"]), activity(session="../bad"),
                activity(turn=42), activity(agentType="bad\nname"), activity(agentType="bad\u202ename"),
                {key: value for key, value in activity().items() if key != "turnId"},
            ):
                with self.subTest(event=event):
                    self.assertEqual(request("POST", token=token, payload=event)[0], 400)
            self.assertEqual(json.loads(request("GET")[2])["sessions"], [])

    def test_worker_results_require_matching_start_and_preserve_outcomes(self):
        start = activity("job-start", jobId="job-a", taskTitle="核對接收器")
        result = activity("job-end", "completed", jobId="job-a")
        with self.codex_receiver() as (runtime, request):
            token = self.token("codex-hook", runtime)
            self.assertEqual(request("POST", token=token, payload=result)[0], 409)
            self.assertEqual(request("POST", token=token, payload=start)[0], 200)
            projected = json.loads(request("GET")[2])["sessions"][0]["agents"][0]
            self.assertIsNone(projected["outcome"])
            self.assertEqual(projected["taskTitle"], "核對接收器")
            for changed in ({"sessionId": "session-b"}, {"agentId": "worker-2"}, {"jobId": "job-b"}):
                self.assertEqual(request("POST", token=token, payload={**result, **changed})[0], 409)
            self.assertEqual(request("POST", token=token, payload=result)[0], 200)
            self.assertEqual(request("POST", token=token, payload={**result, "eventId": "failed", "kind": "failed"})[0], 409)
            other = activity("job-other-start", agent="worker-2", jobId="job-b", taskTitle="檢查介面")
            self.assertEqual(request("POST", token=token, payload=other)[0], 200)
            self.assertEqual(request("POST", token=token, payload=activity(
                "job-other-end", "failed", agent="worker-2", jobId="job-b",
            ))[0], 200)
        with self.codex_receiver() as (runtime, request):
            token = self.token("codex-hook", runtime)
            status, _, raw = request("POST", token=token, payload=result)
            self.assertEqual((status, json.loads(raw)), (200, {"ok": True, "deduped": True}))
            self.assertEqual(request("POST", token=token, payload=activity("native-stop", "stopped"))[0], 200)
            self.assertEqual(request("POST", token=token, payload=activity(
                "new-job-reused-worker", jobId="job-new", taskTitle="重複的身分",
            ))[0], 409)
            session = json.loads(request("GET")[2])["sessions"][0]
            agents = {agent["agentId"]: agent for agent in session["agents"]}
            self.assertEqual(agents["worker-1"]["outcome"], "completed")
            self.assertEqual(agents["worker-2"]["outcome"], "failed")
            self.assertEqual(agents["worker-1"]["taskTitle"], "核對接收器")
            recent = {event["eventId"]: event for event in session["recent"]}
            self.assertEqual(recent["job-end"]["jobId"], "job-a")
            self.assertEqual(recent["job-end"]["kind"], "completed")
            self.assertEqual(recent["job-start"]["taskTitle"], "核對接收器")
            self.assertEqual(agents["worker-1"]["stoppedAt"], recent["job-end"]["at"])
            self.assertEqual(agents["worker-1"]["lastEventAt"], recent["job-end"]["at"])

    def test_worker_reports_validate_kind_job_and_title_together(self):
        with self.codex_receiver() as (runtime, request):
            token = self.token("codex-hook", runtime)
            for event in (
                activity(kind="completed"),
                activity(kind="stopped", jobId="job-a"),
                activity(taskTitle="沒有工作代碼"),
                activity(jobId="job-a"),
                activity(jobId="../bad", taskTitle="無效的工作代碼"),
                activity(jobId="job-a", taskTitle="核" * 161),
                activity(jobId="job-a", taskTitle=" "),
                activity(jobId="job-a", taskTitle="多\n行"),
            ):
                with self.subTest(event=event):
                    self.assertEqual(request("POST", token=token, payload=event)[0], 400)

    def test_existing_activity_database_is_migrated_without_changing_native_history(self):
        runtime = self.runtime / "codex"
        runtime.mkdir()
        srv.restrict(runtime)
        path = runtime / "codex-activity.sqlite3"
        with closing(sqlite3.connect(path)) as database, database:
            database.execute("""CREATE TABLE events (
                sequence INTEGER PRIMARY KEY, event_id TEXT NOT NULL UNIQUE, kind TEXT NOT NULL,
                session_id TEXT NOT NULL, agent_id TEXT NOT NULL, agent_type TEXT NOT NULL,
                turn_id TEXT, at INTEGER NOT NULL
            )""")
            database.execute(
                "INSERT INTO events VALUES (1, 'old-stop', 'stopped', 'session-a', 'legacy', 'reviewer', NULL, ?)",
                (NOW,),
            )
        srv.restrict(path)
        with self.codex_receiver() as (_, request):
            snapshot = json.loads(request("GET")[2])["sessions"][0]
            self.assertEqual(snapshot["recent"], [{
                "eventId": "old-stop", "kind": "stopped", "agentId": "legacy",
                "agentType": "reviewer", "turnId": None, "at": NOW,
            }])
            self.assertEqual(snapshot["agents"], [{
                "agentId": "legacy", "agentType": "reviewer", "turnId": None,
                "startedAt": None, "stoppedAt": NOW, "lastEventAt": NOW,
            }])

    def test_activity_cli_reports_and_retries_using_only_the_local_receiver(self):
        runtime = self.runtime / "cli-codex"
        app = srv.App(runtime, 300_000, False, None, roster="codex")
        script = Path(__file__).with_name("report_activity.py")
        with srv.serve(app, "127.0.0.1", 0) as httpd:
            port = httpd.server_address[1]
            thread = threading.Thread(target=httpd.serve_forever, daemon=True)
            thread.start()
            try:
                command = [
                    sys.executable, "-B", str(script), "--runtime-dir", str(runtime),
                    "--session-id", "office-live", "--agent-id", "actual-worker-id",
                    "--job-id", "dispatched-job",
                ]
                for suffix, expected_exit, expected in (
                    (["--url", "http://example.com/api/codex-activity", "--status", "started", "--task", "驗證"], 2, "rejected"),
                    (["--status", "started"], 2, "rejected"),
                    (["--status", "started", "--task", "驗證"], 0, "ok"),
                    (["--status", "started", "--task", "驗證"], 0, "deduped"),
                    (["--status", "completed"], 0, "ok"),
                ):
                    argv = command + ["--url", f"http://127.0.0.1:{port}{ACTIVITY}"] + suffix
                    result = subprocess.run(argv, capture_output=True, text=True, timeout=10)
                    self.assertEqual(result.returncode, expected_exit, result.stdout + result.stderr)
                    self.assertIn(f"result={expected}", result.stdout + result.stderr)
                _, _, raw = self.request("GET", ACTIVITY, port=port)
                session = json.loads(raw)["sessions"][0]
                self.assertEqual(session["sessionId"], "office-live")
                self.assertEqual(session["agents"][0]["agentId"], "actual-worker-id")
                self.assertEqual(session["agents"][0]["outcome"], "completed")
                self.assertEqual(session["agents"][0]["taskTitle"], "驗證")
                self.assertEqual(len(session["recent"]), 2)
            finally:
                httpd.shutdown()
                thread.join(timeout=3)

    def test_spoofing_independence_fixture_and_cli(self):
        status, headers, raw = self.request("GET", "/api/self-report", extra_headers={"Origin": "https://evil.example"})
        self.assertEqual(status, 200)
        self.assertNotIn("access-control-allow-origin", headers)
        view = json.loads(raw)
        self.assertEqual(len(view["agents"]), 4)
        self.assertTrue(all(item["reason"] == "missing_report" for item in view["agents"]))
        self.assertEqual(view["agentId"], A)
        denied, _, _ = self.request("POST", "/api/self-report", payload=body())
        self.assertEqual(denied, 401)
        spoof, _, spoof_body = self.request("POST", "/api/self-report", token=self.token(A), payload=body(B, job="job-b", event_id="spoof", title="冒充開發"))
        self.assertEqual(spoof, 403)
        self.assertEqual(json.loads(spoof_body)["error"], "identity_mismatch")
        after = json.loads(self.request("GET", "/api/self-report")[2])
        self.assertTrue(all(item["reason"] == "missing_report" for item in after["agents"]))
        started, _, _ = self.request("POST", "/api/self-report", token=self.token(B), payload=body(B, job="job-b", event_id="dev-start", title="整理開發備註"))
        self.assertEqual(started, 200)
        split = json.loads(self.request("GET", "/api/self-report")[2])
        self.assertEqual(split["agents"][0]["reason"], "missing_report")
        self.assertEqual(split["agents"][1]["taskTitle"], "整理開發備註")
        self.assertEqual(split["agents"][2]["reason"], "missing_report")
        self.assertEqual(split["effectiveStatus"], "unknown")
        fixture, _, _ = self.request(
            "POST",
            "/api/fixture-report",
            token=self.token(A),
            payload=body(srv.FIXTURE_AGENT, job="fix", event_id="fix", title="夾具"),
        )
        self.assertEqual(fixture, 403)
        fit, _, _ = self.request(
            "POST",
            "/api/fixture-report",
            token=self.token(srv.FIXTURE_AGENT),
            payload=body(srv.FIXTURE_AGENT, job="fix", event_id="fix", title="夾具工作"),
        )
        self.assertEqual(fit, 200)
        real_again = json.loads(self.request("GET", "/api/self-report")[2])
        fixture_view = json.loads(self.request("GET", "/api/fixture-report")[2])
        self.assertEqual(real_again["agents"][1]["jobId"], "job-b")
        self.assertTrue(all(item["agentId"] != srv.FIXTURE_AGENT for item in real_again["agents"]))
        self.assertEqual(fixture_view["partition"], "fixture")
        self.assertEqual(fixture_view["evidenceType"], "fixture")
        disk = (self.runtime / "state.json").read_text(encoding="utf-8")
        self.assertNotIn(self.token(A), disk)
        self.assertNotIn("Bearer", disk)
        mode = stat.S_IMODE((self.runtime / "headers" / f"{A}.header").stat().st_mode)
        if os.name != "nt":
            self.assertEqual(mode, 0o600)
        out = io.StringIO()
        err = io.StringIO()
        with redirect_stdout(out), redirect_stderr(err):
            code = report_task.main(
                [
                    "--agent-id",
                    C,
                    "--job-id",
                    "job-c",
                    "--status",
                    "started",
                    "--task",
                    "畫四個座位的名稱",
                    "--runtime-dir",
                    str(self.runtime),
                    "--url",
                    f"http://127.0.0.1:{self.port}/api/self-report",
                    "--event-id",
                    "cli-design-start",
                    "--at",
                    str(NOW),
                ]
            )
        text = out.getvalue() + err.getvalue()
        self.assertEqual(code, 0, text)
        self.assertNotIn(self.token(C), text)
        self.assertNotIn("Bearer", text)
        self.assertIn("result=ok", text)
        latest = json.loads(self.request("GET", "/api/self-report")[2])
        self.assertEqual(latest["agents"][2]["taskTitle"], "畫四個座位的名稱")
        self.assertEqual(latest["agents"][3]["reason"], "missing_report")
        self.assertEqual(latest["agents"][1]["effectiveStatus"], "working")

    def test_refuses_legacy_port_and_directory(self):
        err = io.StringIO()
        with redirect_stderr(err):
            self.assertEqual(srv.main(["--port", "8792", "--runtime-dir", str(self.runtime / "fresh")]), 2)
            self.assertEqual(srv.main(["--runtime-dir", str(self.runtime / "agent-office-self-report")]), 2)
        self.assertNotIn("Bearer", err.getvalue())

    def test_codex_roster_has_independent_identities(self):
        options, unknown = srv.build_parser().parse_known_args(["--roster", "codex"])
        self.assertEqual(unknown, [])
        codex = srv.App(self.runtime / "codex", 300_000, True, None, roster=options.roster)
        view = codex.snapshot("real")
        self.assertEqual(view["roster"], "codex")
        self.assertEqual(
            [(row["agentId"], row["name"]) for row in view["agents"]],
            [("codex-lead", "Codex 協調"), ("codex-api", "Codex 接收器"), ("codex-ui", "Codex 看板"), ("codex-qa", "Codex 驗證")],
        )
        self.assertEqual(view["evidenceType"], "bot-self-report")
        self.assertNotIn("roster", codex.snapshot("fixture"))
        self.assertNotIn("roster", self.app.snapshot("real"))
        self.assertIsNone(codex.classify(self.token(A)))
        self.assertEqual(codex.classify(codex.tokens["codex-api"]), ("real", "codex-api"))

    def test_codex_cannot_reuse_bot_runtime_without_saved_reports(self):
        with self.assertRaises(SystemExit):
            srv.App(self.runtime, 300_000, False, None, roster="codex")
        self.assertFalse((self.runtime / "headers" / "codex-api.header").exists())
        self.assertEqual(self.app.classify(self.token(A)), ("real", A))

    def test_codex_health_identifies_the_service(self):
        codex = srv.App(self.runtime / "codex", 300_000, False, None, roster="codex")
        with srv.serve(codex, "127.0.0.1", 0) as httpd:
            thread = threading.Thread(target=httpd.handle_request, daemon=True)
            thread.start()
            status, _, raw = self.request("GET", "/health", port=httpd.server_address[1])
            thread.join(timeout=3)
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(raw)["service"], "agent-office-codex-report")
        self.assertIs(json.loads(raw).get("codexActivity"), True)
        bot = json.loads(self.request("GET", "/health")[2])
        self.assertEqual(bot["service"], "agent-office-multi-report")
        self.assertNotIn("codexActivity", bot)

    def test_duplicate_port_leaves_runtime_untouched(self):
        unused_runtime = self.runtime / "new-runtime"
        with redirect_stderr(io.StringIO()):
            result = srv.main(["--port", str(self.port), "--runtime-dir", str(unused_runtime)])
        self.assertEqual(result, 2)
        self.assertFalse(unused_runtime.exists())


if __name__ == "__main__":
    unittest.main()
