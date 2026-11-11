import { describe, expect, it } from "vitest"
import { attentionAgents, plateName, shortName, sortDesks, tallyDesks, type DeskAgent } from "./summaryOrder"

function desk(partial: Partial<DeskAgent> & Pick<DeskAgent, "agentId" | "effectiveStatus" | "seat">): DeskAgent {
  return {
    name: partial.agentId,
    lastKnownStatus: partial.effectiveStatus,
    freshness: "fresh",
    taskTitle: "",
    terminalAt: null,
    lastReportAt: null,
    reason: "report",
    ...partial,
  }
}

describe("supervisor sort", () => {
  it("orders blocked, failed, working, waiting, completed, unknown, then idle", () => {
    const sorted = sortDesks([
      desk({ agentId: "idle", effectiveStatus: "idle", seat: 0 }),
      desk({ agentId: "done", effectiveStatus: "completed", seat: 1 }),
      desk({ agentId: "work", effectiveStatus: "working", seat: 2 }),
      desk({ agentId: "wait", effectiveStatus: "waiting", seat: 3 }),
      desk({ agentId: "block", effectiveStatus: "blocked", seat: 4 }),
      desk({ agentId: "fail", effectiveStatus: "failed", seat: 5 }),
      desk({ agentId: "miss", effectiveStatus: "unknown", seat: 6 }),
    ])
    expect(sorted.map((agent) => agent.effectiveStatus)).toEqual([
      "blocked",
      "failed",
      "working",
      "waiting",
      "completed",
      "unknown",
      "idle",
    ])
  })

  it("keeps seat order inside one status and counts every bot once", () => {
    const agents = [
      desk({ agentId: "b", effectiveStatus: "working", seat: 2 }),
      desk({ agentId: "a", effectiveStatus: "working", seat: 0 }),
      desk({ agentId: "c", effectiveStatus: "unknown", seat: 1 }),
      desk({ agentId: "d", effectiveStatus: "failed", seat: 3 }),
      desk({ agentId: "w", effectiveStatus: "waiting", seat: 4 }),
      desk({ agentId: "e", effectiveStatus: "idle", seat: 8, freshness: "stale" }),
      desk({ agentId: "f", effectiveStatus: "offline", seat: 9 }),
    ]
    expect(sortDesks(agents).map((agent) => agent.agentId)).toEqual(["d", "a", "b", "w", "c", "f", "e"])
    expect(attentionAgents(agents).map((agent) => agent.agentId)).toEqual(["d", "w"])
    const tally = tallyDesks(agents)
    const shown = tally.cells.stuck + tally.cells.working + tally.cells.waiting + tally.cells.completed + tally.cells.unknown + tally.idle + tally.offline
    expect(shown).toBe(agents.length)
    expect(tally.total).toBe(agents.length)
    expect(tally.cells.stuck).toBe(1)
    expect(tally.cells.working).toBe(2)
    expect(tally.cells.waiting).toBe(1)
    expect(tally.cells.unknown).toBe(1)
    expect(tally.idle).toBe(1)
    expect(tally.offline).toBe(1)
    expect(tally.stale).toBe(1)
    expect(tally.unseated).toBe(2)
  })

  it("shortens name plates without dropping the full name contract", () => {
    expect(shortName("阿法")).toBe("阿法")
    expect(shortName("一二三四五六七八九")).toBe("一二三四五六七…")
    expect(plateName("Agent Office 開發助手")).toBe("開發助手")
    expect(plateName("Agent Office 互動設計")).toBe("互動設計")
  })
})
