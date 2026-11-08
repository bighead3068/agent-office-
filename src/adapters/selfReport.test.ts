import { describe, expect, it } from "vitest";
import { DEMO_ROSTER } from "./officeAdapter";
import {
  FIXTURE_BANNER,
  REAL_AGENT_ID,
  REAL_BANNER,
  projectSelfReport,
  requestedPartition,
  type SelfReportPayload,
} from "./selfReport";

function payload(overrides: Partial<SelfReportPayload> = {}): SelfReportPayload {
  return {
    partition: "real",
    sourceId: REAL_AGENT_ID,
    agentId: REAL_AGENT_ID,
    ttlMs: 45000,
    serverNow: 2_000,
    effectiveStatus: "unknown",
    lastKnownStatus: null,
    freshness: "none",
    reason: "missing_report",
    jobId: null,
    startedAt: null,
    terminalAt: null,
    lastReportAt: null,
    provenance: null,
    callerLabel: null,
    ...overrides,
  };
}

describe("self-report adapter", () => {
  it("keeps a missing report unknown and never idle", () => {
    const view = projectSelfReport(payload(), "real");
    expect(view?.banner).toBe(REAL_BANNER);
    expect(view?.agent.status).toBe("unknown");
    expect(view?.counts.unknown).toBe(1);
    expect(view?.counts.idle).toBe(0);
    expect(view?.egg).toBe("不會出現");
    expect(view?.disconnected).toBe(0);
    expect(view?.identity).toBe(REAL_AGENT_ID);
  });

  it("maps started, completed, and failed without inventing idle", () => {
    const working = projectSelfReport(
      payload({
        effectiveStatus: "working",
        lastKnownStatus: "working",
        freshness: "fresh",
        reason: "report",
        jobId: "job-1",
        startedAt: 1_000,
        lastReportAt: 1_000,
        provenance: { sourceId: REAL_AGENT_ID, agentId: REAL_AGENT_ID, eventId: "evt-1", type: "task.started", at: 1_000 },
      }),
      "real",
    );
    const completed = projectSelfReport(
      payload({
        effectiveStatus: "completed",
        lastKnownStatus: "completed",
        freshness: "fresh",
        reason: "report",
        jobId: "job-1",
        provenance: { sourceId: REAL_AGENT_ID, agentId: REAL_AGENT_ID, eventId: "evt-2", type: "task.completed", at: 1_500 },
      }),
      "real",
    );
    const failed = projectSelfReport(
      payload({
        effectiveStatus: "failed",
        lastKnownStatus: "failed",
        freshness: "fresh",
        reason: "report",
        jobId: "job-1",
      }),
      "real",
    );
    expect(working?.agent.status).toBe("working");
    expect(working?.counts.working).toBe(1);
    expect(working?.counts.idle).toBe(0);
    expect(completed?.agent.status).toBe("completed");
    expect(failed?.agent.status).toBe("failed");
    expect(completed?.agent.status).not.toBe(failed?.agent.status);
    expect(working?.jobText).toBe("工作 job-1");
  });

  it("turns a missed TTL into unknown while keeping the last known status", () => {
    const view = projectSelfReport(
      payload({
        effectiveStatus: "unknown",
        lastKnownStatus: "working",
        freshness: "stale",
        reason: "ttl",
        jobId: "job-1",
        lastReportAt: 1_000,
      }),
      "real",
    );
    expect(view?.agent.status).toBe("unknown");
    expect(view?.agent.freshness).toBe("stale");
    expect(view?.lastKnownLabel).toBe("工作中");
    expect(view?.effectiveLabel).toBe("未知");
    expect(view?.counts.idle).toBe(0);
    expect(view?.counts.working).toBe(0);
    expect(view?.stale).toBe(1);
  });

  it("rejects idle, fixture identity, and demo names in the real view", () => {
    expect(projectSelfReport(payload({ effectiveStatus: "idle" }), "real")).toBeNull();
    expect(projectSelfReport(payload({ lastKnownStatus: "idle", effectiveStatus: "unknown" }), "real")).toBeNull();
    expect(projectSelfReport(payload({ partition: "fixture", sourceId: "fixture-local", agentId: "fixture-agent" }), "real")).toBeNull();
    expect(projectSelfReport(payload({ agentId: "lin", sourceId: "demo-sim" }), "real")).toBeNull();
    const labeled = projectSelfReport(payload({ callerLabel: "林知夏", reason: "report", effectiveStatus: "working", lastKnownStatus: "working", jobId: "job-9" }), "real");
    expect(labeled?.identity).toBe(REAL_AGENT_ID);
    expect(labeled?.agent.id).toBe(REAL_AGENT_ID);
    expect(labeled?.agent.name).toBe("自行回報");
    expect(labeled?.callerLabel).toBe("林知夏");
    for (const person of DEMO_ROSTER) {
      expect(labeled?.agent.name).not.toBe(person.name);
      expect(labeled?.identity).not.toBe(person.id);
    }
  });

  it("labels the fixture partition so it cannot pass as the parent bot", () => {
    const view = projectSelfReport(
      payload({
        partition: "fixture",
        sourceId: "fixture-local",
        agentId: "fixture-agent",
        effectiveStatus: "working",
        lastKnownStatus: "working",
        freshness: "fresh",
        reason: "report",
        jobId: "fix-job",
      }),
      "fixture",
    );
    expect(view?.banner).toBe(FIXTURE_BANNER);
    expect(view?.banner).not.toBe(REAL_BANNER);
    expect(view?.agent.name).toBe("夾具代理人");
    expect(view?.agent.role).toBe("不是父層 Bot");
    expect(requestedPartition("?partition=fixture")).toBe("fixture");
    expect(requestedPartition("")).toBe("real");
  });
});
