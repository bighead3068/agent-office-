import type { DeskAgent } from "../office/summaryOrder"

/** Local bot self-reports. Not a platform connection and not the demo floor. */
export const REAL_BANNER = "本機回報・只在這台電腦"
export const EVIDENCE_TYPE = "bot-self-report"
export const SELF_REPORT_URL = "/api/state"
export const OFFICE_PORT = 8795

export const DEMO_AGENT_IDS = ["lin", "chen", "gao", "fang"] as const
export const DEMO_AGENT_NAMES = ["林知夏", "陳墨白", "高小滿", "方寧遠"] as const

const DEMO_IDS = new Set<string>(DEMO_AGENT_IDS)
const DEMO_NAMES = new Set<string>(DEMO_AGENT_NAMES)
const KNOWN = new Set(["working", "waiting", "blocked", "failed", "completed", "idle", "unknown", "offline"])

export type OfficeSnapshot = {
  agents: DeskAgent[]
  ttlMs: number | null
  serverNow: number | null
}

function asStatus(value: unknown): string {
  return typeof value === "string" && KNOWN.has(value) ? value : "unknown"
}

function isDemoRow(row: Record<string, unknown>): boolean {
  const id = typeof row.agentId === "string" ? row.agentId : ""
  const name = typeof row.name === "string" ? row.name : ""
  const source = typeof row.sourceId === "string" ? row.sourceId : ""
  return DEMO_IDS.has(id) || DEMO_NAMES.has(name) || source === "demo" || source === "demo-sim" || row.partition === "demo" || row.mode === "demo"
}

/**
 * Map a same-origin real snapshot into desks.
 * Demo rows are dropped. An unrecognized status becomes unknown, never idle.
 */
export function projectOfficeState(payload: unknown): OfficeSnapshot | null {
  if (!payload || typeof payload !== "object") return null
  const body = payload as Record<string, unknown>
  if (body.partition !== "real" || body.mode === "demo" || body.source === "demo") return null
  if (!Array.isArray(body.agents)) return null
  const agents: DeskAgent[] = []
  for (const item of body.agents) {
    if (!item || typeof item !== "object") return null
    const row = item as Record<string, unknown>
    if (typeof row.agentId !== "string" || typeof row.name !== "string") return null
    if (isDemoRow(row)) continue
    agents.push({
      agentId: row.agentId,
      name: row.name,
      seat: typeof row.seat === "number" && Number.isInteger(row.seat) && row.seat >= 0 ? row.seat : agents.length,
      effectiveStatus: asStatus(row.effectiveStatus),
      lastKnownStatus: row.lastKnownStatus == null ? null : asStatus(row.lastKnownStatus),
      freshness: row.freshness === "stale" || row.freshness === "none" ? row.freshness : "fresh",
      taskTitle: typeof row.taskTitle === "string" ? row.taskTitle : "",
      terminalAt: typeof row.terminalAt === "number" ? row.terminalAt : null,
      lastReportAt: typeof row.lastReportAt === "number" ? row.lastReportAt : null,
      reason: typeof row.reason === "string" ? row.reason : "",
    })
  }
  return {
    agents,
    ttlMs: typeof body.ttlMs === "number" ? body.ttlMs : null,
    serverNow: typeof body.serverNow === "number" ? body.serverNow : null,
  }
}
