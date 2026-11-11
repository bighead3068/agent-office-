/**
 * Supervisor order for v0.2.
 * blocked, then failed (still its own status), working, waiting, completed,
 * unknown, offline, and explicit idle last.
 * Unknown is not idle. A tie keeps the registered seat, then the agent id.
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
    const status = summaryRank(agent.effectiveStatus) === SUMMARY_ORDER.indexOf("unknown") && !SUMMARY_ORDER.includes(agent.effectiveStatus as SummaryStatus)
      ? "unknown"
      : agent.effectiveStatus
    counts[status] = (counts[status] ?? 0) + 1
  }
  return counts
}

export function shortName(name: string, max = 8): string {
  const chars = Array.from(name)
  if (chars.length <= max) return name
  return `${chars.slice(0, max - 1).join("")}…`
}
