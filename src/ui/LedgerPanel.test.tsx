import "@testing-library/jest-dom/vitest"
import { fireEvent, render, screen } from "@testing-library/react"
import { useState } from "react"
import { describe, expect, it } from "vitest"
import type { DeskAgent } from "../office/summaryOrder"
import { OfficeFloor } from "./OfficeFloor"

function desk(partial: Partial<DeskAgent> & Pick<DeskAgent, "agentId" | "effectiveStatus" | "seat">): DeskAgent {
  return {
    name: partial.agentId,
    lastKnownStatus: partial.effectiveStatus,
    freshness: "fresh",
    taskTitle: "做事",
    terminalAt: null,
    lastReportAt: 1_000,
    reason: "report",
    ...partial,
  }
}

describe("ledger panel", () => {
  it("selects the seat and opens the detail card from an attention row", () => {
    const agents = [
      desk({ agentId: "old", name: "老受阻", effectiveStatus: "blocked", seat: 0, lastReportAt: 100, taskTitle: "等權限" }),
      desk({ agentId: "young", name: "新受阻", effectiveStatus: "blocked", seat: 1, lastReportAt: 900 }),
      desk({ agentId: "fail", name: "失敗bot", effectiveStatus: "failed", seat: 2, lastReportAt: 50 }),
    ]
    function Harness() {
      const [selectedId, setSelectedId] = useState("")
      return <OfficeFloor agents={agents} now={10_000} selectedId={selectedId} onSelect={setSelectedId} />
    }
    render(<Harness />)
    const names = screen.getAllByRole("button").flatMap((button) => button.querySelector("b")?.textContent ?? [])
    expect(names.slice(0, 3)).toEqual(["老受阻", "新受阻", "失敗bot"])
    const row = screen.getAllByRole("button").find((button) => button.querySelector("b")?.textContent === "老受阻")
    fireEvent.click(row!)
    expect(screen.getByTestId("detail-card")).toHaveTextContent("等權限")
    expect(screen.getByTestId("agent-old")).toHaveClass("is-selected")
  })

  it("sums eight count cells and shows the empty attention card", () => {
    render(<OfficeFloor agents={[desk({ agentId: "only", effectiveStatus: "working", seat: 0 })]} now={10_000} />)
    const counts = Object.fromEntries(
      [...document.querySelectorAll(".count-cell")].map((node) => [node.getAttribute("data-count"), node.querySelector("strong")?.textContent]),
    )
    const sum = Object.values(counts).reduce<number>((total, value) => total + Number(value), 0)
    expect(sum).toBe(1)
    expect(screen.getByTestId("summary-total")).toHaveTextContent("共 1 人，分格加總 1")
    expect(screen.getByText("沒有受阻、失敗或等待中的工作")).toBeTruthy()
    expect(screen.getByText("目前沒有受阻、失敗或等待")).toBeTruthy()
  })

  it("shows demo waits in minutes and seeds recent transitions", () => {
    const now = Date.now()
    render(<OfficeFloor demo now={now} agents={[
      desk({ agentId: "block", name: "設計", effectiveStatus: "blocked", seat: 2, lastReportAt: now - 18 * 60_000, taskTitle: "等色票" }),
      desk({ agentId: "fail", name: "測試助手", effectiveStatus: "failed", seat: 3, lastReportAt: now - 12 * 60_000 }),
    ]} />)
    expect(screen.getByText("18分前")).toBeTruthy()
    expect(screen.getByText("12分前")).toBeTruthy()
    expect(screen.queryByText(/天前/)).toBeNull()
    expect(screen.queryByText("還沒有狀態轉換")).toBeNull()
    expect(screen.getByText(/設計 → 受阻/)).toBeTruthy()
    expect(screen.getByText(/測試助手 → 失敗/)).toBeTruthy()
  })

  it("shows the disconnected conclusion without treating the column as a live feed", () => {
    render(<OfficeFloor agents={[desk({ agentId: "bot", name: "阿法", effectiveStatus: "working", seat: 0, lastReportAt: 1_700_000_000_000 })]} now={1_700_000_060_000} disconnected />)
    expect(screen.getByTestId("summary-panel")).toHaveClass("is-disconnected")
    expect(screen.getByText(/連線中斷，以下是/)).toBeTruthy()
    expect(document.querySelector(".ledger-foot")).toHaveClass("is-down")
  })
})
