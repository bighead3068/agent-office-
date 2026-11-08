import http.client
import json
import os
import stat
import tempfile
import threading
import unittest
from pathlib import Path

import self_report_server as srv

REAL = srv.REAL_ID


def event(kind="task.started", job="job-1", at=1_700_000_000_000, event_id="evt-1", source=REAL, agent=REAL, label=None, **extra):
    body = {
        "eventId": event_id,
        "type": kind,
        "jobId": job,
        "at": at,
        "sourceId": source,
        "agentId": agent,
    }
    if label is not None:
        body["label"] = label
    body.update(extra)
    return body


class LogicTests(unittest.TestCase):
    def setUp(self):
        self.state = srv.empty_state("real", REAL, REAL)
        self.binding = {"sourceId": REAL, "agentId": REAL}
        self.now = 1_700_000_000_000

    def accept(self, body, now=None):
        parsed = srv.parse_event(body, self.binding)
        self.assertTrue(parsed["ok"], parsed)
        return srv.apply_event(self.state, parsed["event"], self.now if now is None else now)

    def test_started_completed_and_failed_are_distinct_terminals(self):
        self.assertTrue(self.accept(event())["ok"])
        view = srv.project(self.state, self.now + 10, 45_000)
        self.assertEqual(view["effectiveStatus"], "working")
        self.assertNotEqual(view["effectiveStatus"], "idle")
        done = self.accept(event("task.completed", at=self.now + 20, event_id="evt-2"), now=self.now + 20)
        self.assertTrue(done["ok"])
        completed = srv.project(self.state, self.now + 30, 45_000)
        self.assertEqual(completed["effectiveStatus"], "completed")
        self.assertEqual(completed["jobId"], "job-1")
        self.assertEqual(completed["provenance"]["agentId"], REAL)
        other = srv.empty_state("real", REAL, REAL)
        srv.apply_event(other, srv.parse_event(event(at=self.now), self.binding)["event"], self.now)
        failed = srv.apply_event(
            other,
            srv.parse_event(event("task.failed", at=self.now + 5, event_id="evt-f"), self.binding)["event"],
            self.now + 5,
        )
        self.assertTrue(failed["ok"])
        self.assertEqual(srv.project(other, self.now + 6, 45_000)["effectiveStatus"], "failed")
        self.assertNotEqual(
            srv.project(self.state, self.now + 30, 45_000)["effectiveStatus"],
            srv.project(other, self.now + 6, 45_000)["effectiveStatus"],
        )

    def test_missing_report_and_ttl_are_unknown_without_idle(self):
        missing = srv.project(self.state, self.now, 45_000)
        self.assertEqual(missing["reason"], "missing_report")
        self.assertEqual(missing["effectiveStatus"], "unknown")
        self.assertIsNone(missing["lastKnownStatus"])
        self.assertNotIn("idle", json.dumps(missing))
        self.accept(event())
        stale = srv.project(self.state, self.now + 45_001, 45_000)
        self.assertEqual(stale["reason"], "ttl")
        self.assertEqual(stale["effectiveStatus"], "unknown")
        self.assertEqual(stale["lastKnownStatus"], "working")
        self.assertEqual(stale["freshness"], "stale")
        self.assertNotEqual(stale["effectiveStatus"], "idle")

    def test_duplicate_and_out_of_order(self):
        self.accept(event())
        again = self.accept(event())
        self.assertTrue(again["deduped"])
        self.assertEqual(self.state["job"]["phase"], "working")
        early = self.accept(event("task.completed", at=self.now - 10, event_id="evt-old"))
        self.assertEqual(early["error"], "out_of_order")
        wrong_job = self.accept(event("task.completed", job="other", at=self.now + 5, event_id="evt-other"))
        self.assertEqual(wrong_job["error"], "out_of_order")
        before = srv.empty_state("real", REAL, REAL)
        parsed = srv.parse_event(event("task.completed"), self.binding)
        self.assertEqual(srv.apply_event(before, parsed["event"], self.now)["error"], "out_of_order")
        self.accept(event("task.completed", at=self.now + 5, event_id="evt-done"))
        second = self.accept(event("task.failed", at=self.now + 6, event_id="evt-fail"))
        self.assertEqual(second["error"], "out_of_order")
        self.assertEqual(self.state["job"]["phase"], "completed")

    def test_label_is_not_identity_and_chat_fields_are_rejected(self):
        parsed = srv.parse_event(event(label="林知夏", source="demo-sim", agent=REAL), self.binding)
        self.assertEqual(parsed["error"], "identity_mismatch")
        ok = self.accept(event(label="林知夏"))
        self.assertTrue(ok["ok"])
        self.assertEqual(self.state["job"]["callerLabel"], "林知夏")
        self.assertEqual(self.state["agentId"], REAL)
        self.assertEqual(srv.project(self.state, self.now, 45_000)["provenance"]["sourceId"], REAL)
        leaked = srv.parse_event(event(chat="secret conversation"), self.binding)
        self.assertEqual(leaked["error"], "unexpected_field")
        self.assertNotIn("secret conversation", json.dumps(self.state))

    def test_malformed_payloads(self):
        for body in (
            event(kind="task.idle"),
            event(at="now"),
            {"eventId": "x"},
            event(event_id=""),
            event(label="line\nbreak"),
        ):
            if isinstance(body.get("at"), str):
                self.assertEqual(srv.parse_event(body, self.binding)["error"], "malformed")
            else:
                self.assertFalse(srv.parse_event(body, self.binding)["ok"])


class HttpTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.runtime = Path(self.tmp.name)
        self.app = srv.App(self.runtime, 45_000, True, None)
        self.httpd = srv.serve(self.app, "127.0.0.1", 0)
        self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)
        self.thread.start()
        self.port = self.httpd.server_address[1]

    def tearDown(self):
        self.httpd.shutdown()
        self.httpd.server_close()
        self.tmp.cleanup()

    def request(self, method, path, token=None, body=None, extra_headers=None, raw=None):
        connection = http.client.HTTPConnection("127.0.0.1", self.port, timeout=3)
        headers = {}
        if extra_headers:
            headers.update(extra_headers)
        data = raw
        if body is not None:
            data = json.dumps(body).encode("utf-8")
            headers["Content-Type"] = "application/json"
        if token is not None:
            headers["Authorization"] = f"Bearer {token}"
        if data is not None and "Content-Length" not in headers:
            headers["Content-Length"] = str(len(data))
        connection.request(method, path, body=data, headers=headers)
        response = connection.getresponse()
        payload = response.read()
        found = {key.lower(): value for key, value in response.getheaders()}
        status = response.status
        connection.close()
        return status, found, payload

    def test_auth_source_binding_and_fixture_separation(self):
        status, headers, _ = self.request("GET", "/api/self-report", extra_headers={"Origin": "https://evil.example"})
        self.assertEqual(status, 200)
        self.assertNotIn("access-control-allow-origin", headers)
        self.assertNotIn("access-control-allow-credentials", headers)
        missing = json.loads(self.request("GET", "/api/self-report")[2])
        self.assertEqual(missing["reason"], "missing_report")
        self.assertEqual(missing["agentId"], REAL)

        denied, _, _ = self.request("POST", "/api/self-report", body=event())
        self.assertEqual(denied, 401)
        bad, _, _ = self.request("POST", "/api/self-report", token="nope", body=event())
        self.assertEqual(bad, 401)
        cross, _, _ = self.request("POST", "/api/self-report", token=self.app.fixture_token, body=event(source=srv.FIXTURE_SOURCE, agent=srv.FIXTURE_AGENT))
        self.assertEqual(cross, 403)
        mismatch, _, body = self.request(
            "POST",
            "/api/self-report",
            token=self.app.real_token,
            body=event(source="demo-sim", agent="lin", label="林知夏"),
        )
        self.assertEqual(mismatch, 403)
        self.assertEqual(json.loads(body)["error"], "identity_mismatch")
        real_view = json.loads(self.request("GET", "/api/self-report")[2])
        self.assertEqual(real_view["reason"], "missing_report")

        started, _, _ = self.request("POST", "/api/self-report", token=self.app.real_token, body=event(label="not-identity"))
        self.assertEqual(started, 200)
        view = json.loads(self.request("GET", "/api/self-report")[2])
        self.assertEqual(view["effectiveStatus"], "working")
        self.assertEqual(view["agentId"], REAL)
        self.assertEqual(view["callerLabel"], "not-identity")
        self.assertEqual(view["provenance"]["sourceId"], REAL)

        fixture_denied, _, _ = self.request(
            "POST",
            "/api/fixture-report",
            token=self.app.real_token,
            body=event(source=srv.FIXTURE_SOURCE, agent=srv.FIXTURE_AGENT, event_id="fix-1"),
        )
        self.assertEqual(fixture_denied, 403)
        fixture_ok, _, _ = self.request(
            "POST",
            "/api/fixture-report",
            token=self.app.fixture_token,
            body=event(source=srv.FIXTURE_SOURCE, agent=srv.FIXTURE_AGENT, event_id="fix-1", job="fix-job"),
        )
        self.assertEqual(fixture_ok, 200)
        fixture_view = json.loads(self.request("GET", "/api/fixture-report")[2])
        real_again = json.loads(self.request("GET", "/api/self-report")[2])
        self.assertEqual(fixture_view["partition"], "fixture")
        self.assertEqual(fixture_view["jobId"], "fix-job")
        self.assertEqual(real_again["partition"], "real")
        self.assertEqual(real_again["jobId"], "job-1")
        self.assertNotEqual(real_again["agentId"], fixture_view["agentId"])
        self.assertNotIn(self.app.real_token, (self.runtime / "state.json").read_text(encoding="utf-8"))
        self.assertNotIn(self.app.real_token, (self.runtime / "fixture-state.json").read_text(encoding="utf-8"))

    def test_duplicate_malformed_size_and_file_mode(self):
        ok, _, _ = self.request("POST", "/api/self-report", token=self.app.real_token, body=event())
        self.assertEqual(ok, 200)
        dup, _, payload = self.request("POST", "/api/self-report", token=self.app.real_token, body=event(label="changed"))
        self.assertEqual(dup, 200)
        self.assertTrue(json.loads(payload)["deduped"])
        self.assertIsNone(json.loads(self.request("GET", "/api/self-report")[2])["callerLabel"])
        huge = b"{" + b" " * (srv.MAX_BODY + 8)
        status, _, _ = self.request("POST", "/api/self-report", token=self.app.real_token, raw=huge)
        self.assertEqual(status, 413)
        mode = stat.S_IMODE((self.runtime / "token").stat().st_mode)
        header_mode = stat.S_IMODE((self.runtime / "token-auth.header").stat().st_mode)
        if os.name != "nt":
            self.assertEqual(mode, 0o600)
            self.assertEqual(header_mode, 0o600)

    def test_options_has_no_credential_cors(self):
        status, headers, _ = self.request("OPTIONS", "/api/self-report", extra_headers={"Origin": "https://evil.example", "Access-Control-Request-Method": "POST"})
        self.assertEqual(status, 204)
        self.assertNotIn("access-control-allow-origin", headers)
        self.assertNotIn("access-control-allow-credentials", headers)


if __name__ == "__main__":
    unittest.main()
