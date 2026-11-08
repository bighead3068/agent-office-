import http.client
import io
import json
import os
import stat
import tempfile
import threading
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path

import report_task
import self_report_server as srv

A = srv.TRUSTED_IDS[0]
B = srv.TRUSTED_IDS[1]
C = srv.TRUSTED_IDS[2]
D = srv.TRUSTED_IDS[3]
NOW = 1_700_000_000_000


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

    def token(self, agent_id):
        line = (self.runtime / "headers" / f"{agent_id}.header").read_text(encoding="utf-8").strip()
        return line.split(" ")[2]

    def request(self, method, path, token=None, payload=None, extra_headers=None):
        connection = http.client.HTTPConnection("127.0.0.1", self.port, timeout=3)
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


if __name__ == "__main__":
    unittest.main()
