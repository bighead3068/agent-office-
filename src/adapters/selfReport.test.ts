import { describe, expect, it } from "vitest"
import { DEMO_AGENT_NAMES, projectOfficeState } from "./selfReport"

describe("real office snapshot", () => {
  it("drops demo rows and turns an unknown status into unknown", () => {
    const view = projectOfficeState({
      partition: "real",
      agents: [
        { agentId: "lin", name: "林知夏", seat: 0, effectiveStatus: "working", freshness: "fresh" },
        { agentId: "bot-a", name: "阿法", seat: 1, effectiveStatus: "banana", freshness: "fresh", taskTitle: "寫文件" },
        { agentId: "bot-b", name: DEMO_AGENT_NAMES[1], seat: 2, effectiveStatus: "idle", freshness: "fresh" },
      ],
    })
    expect(view?.agents.map((agent) => agent.agentId)).toEqual(["bot-a"])
    expect(view?.agents[0]?.effectiveStatus).toBe("unknown")
    expect(view?.agents[0]?.taskTitle).toBe("寫文件")
  })

  it("rejects a demo partition and keeps failed distinct from blocked", () => {
    expect(projectOfficeState({ partition: "demo", agents: [] })).toBeNull()
    const view = projectOfficeState({
      partition: "real",
      ttlMs: 300000,
      agents: [
        { agentId: "bot-a", name: "阿法", seat: 0, effectiveStatus: "failed", lastKnownStatus: "failed", freshness: "fresh", taskTitle: "失敗的工作" },
        { agentId: "bot-b", name: "貝塔", seat: 1, effectiveStatus: "unknown", lastKnownStatus: "completed", freshness: "stale", taskTitle: "做完了", terminalAt: 3_000 },
      ],
    })
    expect(view?.agents[0]?.effectiveStatus).toBe("failed")
    expect(view?.agents[1]?.effectiveStatus).toBe("unknown")
    expect(view?.agents[1]?.lastKnownStatus).toBe("completed")
    expect(view?.ttlMs).toBe(300000)
  })
})
