import type { OfficeAgent } from "../office/types";

/** Local bot self-reports. Not a platform connection and not the demo floor. */
export const REAL_BANNER = "Bot自行回報・非平台原生";
export const FIXTURE_BANNER = "夾具資料・不是父層 Bot";
export const EVIDENCE_TYPE = "bot-self-report";
export const SELF_REPORT_URL = "/api/self-report";
export const FIXTURE_REPORT_URL = "/api/fixture-report";

export const TRUSTED = [
  { id: "5be5c071-b5bd-4ed5-ba91-5c474954d171", name: "專案／產品助手（協調）" },
  { id: "7a961a88-8d6c-4afe-ada6-e28542084d0c", name: "Agent Office 開發助手" },
  { id: "892250dc-215a-4817-b9ae-64e538a22fe3", name: "Agent Office 互動設計" },
  { id: "cf8d7f4a-569c-48f8-86e0-a2d8b543c4e1", name: "Agent Office 測試與授權" },
] as const;

const REPORT_STATUSES = ["working", "completed", "failed", "unknown"] as const;
type ReportStatus = (typeof REPORT_STATUSES)[number];

export type AgentReport = {
  agentId: string;
  sourceId: string;
  name?: string;
  evidenceType?: string;
  effectiveStatus: string;
  lastKnownStatus: string | null;
  freshness: "fresh" | "stale" | "none";
  reason: string;
  jobId: string | null;
  taskTitle: string | null;
  startedAt: number | null;
  terminalAt: number | null;
  lastReportAt: number | null;
  provenance: {
    sourceId: string;
    agentId: string;
    eventId: string;
    type: string;
    at: number;
    evidenceType?: string;
  } | null;
  callerLabel: string | null;
};

export type SelfReportPayload = {
  partition: "real" | "fixture";
  evidenceType?: string;
  ttlMs?: number;
  serverNow?: number;
  agents?: AgentReport[];
};

export type RealCounts = {
  working: number;
  waiting: number;
  blocked: number;
  failed: number;
  completed: number;
  idle: number;
  unknown: number;
};

export type SeatModel = {
  agent: OfficeAgent;
  effectiveLabel: string;
  lastKnownLabel: string;
  taskTitle: string;
  jobId: string | null;
  reason: string;
  provenanceText: string;
  reportedAt: number | null;
  evidenceType: string;
};

export type RealViewModel = {
  partition: "real" | "fixture";
  banner: string;
  evidenceType: string;
  ttlMs: number | null;
  seats: SeatModel[];
  counts: RealCounts;
  stale: number;
  disconnected: number;
  egg: "不會出現";
};

function asStatus(value: string | null): ReportStatus | null {
  if (value === "working" || value === "completed" || value === "failed" || value === "unknown") return value;
  return null;
}

function zh(status: ReportStatus): string {
  if (status === "working") return "工作中";
  if (status === "completed") return "已完成";
  if (status === "failed") return "失敗";
  return "未知";
}

function emptyCounts(): RealCounts {
  return { working: 0, waiting: 0, blocked: 0, failed: 0, completed: 0, idle: 0, unknown: 0 };
}

function seatFromReport(row: AgentReport, name: string, role: string): SeatModel | null {
  const effective = asStatus(row.effectiveStatus);
  if (!effective) return null;
  const lastKnown = row.lastKnownStatus == null ? null : asStatus(row.lastKnownStatus);
  if (row.lastKnownStatus != null && !lastKnown) return null;
  const agent: OfficeAgent = {
    id: row.agentId,
    name,
    role,
    status: effective,
    freshness: row.freshness === "stale" ? "stale" : "fresh",
    connected: true,
    ...(row.lastReportAt != null ? { lastUpdatedAt: new Date(row.lastReportAt).toISOString() } : {}),
    ...(row.taskTitle ? { task: { title: row.taskTitle, source: row.evidenceType === "fixture" ? "fixture" : EVIDENCE_TYPE } } : {}),
  };
  return {
    agent,
    effectiveLabel: zh(effective),
    lastKnownLabel: lastKnown ? zh(lastKnown) : "沒有",
    taskTitle: row.taskTitle ?? "尚未收到回報",
    jobId: row.jobId,
    reason: row.reason,
    provenanceText: row.provenance
      ? `${row.provenance.evidenceType ?? EVIDENCE_TYPE}／${row.provenance.sourceId}／${row.provenance.eventId}／${row.provenance.type}`
      : "還沒有回報事件",
    reportedAt: row.lastReportAt,
    evidenceType: row.evidenceType === "fixture" ? "fixture" : EVIDENCE_TYPE,
  };
}

function summarize(seats: SeatModel[], partition: "real" | "fixture", ttlMs: number | null): RealViewModel {
  const counts = emptyCounts();
  let stale = 0;
  for (const seat of seats) {
    if (seat.agent.status === "working") counts.working += 1;
    else if (seat.agent.status === "failed") counts.failed += 1;
    else if (seat.agent.status === "completed") counts.completed += 1;
    else counts.unknown += 1;
    if (seat.agent.freshness === "stale" || seat.reason === "ttl") stale += 1;
  }
  return {
    partition,
    banner: partition === "fixture" ? FIXTURE_BANNER : REAL_BANNER,
    evidenceType: partition === "fixture" ? "fixture" : EVIDENCE_TYPE,
    ttlMs,
    seats,
    counts,
    stale,
    disconnected: 0,
    egg: "不會出現",
  };
}

export function localFallback(partition: "real" | "fixture"): RealViewModel {
  if (partition === "fixture") {
    const seat = seatFromReport(
      {
        agentId: "fixture-agent",
        sourceId: "fixture-local",
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
        evidenceType: "fixture",
      },
      "夾具代理人",
      "不是父層 Bot",
    );
    return summarize(seat ? [seat] : [], "fixture", null);
  }
  const seats = TRUSTED.map((person) =>
    seatFromReport(
      {
        agentId: person.id,
        sourceId: person.id,
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
      },
      person.name,
      "非平台原生",
    ),
  ).filter((seat): seat is SeatModel => seat !== null);
  return summarize(seats, "real", null);
}

/**
 * Map a same-origin snapshot into seats.
 * Idle is rejected. Registry names win over any caller-supplied name.
 * A fixture payload cannot be shown as the real partition.
 */
export function projectSelfReport(payload: SelfReportPayload, expected: "real" | "fixture"): RealViewModel | null {
  if (payload.partition !== expected) return null;
  const rows = payload.agents ?? [];
  if (expected === "real") {
    if (rows.length !== TRUSTED.length) return null;
    const seats: SeatModel[] = [];
    for (let index = 0; index < TRUSTED.length; index += 1) {
      const trusted = TRUSTED[index];
      const row = rows[index];
      if (!trusted || !row || row.agentId !== trusted.id || row.sourceId !== trusted.id) return null;
      const seat = seatFromReport(row, trusted.name, "非平台原生");
      if (!seat) return null;
      seats.push(seat);
    }
    return summarize(seats, "real", payload.ttlMs ?? null);
  }
  if (rows.length !== 1 || rows[0]?.agentId !== "fixture-agent") return null;
  const seat = seatFromReport(rows[0], "夾具代理人", "不是父層 Bot");
  if (!seat) return null;
  return summarize([seat], "fixture", payload.ttlMs ?? null);
}

export function requestedPartition(search: string): "real" | "fixture" {
  return new URLSearchParams(search).get("partition") === "fixture" ? "fixture" : "real";
}
