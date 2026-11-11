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
    expect(seat?.outcomeLabel).toBe("已完成");
    expect(seat?.taskTitle).toBe("協調今天的範圍");
    expect(view?.counts.completed).toBe(0);
    expect(view?.counts.unknown).toBe(4);
    expect(view?.stale).toBe(1);
    expect(view?.counts.idle).toBe(0);
  });

  it("groups the selected seat's recent jobs and keeps times from the compacted snapshot", () => {
    const rows = TRUSTED.map(({ id }, index) => row({ agentId: id, sourceId: id, ...(index === 0 ? {
      effectiveStatus: "unknown",
      lastKnownStatus: "failed",
      freshness: "stale",
      reason: "ttl",
      jobId: "new",
      taskTitle: "驗證修復",
      startedAt: 7_000,
      terminalAt: 14_000,
      provenance: { sourceId: id, agentId: id, eventId: "failed", type: "task.failed", at: 14_000 },
    } : {}) }));
    const payload = {
      ...realPayload(rows),
      recent: [
        { eventId: "prior-done", type: "task.completed", agentId: TRUSTED[0].id, jobId: "old", taskTitle: null, at: 6_000, acceptedAt: 6_010 },
        { eventId: "another-seat", type: "task.started", agentId: TRUSTED[1].id, jobId: "new", taskTitle: "另一個座位", at: 8_000, acceptedAt: 8_010 },
        { eventId: "prior-start", type: "task.started", agentId: TRUSTED[0].id, jobId: "old", taskTitle: "寫報告", at: 2_000, acceptedAt: 2_010 },
        { eventId: "new-progress", type: "task.progress", agentId: TRUSTED[0].id, jobId: "new", taskTitle: "執行測試", at: 10_000, acceptedAt: 10_010 },
      ],
    };
    const seat = projectSelfReport(payload, "real")?.seats[0];

    expect(seat?.outcomeLabel).toBe("失敗");
    expect(seat?.jobs.map(({ jobId, title, durationMs, events }) => ({
      jobId, title, durationMs, events: events.map(({ type, at }) => [type, at]),
    }))).toEqual([
      { jobId: "new", title: "驗證修復", durationMs: 7_000, events: [["task.started", 7_000], ["task.progress", 10_000], ["task.failed", 14_000]] },
      { jobId: "old", title: "寫報告", durationMs: 4_000, events: [["task.started", 2_000], ["task.completed", 6_000]] },
    ]);
    expect(seat?.jobs[0]?.events[1]?.acceptedAt).toBe(10_010);
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

describe("Codex self-reports", () => {
  const rows = ["codex-lead", "codex-api", "codex-ui", "codex-qa"].map((id) => row({ agentId: id, sourceId: id }));

  it("shows a Codex task with the registered name and local self-report evidence", () => {
    const reportedRows = [...rows];
    reportedRows[2] = row({
      agentId: "codex-ui",
      sourceId: "codex-ui",
      name: "Untrusted caller name",
      effectiveStatus: "working",
      lastKnownStatus: "working",
      freshness: "fresh",
      reason: "report",
      jobId: "codex-ui-test",
      taskTitle: "驗證看板畫面",
      provenance: { sourceId: "codex-ui", agentId: "codex-ui", eventId: "ui-start", type: "task.started", at: 10, evidenceType: EVIDENCE_TYPE },
    });
    const view = projectSelfReport({ ...realPayload(reportedRows), roster: "codex" }, "codex");
    expect(view?.partition).toBe("real");
    expect(view?.banner).toBe("Codex 子代理・本機自行回報");
    expect(view?.seats.map((seat) => seat.agent.name)).toEqual(["Codex 協調", "Codex 接收器", "Codex 看板", "Codex 驗證"]);
    expect(view?.seats[2]?.taskTitle).toBe("驗證看板畫面");
    expect(view?.seats[2]?.provenanceText).toBe("bot-self-report／codex-ui／ui-start／task.started");
    expect(view?.counts.working).toBe(1);
  });

  it("keeps the Codex and legacy rosters distinct", () => {
    const legacyRows = TRUSTED.map((person) => row({ agentId: person.id, sourceId: person.id }));
    expect(projectSelfReport(realPayload(rows), "codex")).toBeNull();
    expect(projectSelfReport({ ...realPayload(legacyRows), roster: "codex" }, "codex")).toBeNull();
    expect(projectSelfReport({ ...realPayload(legacyRows), roster: "codex" }, "real")).toBeNull();
    expect(projectSelfReport({ ...realPayload(rows), roster: "codex" }, "real")).toBeNull();
  });

  it("shows the Codex roster as unknown before reports arrive", () => {
    const view = localFallback("codex");
    expect(view.seats.map((seat) => seat.agent.id)).toEqual(["codex-lead", "codex-api", "codex-ui", "codex-qa"]);
    expect(view.seats.every((seat) => seat.agent.deskPresence === "unseated" && seat.effectiveLabel === "尚未入座")).toBe(true);
    expect(view.counts.unknown).toBe(4);
    expect(view.counts.idle).toBe(0);
  });

  it("keeps a completed outcome when the Codex report expires", () => {
    const completed = { ...rows[0]!, lastKnownStatus: "completed", jobId: "reported-job", terminalAt: 1_000 };
    const reportedRows = [
      { ...completed, freshness: "stale" as const, reason: "ttl" },
      { ...completed, ...{ agentId: "codex-api", sourceId: "codex-api" }, effectiveStatus: "completed", freshness: "fresh" as const, reason: "report" },
      ...rows.slice(2),
    ];
    const view = projectSelfReport({ ...realPayload(reportedRows), roster: "codex" }, "codex");
    expect(view?.seats[0]).toMatchObject({
      agent: { status: "unknown", deskPresence: "away" }, effectiveLabel: "離席", lastKnownLabel: "已完成", outcomeLabel: "已完成",
    });
    expect(view?.seats[1]).toMatchObject({ agent: { status: "completed" }, effectiveLabel: "已完成" });
    expect(view?.seats[1]?.agent.deskPresence).toBeUndefined();
    expect(view?.counts.completed).toBe(1);
  });
});
