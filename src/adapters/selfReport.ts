import type { AgentStatus, OfficeAgent } from "../office/types";

/** Real self-report view. Not a platform connection and not the demo floor. */
export const REAL_BANNER = "Bot自行回報・非平台原生";
export const FIXTURE_BANNER = "夾具資料・不是父層 Bot";
export const REAL_AGENT_ID = "5be5c071-b5bd-4ed5-ba91-5c474954d171";
export const SELF_REPORT_URL = "/api/self-report";
export const FIXTURE_REPORT_URL = "/api/fixture-report";

const REPORT_STATUSES = ["working", "completed", "failed", "unknown"] as const;
type ReportStatus = (typeof REPORT_STATUSES)[number];

export type SelfReportPayload = {
  partition: "real" | "fixture";
  sourceId: string;
  agentId: string;
  ttlMs: number;
  serverNow: number;
  effectiveStatus: string;
  lastKnownStatus: string | null;
  freshness: "fresh" | "stale" | "none";
  reason: string;
  jobId: string | null;
  startedAt: number | null;
  terminalAt: number | null;
  lastReportAt: number | null;
  provenance: {
    sourceId: string;
    agentId: string;
    eventId: string;
    type: string;
    at: number;
  } | null;
  callerLabel: string | null;
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

export type RealViewModel = {
  partition: "real" | "fixture";
  banner: string;
  agent: OfficeAgent;
  counts: RealCounts;
  stale: number;
  disconnected: number;
  reason: string;
  effectiveLabel: string;
  lastKnownLabel: string;
  jobText: string;
  callerLabel: string | null;
  identity: string;
  provenanceText: string;
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

/**
 * Map a same-origin receiver snapshot into the office scene.
 * Idle is never produced. A fixture payload cannot satisfy a real view.
 * The caller label is display-only and is not the agent id.
 */
export function projectSelfReport(payload: SelfReportPayload, expected: "real" | "fixture"): RealViewModel | null {
  if (payload.partition !== expected) return null;
  if (expected === "real" && (payload.agentId !== REAL_AGENT_ID || payload.sourceId !== REAL_AGENT_ID)) return null;
  const effective = asStatus(payload.effectiveStatus);
  if (!effective) return null;
  const lastKnown = payload.lastKnownStatus == null ? null : asStatus(payload.lastKnownStatus);
  if (payload.lastKnownStatus != null && !lastKnown) return null;
  const sceneStatus: AgentStatus = effective;
  const counts: RealCounts = {
    working: effective === "working" ? 1 : 0,
    waiting: 0,
    blocked: 0,
    failed: effective === "failed" ? 1 : 0,
    completed: effective === "completed" ? 1 : 0,
    idle: 0,
    unknown: effective === "unknown" ? 1 : 0,
  };
  const agent: OfficeAgent = {
    id: payload.agentId,
    name: expected === "fixture" ? "夾具代理人" : "自行回報",
    role: expected === "fixture" ? "不是父層 Bot" : "非平台原生",
    status: sceneStatus,
    freshness: payload.freshness === "stale" ? "stale" : "fresh",
    connected: true,
    ...(payload.lastReportAt != null ? { lastUpdatedAt: new Date(payload.lastReportAt).toISOString() } : {}),
    ...(payload.jobId ? { task: { title: `工作 ${payload.jobId}`, source: payload.sourceId } } : {}),
  };
  return {
    partition: expected,
    banner: expected === "fixture" ? FIXTURE_BANNER : REAL_BANNER,
    agent,
    counts,
    stale: payload.freshness === "stale" || payload.reason === "ttl" ? 1 : 0,
    disconnected: 0,
    reason: payload.reason,
    effectiveLabel: zh(effective),
    lastKnownLabel: lastKnown ? zh(lastKnown) : "沒有",
    jobText: payload.jobId ? `工作 ${payload.jobId}` : "尚未收到回報",
    callerLabel: payload.callerLabel,
    identity: payload.agentId,
    provenanceText: payload.provenance
      ? `${payload.provenance.sourceId}／${payload.provenance.eventId}／${payload.provenance.type}`
      : "還沒有回報事件",
    egg: "不會出現",
  };
}

export function requestedPartition(search: string): "real" | "fixture" {
  return new URLSearchParams(search).get("partition") === "fixture" ? "fixture" : "real";
}
