/**
 * Stable v0.2 summary order.
 *
 * Count cells, left to right: 卡住, 進行中, 等待, 完成, 未知.
 * 卡住 is blocked + failed. The bubble still says 受阻 or 失敗.
 * 閒置 and 離線 are the next line, not extra people inside 未知.
 * Those seven buckets are a partition: they add up to the bot total.
 * 過期 and 未入座 are markers on bots already counted, so they are not added again.
 *
 * 需要注意 is only blocked -> waiting: 受阻, 失敗, 進行中, 等待.
 * Inside one status, the lower seat wins, then the agent id.
 */
export const SUMMARY_ORDER = [
  "blocked",
  "failed",
  "working",
  "waiting",
  "completed",
  "unknown",
  "offline",
  "idle",
] as const

export const COUNT_CELLS = [
  { id: "stuck", label: "卡住", statuses: ["blocked", "failed"] },
  { id: "working", label: "進行中", statuses: ["working"] },
  { id: "waiting", label: "等待", statuses: ["waiting"] },
  { id: "completed", label: "完成", statuses: ["completed"] },
  { id: "unknown", label: "未知", statuses: ["unknown"] },
] as const

export const ATTENTION_ORDER = ["blocked", "failed", "working", "waiting"] as const

export type SummaryStatus = (typeof SUMMARY_ORDER)[number]

export const STATUS_LABEL: Record<string, string> = {
  working: "工作中",
  waiting: "等待中",
  blocked: "受阻",
  failed: "失敗",
  completed: "已完成",
  unknown: "未知",
  offline: "斷線",
  idle: "明確閒置",
}

export interface DeskAgent {
  agentId: string
  name: string
  seat: number
  effectiveStatus: string
  lastKnownStatus: string | null
  freshness: "fresh" | "stale" | "none"
  taskTitle: string
  terminalAt: number | null
  lastReportAt: number | null
  reason: string
  disconnected?: boolean
}

export function summaryRank(status: string): number {
  const index = SUMMARY_ORDER.indexOf(status as SummaryStatus)
  return index === -1 ? SUMMARY_ORDER.indexOf("unknown") : index
}

export function sortDesks<T extends Pick<DeskAgent, "effectiveStatus" | "seat" | "agentId">>(agents: readonly T[]): T[] {
  return [...agents].sort(
    (left, right) =>
      summaryRank(left.effectiveStatus) - summaryRank(right.effectiveStatus) ||
      left.seat - right.seat ||
      left.agentId.localeCompare(right.agentId),
  )
}

export function countDesks(agents: readonly Pick<DeskAgent, "effectiveStatus">[]): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const status of SUMMARY_ORDER) counts[status] = 0
  for (const agent of agents) {
    const known = SUMMARY_ORDER.includes(agent.effectiveStatus as SummaryStatus)
    const status = known ? agent.effectiveStatus : "unknown"
    counts[status] = (counts[status] ?? 0) + 1
  }
  return counts
}

export interface OfficeTally {
  byStatus: Record<string, number>
  cells: Record<(typeof COUNT_CELLS)[number]["id"], number>
  idle: number
  offline: number
  stale: number
  unseated: number
  total: number
}

/** Five count cells plus idle and offline. Stale and unseated are not added again. */
export function tallyDesks(agents: readonly Pick<DeskAgent, "effectiveStatus" | "freshness" | "seat">[]): OfficeTally {
  const byStatus = countDesks(agents)
  const cells = {
    stuck: (byStatus.blocked ?? 0) + (byStatus.failed ?? 0),
    working: byStatus.working ?? 0,
    waiting: byStatus.waiting ?? 0,
    completed: byStatus.completed ?? 0,
    unknown: byStatus.unknown ?? 0,
  }
  return {
    byStatus,
    cells,
    idle: byStatus.idle ?? 0,
    offline: byStatus.offline ?? 0,
    stale: agents.filter((agent) => agent.freshness === "stale").length,
    unseated: agents.filter((agent) => agent.seat >= 8).length,
    total: agents.length,
  }
}

export function attentionAgents<T extends Pick<DeskAgent, "effectiveStatus" | "seat" | "agentId">>(agents: readonly T[]): T[] {
  const rank = new Map<string, number>(ATTENTION_ORDER.map((status, index) => [status, index]))
  return agents
    .filter((agent) => rank.has(agent.effectiveStatus))
    .sort(
      (left, right) =>
        (rank.get(left.effectiveStatus) ?? 0) - (rank.get(right.effectiveStatus) ?? 0) ||
        left.seat - right.seat ||
        left.agentId.localeCompare(right.agentId),
    )
}

export function elapsedLabel(at: number | null, now: number): string {
  if (at == null || !Number.isFinite(at) || !Number.isFinite(now)) return ""
  const delta = now - at
  if (delta < 0) return ""
  const minutes = Math.floor(delta / 60_000)
  if (minutes < 1) return "剛剛"
  if (minutes < 60) return `${minutes}分前`
  const hours = Math.floor(minutes / 60)
  if (hours < 48) return `${hours}小時前`
  return `${Math.floor(hours / 24)}天前`
}

export function shortName(name: string, max = 8): string {
  const chars = Array.from(name)
  if (chars.length <= max) return name
  return `${chars.slice(0, max - 1).join("")}…`
}
