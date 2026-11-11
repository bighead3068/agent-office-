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

const REAL_REPORTS = {
  real: { banner: REAL_BANNER, roster: TRUSTED, role: "非平台原生" },
  codex: {
    banner: "Codex 子代理・本機自行回報",
    roster: [
      { id: "codex-lead", name: "Codex 協調" },
      { id: "codex-api", name: "Codex 接收器" },
      { id: "codex-ui", name: "Codex 看板" },
      { id: "codex-qa", name: "Codex 驗證" },
    ],
    role: "Codex 子代理",
  },
} as const;

export type ReportView = keyof typeof REAL_REPORTS | "fixture";

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
  roster?: "codex";
  evidenceType?: string;
  ttlMs?: number;
  serverNow?: number;
  agents?: AgentReport[];
  recent?: RecentReport[];
};

type RecentReport = {
  eventId: string;
  type: string;
  agentId: string;
  jobId: string;
  taskTitle: string | null;
  at: number;
  acceptedAt: number;
};

const TASK_EVENT_TYPES = ["task.started", "task.progress", "task.completed", "task.failed"] as const;
type TaskEventType = (typeof TASK_EVENT_TYPES)[number];

type TaskEvent = {
  eventId: string;
  type: TaskEventType;
  taskTitle: string | null;
  at: number;
  acceptedAt: number | null;
};

export type TaskHistory = {
  jobId: string;
  title: string;
  events: TaskEvent[];
  durationMs: number | null;
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
  outcomeLabel: string | null;
  reportFreshness: AgentReport["freshness"];
  taskTitle: string;
  jobId: string | null;
  jobs: TaskHistory[];
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

function isTaskEvent(type: string): type is TaskEventType {
  return TASK_EVENT_TYPES.some((event) => event === type);
}

function validTime(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(new Date(value).getTime());
}

function jobHistory(row: AgentReport, recent: RecentReport[]): TaskHistory[] {
  const groups = new Map<string, TaskEvent[]>();
  const seen = new Set<string>();
  for (const event of recent) {
    if (!event || event.agentId !== row.agentId || !isTaskEvent(event.type) || !validTime(event.at) ||
        typeof event.eventId !== "string" || typeof event.jobId !== "string" || seen.has(event.eventId)) continue;
    const events = groups.get(event.jobId) ?? [];
    seen.add(event.eventId);
    events.push({
      eventId: event.eventId,
      type: event.type,
      taskTitle: typeof event.taskTitle === "string" ? event.taskTitle : null,
      at: event.at,
      acceptedAt: validTime(event.acceptedAt) ? event.acceptedAt : null,
    });
    groups.set(event.jobId, events);
  }

  if (row.jobId) {
    const events = groups.get(row.jobId) ?? [];
    function addSnapshotEvent(type: TaskEventType, at: number | null) {
      if (!validTime(at) || events.some((event) => event.type === type && event.at === at)) return;
      const lastEvent = row.provenance?.type === type && row.provenance.at === at ? row.provenance : null;
      events.push({
        eventId: lastEvent?.eventId ?? `snapshot-${type}`,
        type,
        taskTitle: null,
        at,
        acceptedAt: lastEvent && validTime(row.lastReportAt) ? row.lastReportAt : null,
      });
    }
    addSnapshotEvent("task.started", row.startedAt);
    if (row.provenance?.type === "task.progress") addSnapshotEvent("task.progress", row.provenance.at);
    if (row.lastKnownStatus === "completed") addSnapshotEvent("task.completed", row.terminalAt);
    if (row.lastKnownStatus === "failed") addSnapshotEvent("task.failed", row.terminalAt);
    if (events.length > 0) groups.set(row.jobId, events);
  }

  return Array.from(groups, ([jobId, events]) => {
    events.sort((left, right) => left.at - right.at);
    const latestTitle = events.reduce<string | null>((title, event) => event.taskTitle || title, null);
    const title = (jobId === row.jobId ? row.taskTitle : null) ?? latestTitle;
    const started = events.find((event) => event.type === "task.started");
    const terminal = events.find((event) => event.type === "task.completed" || event.type === "task.failed");
    const durationMs = started && terminal && terminal.at >= started.at ? terminal.at - started.at : null;
    return { jobId, title: title ?? jobId, events, durationMs };
  }).sort((left, right) => right.events[right.events.length - 1].at - left.events[left.events.length - 1].at);
}

function seatFromReport(row: AgentReport, name: string, role: string, view: ReportView, recent: RecentReport[] = []): SeatModel | null {
  const effective = asStatus(row.effectiveStatus);
  if (!effective) return null;
  const lastKnown = row.lastKnownStatus == null ? null : asStatus(row.lastKnownStatus);
  if (row.lastKnownStatus != null && !lastKnown) return null;
  let deskPresence: OfficeAgent["deskPresence"];
  if (view === "codex") {
    if (row.freshness === "stale") deskPresence = "away";
    if (row.freshness === "none") deskPresence = "unseated";
  }
  const agent: OfficeAgent = {
    id: row.agentId,
    name,
    role,
    status: effective,
    freshness: row.freshness === "stale" ? "stale" : "fresh",
    connected: true,
    ...(deskPresence ? { deskPresence } : {}),
    ...(validTime(row.lastReportAt) ? { lastUpdatedAt: new Date(row.lastReportAt).toISOString() } : {}),
    ...(row.taskTitle ? { task: { title: row.taskTitle, source: row.evidenceType === "fixture" ? "fixture" : EVIDENCE_TYPE } } : {}),
  };
  return {
    agent,
    effectiveLabel: deskPresence === "away" ? "離席" : deskPresence === "unseated" ? "尚未入座" : zh(effective),
    lastKnownLabel: lastKnown ? zh(lastKnown) : "沒有",
    outcomeLabel: lastKnown === "completed" || lastKnown === "failed" ? zh(lastKnown) : null,
    reportFreshness: row.freshness,
    taskTitle: row.taskTitle ?? "尚未收到回報",
    jobId: row.jobId,
    jobs: jobHistory(row, recent),
    reason: row.reason,
    provenanceText: row.provenance
      ? `${row.provenance.evidenceType ?? EVIDENCE_TYPE}／${row.provenance.sourceId}／${row.provenance.eventId}／${row.provenance.type}`
      : "還沒有回報事件",
    reportedAt: validTime(row.lastReportAt) ? row.lastReportAt : null,
    evidenceType: row.evidenceType === "fixture" ? "fixture" : EVIDENCE_TYPE,
  };
}

function summarize(seats: SeatModel[], view: ReportView, ttlMs: number | null): RealViewModel {
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
    partition: view === "fixture" ? "fixture" : "real",
    banner: view === "fixture" ? FIXTURE_BANNER : REAL_REPORTS[view].banner,
    evidenceType: view === "fixture" ? "fixture" : EVIDENCE_TYPE,
    ttlMs,
    seats,
    counts,
    stale,
    disconnected: 0,
    egg: "不會出現",
  };
}

export function localFallback(view: ReportView): RealViewModel {
  if (view === "fixture") {
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
      view,
    );
    return summarize(seat ? [seat] : [], "fixture", null);
  }
  const { roster, role } = REAL_REPORTS[view];
  const seats = roster.map((person) =>
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
      role,
      view,
    ),
  ).filter((seat): seat is SeatModel => seat !== null);
  return summarize(seats, view, null);
}

/**
 * Map a same-origin snapshot into seats.
 * Idle is rejected. Registry names win over any caller-supplied name.
 * Both the partition and roster must match the requested view.
 */
export function projectSelfReport(payload: SelfReportPayload, expected: ReportView): RealViewModel | null {
  const partition = expected === "fixture" ? "fixture" : "real";
  if (payload.partition !== partition || payload.roster !== (expected === "codex" ? "codex" : undefined)) return null;
  const rows = payload.agents ?? [];
  const recent = Array.isArray(payload.recent) ? payload.recent : [];
  if (expected !== "fixture") {
    const { roster, role } = REAL_REPORTS[expected];
    if (rows.length !== roster.length) return null;
    const seats: SeatModel[] = [];
    for (let index = 0; index < roster.length; index += 1) {
      const trusted = roster[index];
      const row = rows[index];
      if (!trusted || !row || row.agentId !== trusted.id || row.sourceId !== trusted.id) return null;
      const seat = seatFromReport(row, trusted.name, role, expected, recent);
      if (!seat) return null;
      seats.push(seat);
    }
    return summarize(seats, expected, payload.ttlMs ?? null);
  }
  if (rows.length !== 1 || rows[0]?.agentId !== "fixture-agent") return null;
  const seat = seatFromReport(rows[0], "夾具代理人", "不是父層 Bot", expected, recent);
  if (!seat) return null;
  return summarize([seat], "fixture", payload.ttlMs ?? null);
}

export function requestedReportView(search: string): ReportView {
  const query = new URLSearchParams(search);
  if (query.get("partition") === "fixture") return "fixture";
  return query.get("view") === "codex" ? "codex" : "real";
}
