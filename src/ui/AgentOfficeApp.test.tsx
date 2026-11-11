import "@testing-library/jest-dom/vitest"
import { act, fireEvent, render, screen, within } from "@testing-library/react"
import { readFileSync } from "node:fs"
import { afterEach, describe, expect, it, vi } from "vitest"
import { AgentOfficeApp } from "./AgentOfficeApp"
import { DEMO_AGENT_NAMES } from "../adapters/selfReport"

const DEMO_NAMES = [...DEMO_AGENT_NAMES]

function row(partial: Record<string, unknown>) {
  return {
    name: "阿法",
    seat: 0,
    effectiveStatus: "unknown",
    lastKnownStatus: null,
    freshness: "none",
    reason: "missing_report",
    taskTitle: null,
    terminalAt: null,
    lastReportAt: null,
    ...partial,
  }
}

function payload(agents: Record<string, unknown>[]) {
  return { partition: "real", evidenceType: "bot-self-report", ttlMs: 300_000, serverNow: 4_000, agents }
}

describe("v0.2 office", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
    window.history.replaceState(null, "", "/")
  })

  it("shows real seats by default and hides demo names", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(payload([
      row({ agentId: "bot-a", name: "阿法", seat: 1, effectiveStatus: "working", freshness: "fresh", taskTitle: "整理文件", reason: "report" }),
    ]))))
    render(<AgentOfficeApp />)
    expect(screen.getByTestId("mode-banner").textContent).toContain("真實")
    expect(screen.queryByTestId("demo-badge")).toBeNull()
    const floor = await screen.findByTestId("agent-bot-a")
    expect(floor).toHaveTextContent("整理文件")
    expect(floor).toHaveTextContent("工作中")
    for (const name of DEMO_NAMES) expect(document.body.textContent ?? "").not.toContain(name)
    expect(document.body.textContent ?? "").not.toContain("source=demo")
    expect(document.querySelector("[data-view='real']")).toBeTruthy()
  })

  it("keeps demo behind the flag and clears it when the view changes", async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json(payload([])))
    vi.stubGlobal("fetch", fetch)
    window.history.replaceState(null, "", "/?view=demo")
    const view = render(<AgentOfficeApp />)
    expect(screen.getByTestId("demo-badge")).toHaveTextContent("模擬")
    expect(screen.getByTestId("mode-banner").textContent).toContain("模擬")
    expect(document.body.textContent ?? "").toContain("林知夏")
    expect(fetch).not.toHaveBeenCalled()
    expect(document.querySelector("[data-view='demo']")).toBeTruthy()

    window.history.replaceState(null, "", "/")
    window.dispatchEvent(new PopStateEvent("popstate"))
    view.rerender(<AgentOfficeApp />)
    expect(screen.queryByTestId("demo-badge")).toBeNull()
    for (const name of DEMO_NAMES) expect(document.body.textContent ?? "").not.toContain(name)
    expect(await screen.findByTestId("mode-banner")).toHaveTextContent("真實")
  })

  it("sorts the summary and shows completed time without turning failed into blocked", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(payload([
      row({ agentId: "done", name: "完工", seat: 0, effectiveStatus: "completed", lastKnownStatus: "completed", freshness: "fresh", taskTitle: "交卷", terminalAt: 1_700_000_000_000, reason: "report" }),
      row({ agentId: "work", name: "在做", seat: 1, effectiveStatus: "working", freshness: "fresh", taskTitle: "寫程式", reason: "report" }),
      row({ agentId: "block", name: "卡住", seat: 2, effectiveStatus: "blocked", freshness: "fresh", taskTitle: "等權限", reason: "report" }),
      row({ agentId: "fail", name: "失敗bot", seat: 3, effectiveStatus: "failed", lastKnownStatus: "failed", freshness: "fresh", taskTitle: "測試紅了", reason: "report" }),
      row({ agentId: "miss", name: "沒回報", seat: 4, effectiveStatus: "unknown", freshness: "none", taskTitle: null }),
      row({ agentId: "lin", name: "林知夏", seat: 9, effectiveStatus: "working", freshness: "fresh", taskTitle: "不該出現" }),
    ]))))
    render(<AgentOfficeApp />)
    await screen.findByTestId("agent-block")
    expect(document.body.textContent ?? "").not.toContain("林知夏")
    expect(document.body.textContent ?? "").not.toContain("不該出現")
    const summary = screen.getByTestId("summary-panel")
    const names = within(summary).getAllByRole("button").flatMap((button) => button.querySelector("b")?.textContent ?? [])
    expect(names).toEqual(["卡住", "失敗bot"])
    expect(names).not.toContain("在做")
    expect(within(summary).getAllByText("受阻").length).toBeGreaterThan(0)
    expect(within(summary).getAllByText("失敗").length).toBeGreaterThan(0)
    const failed = screen.getByTestId("agent-fail")
    expect(failed).toHaveAttribute("data-status", "failed")
    expect(failed).toHaveTextContent("失敗")
    expect(failed).not.toHaveTextContent("受阻")
    const done = screen.getByTestId("agent-done")
    expect(done).toHaveTextContent("完成")
    expect(done).not.toHaveTextContent("明確閒置")
    fireEvent.click(done.querySelector("button")!)
    expect(screen.getByTestId("detail-card")).toHaveTextContent("台北")
    expect(screen.getByTestId("detail-card")).toHaveTextContent("交卷")
    const missing = screen.getByTestId("agent-miss")
    expect(missing).toHaveAttribute("data-status", "unknown")
    expect(missing).toHaveTextContent("尚未回報")
    expect(missing).not.toHaveTextContent("明確閒置")
    const counts = Object.fromEntries(
      [...document.querySelectorAll(".count-cell")].map((node) => [node.getAttribute("data-count"), node.querySelector("strong")?.textContent]),
    )
    expect(counts.blocked).toBe("1")
    expect(counts.failed).toBe("1")
    expect(counts.working).toBe("1")
    expect(counts.waiting).toBe("0")
    expect(counts.completed).toBe("1")
    expect(counts.unknown).toBe("1")
    expect(counts.idle).toBe("0")
    expect(counts.offline).toBe("0")
    expect(screen.getByTestId("summary-total").textContent).toContain("共 5 人，分格加總 5")
  })

  it("keeps the last real snapshot when the receiver drops", async () => {
    vi.useFakeTimers()
    const fetch = vi.fn()
      .mockResolvedValueOnce(Response.json(payload([
        row({ agentId: "bot-a", name: "阿法", effectiveStatus: "working", freshness: "fresh", taskTitle: "還在做", reason: "report" }),
      ])))
      .mockRejectedValue(new Error("down"))
    vi.stubGlobal("fetch", fetch)
    render(<AgentOfficeApp />)
    await act(async () => {})
    expect(screen.getByTestId("agent-bot-a")).toHaveTextContent("還在做")
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000) })
    expect(screen.getByTestId("live-note")).toHaveTextContent("連線中斷")
    expect(screen.getByTestId("live-note")).toHaveTextContent("上次已知")
    const seat = screen.getByTestId("agent-bot-a")
    expect(seat).toHaveAttribute("data-status", "unknown")
    expect(seat).toHaveTextContent("還在做")
    expect(seat).toHaveTextContent("上次：工作中")
  })

  it("keeps the summary readable without an inner scroller", () => {
    const css = readFileSync("src/ui/OfficeFloor.css", "utf8")
    expect(css).toMatch(/\.summary-dock\s*\{[^}]*overflow:\s*visible/)
    expect(css).toMatch(/\.bubble\s*\{[^}]*font-size:\s*16px/)
    expect(css).toMatch(/\.task-pill\s*\{[^}]*font-size:\s*14px/)
    expect(css).not.toMatch(/\.summary-dock\s*\{[^}]*overflow:\s*auto/)
    expect(css).not.toMatch(/\.attention-list\s*\{[^}]*overflow:\s*auto/)
  })
})
