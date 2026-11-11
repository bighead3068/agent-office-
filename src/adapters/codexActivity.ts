export const CODEX_ACTIVITY_URL = "/api/codex-activity";
export const CODEX_ACTIVITY_EVIDENCE = "codex-hook";

export type CodexActivityAgent = {
  agentId: string;
  agentType: string;
  turnId: string | null;
  startedAt: number | null;
  stoppedAt: number | null;
  lastEventAt: number;
  outcome?: "completed" | "failed" | null;
  taskTitle?: string | null;
};

type ActivityEvent = {
  eventId: string;
  kind: "started" | "stopped" | "completed" | "failed";
  agentId: string;
  agentType: string;
  turnId: string | null;
  at: number;
  jobId?: string;
  taskTitle?: string | null;
};

type ActivitySession = {
  sessionId: string;
  agents: CodexActivityAgent[];
  recent: ActivityEvent[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isTime(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(new Date(value).getTime());
}

function isOptionalTitle(value: unknown): boolean {
  return value == null || typeof value === "string";
}

function isAgent(value: unknown): value is CodexActivityAgent {
  return isRecord(value) && typeof value.agentId === "string" && typeof value.agentType === "string" &&
    (value.turnId === null || typeof value.turnId === "string") &&
    (value.startedAt === null || isTime(value.startedAt)) &&
    (value.stoppedAt === null || isTime(value.stoppedAt)) && isTime(value.lastEventAt) &&
    (value.outcome == null || value.outcome === "completed" || value.outcome === "failed") &&
    isOptionalTitle(value.taskTitle);
}

function isEvent(value: unknown): value is ActivityEvent {
  return isRecord(value) && typeof value.eventId === "string" &&
    (value.kind === "started" || value.kind === "stopped" || value.kind === "completed" || value.kind === "failed") &&
    typeof value.agentId === "string" && typeof value.agentType === "string" &&
    (value.turnId === null || typeof value.turnId === "string") && isTime(value.at) &&
    (value.jobId === undefined || typeof value.jobId === "string") && isOptionalTitle(value.taskTitle);
}

function isSession(value: unknown): value is ActivitySession {
  return isRecord(value) && typeof value.sessionId === "string" &&
    Array.isArray(value.agents) && value.agents.every(isAgent) &&
    Array.isArray(value.recent) && value.recent.every(isEvent);
}

export function projectCodexActivity(payload: unknown): ActivitySession[] | null {
  if (!isRecord(payload) || payload.evidenceType !== CODEX_ACTIVITY_EVIDENCE ||
      !Array.isArray(payload.sessions) || !payload.sessions.every(isSession)) return null;
  return payload.sessions;
}
