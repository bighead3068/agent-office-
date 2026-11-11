import { describe, expect, it } from "vitest"
import { countDesks, shortName, sortDesks, type DeskAgent } from "./summaryOrder"

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
    ]
    expect(sortDesks(agents).map((agent) => agent.agentId)).toEqual(["a", "b", "c"])
    const counts = countDesks(agents)
    const total = Object.values(counts).reduce((sum, value) => sum + value, 0)
    expect(total).toBe(agents.length)
    expect(counts.working).toBe(2)
    expect(counts.unknown).toBe(1)
    expect(counts.idle).toBe(0)
    expect(counts.failed).toBe(0)
  })

  it("shortens name plates without dropping the full name contract", () => {
    expect(shortName("阿法")).toBe("阿法")
    expect(shortName("一二三四五六七八九")).toBe("一二三四五六七…")
  })
})
