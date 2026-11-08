import { describe, expect, it } from "vitest";
import { DEMO_ROSTER } from "./officeAdapter";
import { EVIDENCE_TYPE, FIXTURE_BANNER, REAL_BANNER, TRUSTED, localFallback, projectSelfReport, type AgentReport, type SelfReportPayload } from "./selfReport";

function row(overrides: Partial<AgentReport> = {}): AgentReport {
  return {
    agentId: TRUSTED[0].id,
    sourceId: TRUSTED[0].id,
    effectiveStatus: "unknown",
    lastKnownStatus: null,
    freshness: "none",
    reason: "missing_report",
    jobId: null,
    taskTitle: null,
    startedAt: null,
    terminalAt: null,
    lastReportAt: null,
    provenance: null,
    callerLabel: null,
    evidenceType: EVIDENCE_TYPE,
    ...overrides,
  };
}

function realPayload(rows: AgentReport[]): SelfReportPayload {
  return { partition: "real", evidenceType: EVIDENCE_TYPE, ttlMs: 300000, agents: rows };
}

describe("four trusted self-reports", () => {
  it("shows four unknown seats before any report and never idle", () => {
    const view = localFallback("real");
    expect(view.banner).toBe(REAL_BANNER);
    expect(view.evidenceType).toBe(EVIDENCE_TYPE);
    expect(view.seats.map((seat) => seat.agent.name)).toEqual(TRUSTED.map((person) => person.name));
    expect(view.counts.unknown).toBe(4);
    expect(view.counts.idle).toBe(0);
    expect(view.seats.every((seat) => seat.agent.status !== "idle" && seat.taskTitle === "尚未收到回報")).toBe(true);
    for (const person of DEMO_ROSTER) {
      expect(view.seats.some((seat) => seat.agent.name === person.name)).toBe(false);
    }
  });

  it("keeps each source independent and shows the Chinese task title", () => {
    const rows = TRUSTED.map((person, index) =>
      row({
        agentId: person.id,
        sourceId: person.id,
        ...(index === 1
          ? {
              effectiveStatus: "working",
              lastKnownStatus: "working",
              freshness: "fresh",
              reason: "report",
              jobId: "job-dev",
              taskTitle: "整理開發備註",
              provenance: { sourceId: person.id, agentId: person.id, eventId: "evt", type: "task.started", at: 10, evidenceType: EVIDENCE_TYPE },
            }
          : {}),
      }),
    );
    const view = projectSelfReport(realPayload(rows), "real");
    expect(view?.seats[1]?.taskTitle).toBe("整理開發備註");
    expect(view?.seats[1]?.agent.status).toBe("working");
    expect(view?.seats[0]?.agent.status).toBe("unknown");
    expect(view?.seats[3]?.reason).toBe("missing_report");
    expect(view?.counts.working).toBe(1);
    expect(view?.counts.unknown).toBe(3);
    expect(view?.counts.idle).toBe(0);
  });

  it("keeps a stale completed task visible while the effective state is unknown", () => {
    const rows = TRUSTED.map((person, index) =>
      row({
        agentId: person.id,
        sourceId: person.id,
        ...(index === 0
          ? {
              effectiveStatus: "unknown",
              lastKnownStatus: "completed",
              freshness: "stale",
              reason: "ttl",
              jobId: "job-1",
              taskTitle: "協調今天的範圍",
              lastReportAt: 1_000,
              provenance: { sourceId: person.id, agentId: person.id, eventId: "done", type: "task.completed", at: 1_000, evidenceType: EVIDENCE_TYPE },
            }
          : {}),
      }),
    );
    const view = projectSelfReport(realPayload(rows), "real");
    const seat = view?.seats[0];
    expect(seat?.agent.status).toBe("unknown");
    expect(seat?.agent.freshness).toBe("stale");
    expect(seat?.lastKnownLabel).toBe("已完成");
    expect(seat?.effectiveLabel).toBe("未知");
    expect(seat?.taskTitle).toBe("協調今天的範圍");
    expect(view?.counts.completed).toBe(0);
    expect(view?.counts.unknown).toBe(4);
    expect(view?.stale).toBe(1);
    expect(view?.counts.idle).toBe(0);
  });

  it("rejects idle, swapped sources, fixture leakage, and renamed identities", () => {
    const swapped = TRUSTED.map((person) => row({ agentId: person.id, sourceId: person.id }));
    swapped[0] = row({ agentId: TRUSTED[1].id, sourceId: TRUSTED[1].id });
    expect(projectSelfReport(realPayload(swapped), "real")).toBeNull();
    const idle = TRUSTED.map((person) => row({ agentId: person.id, sourceId: person.id, effectiveStatus: "idle" }));
    expect(projectSelfReport(realPayload(idle), "real")).toBeNull();
    const renamed = TRUSTED.map((person) => row({ agentId: person.id, sourceId: person.id, name: "林知夏" }));
    const view = projectSelfReport(realPayload(renamed), "real");
    expect(view?.seats[0]?.agent.name).toBe(TRUSTED[0].name);
    expect(projectSelfReport({ partition: "fixture", agents: TRUSTED.map((person) => row({ agentId: person.id, sourceId: person.id })) }, "real")).toBeNull();
    const fixture = projectSelfReport(
      {
        partition: "fixture",
        agents: [row({ agentId: "fixture-agent", sourceId: "fixture-local", evidenceType: "fixture", effectiveStatus: "working", lastKnownStatus: "working", freshness: "fresh", reason: "report", taskTitle: "夾具工作", jobId: "fix" })],
      },
      "fixture",
    );
    expect(fixture?.banner).toBe(FIXTURE_BANNER);
    expect(fixture?.banner).not.toBe(REAL_BANNER);
    expect(fixture?.seats).toHaveLength(1);
  });
});
