import "@testing-library/jest-dom/vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentOfficeApp } from "./AgentOfficeApp";
import { TRUSTED } from "../adapters/selfReport";

const DEMO_NAMES = ["林知夏", "陳墨白", "高小滿", "方寧遠"];
const CODEX_IDS = ["codex-lead", "codex-api", "codex-ui", "codex-qa"];

function completedReport(ids: readonly string[], roster?: "codex") {
  return {
    partition: "real", roster, evidenceType: "bot-self-report", ttlMs: 300_000, serverNow: 400_000,
    agents: ids.map((id, index) => ({
      agentId: id, sourceId: id, evidenceType: "bot-self-report", effectiveStatus: "unknown",
      lastKnownStatus: index === 0 ? "completed" : null, freshness: index === 0 ? "stale" : "none",
      reason: index === 0 ? "ttl" : "missing_report", jobId: index === 0 ? "done" : null,
      taskTitle: index === 0 ? "整理會議記錄" : null, startedAt: index === 0 ? 1_000 : null,
      terminalAt: index === 0 ? 3_000 : null, lastReportAt: index === 0 ? 3_100 : null,
      provenance: index === 0 ? { sourceId: id, agentId: id, eventId: "done-end", type: "task.completed", at: 3_000 } : null,
      callerLabel: null,
    })),
    recent: [{ eventId: "done-end", type: "task.completed", jobId: "done", agentId: ids[0], taskTitle: "整理會議記錄", at: 3_000, acceptedAt: 3_100 }],
  };
}

describe("真實資料畫面", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    window.history.replaceState(null, "", "/");
  });

  it("切到真實模式後，畫面上不再有示範人名、情境或事件回饋", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("no receiver")));
    const user = userEvent.setup();
    render(<AgentOfficeApp />);

    await user.selectOptions(screen.getByTestId("scenario-select"), "link_contrast");
    expect((screen.getByTestId("scenario-select") as HTMLSelectElement).value).toBe("link_contrast");
    await user.click(screen.getByTestId("agent-lin"));
    await user.click(screen.getByTestId("sim-work"));
    expect(screen.getByTestId("sim-notice").textContent ?? "").toContain("林知夏");

    await user.click(screen.getByTestId("tab-live"));

    expect(screen.getByTestId("tab-live").getAttribute("aria-selected")).toBe("true");
    expect(screen.getByTestId("tab-demo").getAttribute("aria-selected")).toBe("false");
    expect(screen.getByTestId("mode-banner").textContent).toBe("Bot自行回報・非平台原生");
    expect((await screen.findByTestId("live-note")).textContent ?? "").toContain("不是閒置");
    expect(screen.queryByTestId("sim-panel")).toBeNull();
    expect(screen.queryByTestId("sim-notice")).toBeNull();
    expect(document.querySelectorAll("[data-agent-id]")).toHaveLength(4);
    expect(document.querySelectorAll("[data-seat]")).toHaveLength(5);

    const visible = document.body.textContent ?? "";
    for (const name of ["專案／產品助手（協調）", "Agent Office 開發助手", "Agent Office 互動設計", "Agent Office 測試與授權"]) {
      expect(visible).toContain(name);
    }
    for (const name of DEMO_NAMES) expect(visible).not.toContain(name);
    expect(visible).not.toContain("斷線與過期");
    expect(visible).not.toContain("已記下");
    expect(visible).not.toContain("模擬資料・未連接真實 Agent");
    expect(visible).toContain("bot-self-report");

    const summary = screen.getByTestId("summary-panel").textContent ?? "";
    expect(summary).toContain("工作中");
    expect(summary).toContain("失敗");
    expect(screen.getByTestId("unknown-breakdown").textContent).toBe("未知的組成：資料過期 0，連線中斷 0。");
    const counts = Object.fromEntries(
      [...screen.getByTestId("summary-panel").querySelectorAll(".counts div")].map((node) => [
        node.querySelector("dt")?.textContent,
        node.querySelector("dd")?.textContent,
      ]),
    );
    expect(counts["未知"]).toBe("4");
    expect(counts["明確閒置"]).toBe("0");
    expect(counts["工作中"]).toBe("0");
    expect(counts["已完成"]).toBe("0");
    expect(counts["失敗"]).toBe("0");

    await user.click(screen.getByTestId("tab-demo"));
    expect(screen.getByTestId("mode-banner").textContent).toBe("模擬資料・未連接真實 Agent");
    expect(screen.getByTestId("tab-demo").getAttribute("aria-selected")).toBe("true");
    expect(screen.getByTestId("sim-panel")).toBeTruthy();
    expect(screen.queryByTestId("sim-notice")).toBeNull();
    expect(document.body.textContent ?? "").toContain("林知夏");
    expect(document.querySelectorAll("[data-agent-id]").length).toBeGreaterThan(0);
  });

  it("保留上次成功的資料，且等目前請求完成才繼續更新", async () => {
    window.history.replaceState(null, "", "/?view=real");
    vi.useFakeTimers();
    let resolveRefresh: (response: Response) => void = () => undefined;
    const refresh = new Promise<Response>((resolve) => { resolveRefresh = resolve; });
    const ids = TRUSTED.map(({ id }) => id);
    const fetch = vi.fn().mockResolvedValueOnce(Response.json(completedReport(ids)))
      .mockReturnValueOnce(refresh).mockResolvedValueOnce(Response.json(completedReport(ids)));
    vi.stubGlobal("fetch", fetch);
    render(<AgentOfficeApp />);
    await act(async () => {});

    expect(screen.getByTestId("live-note")).toHaveTextContent("已連線");
    const detail = screen.getByTestId("detail-panel");
    expect(within(detail).getByText("任務結果").nextElementSibling).toHaveTextContent("已完成");
    expect(within(detail).getByText("回報新鮮度").nextElementSibling).toHaveTextContent("已過期");
    const timeline = within(detail).getByRole("region", { name: "任務時間軸" });
    expect(timeline).toHaveTextContent("2 秒");
    expect(timeline.querySelectorAll("time")).toHaveLength(2);

    await act(async () => { await vi.advanceTimersByTimeAsync(4_000); });
    expect(fetch).toHaveBeenCalledTimes(2);
    await act(async () => { resolveRefresh(new Response(null, { status: 503 })); });
    expect(screen.getByTestId("live-note")).toHaveTextContent("上次成功讀取的快取");
    expect(screen.getByTestId("detail-panel")).toHaveTextContent("整理會議記錄");
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    expect(screen.getByTestId("live-note")).toHaveTextContent("已連線");
  });

  it("按工作階段瀏覽 Hook 座位，能選取第六位並看到生命週期結束", async () => {
    window.history.replaceState(null, "", "/?view=codex");
    vi.useFakeTimers();
    vi.setSystemTime(4_000);
    const hookSessions = [
      { sessionId: "session-a", agents: Array.from({ length: 6 }, (_, index) => ({
        agentId: `helper-${index + 1}`, agentType: "worker", turnId: null, startedAt: 1_000,
        stoppedAt: index === 0 || index === 5 ? 3_000 : null, lastEventAt: index === 0 || index === 5 ? 3_000 : 1_000,
      })), recent: [{ eventId: "stop-6", kind: "stopped", agentId: "helper-6", agentType: "worker", turnId: null, at: 3_000 }] },
      { sessionId: "session-b", agents: [{ agentId: "other", agentType: "worker", turnId: "turn", startedAt: 1_000, stoppedAt: null, lastEventAt: 1_000 }], recent: [] },
    ];
    let hookReads = 0;
    const fetch = vi.fn(async (url: string) => url === "/api/self-report"
      ? Response.json(completedReport(CODEX_IDS, "codex"))
      : Response.json({ evidenceType: "codex-hook", sessions: ++hookReads === 1 ? hookSessions : [...hookSessions].reverse() }));
    vi.stubGlobal("fetch", fetch);
    render(<AgentOfficeApp />);

    expect(screen.getByTestId("mode-banner")).toHaveTextContent("動態辦公室");
    expect(fetch).not.toHaveBeenCalledWith("/api/self-report", expect.anything());
    await act(async () => {});
    const sessions = screen.getByRole("combobox", { name: "Codex 工作階段" });
    expect(document.querySelectorAll("[data-agent-id]")).toHaveLength(5);
    expect(screen.getByTestId("agent-helper-1")).toHaveAttribute("data-desk-presence", "away");
    expect(screen.getByTestId("agent-helper-1")).toHaveAccessibleName(/離席/);
    fireEvent.click(screen.getByTestId("agent-helper-1"));
    expect(screen.getByTestId("detail-status")).toHaveTextContent("已結束");
    const list = screen.getByRole("list", { name: "此工作階段的子代理" });
    fireEvent.click(within(list).getByRole("button", { name: /helper-6/ }));
    const detail = screen.getByTestId("detail-panel");
    expect(detail).toHaveTextContent("已結束");
    expect(detail).not.toHaveTextContent("已完成");
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    expect(sessions).toHaveValue("session-a");
    expect(detail).toHaveTextContent("helper-6");
    fireEvent.change(sessions, { target: { value: "session-b" } });
    expect(document.querySelectorAll("[data-agent-id]")).toHaveLength(1);
    expect(screen.getByTestId("detail-panel")).toHaveTextContent("other");
    expect(screen.getByRole("region", { name: "今日完工牆" })).not.toHaveTextContent("helper-6");
  });

  it("預設選擇動態工作階段，並保留逾時者明確回報的結果", async () => {
    window.history.replaceState(null, "", "/?view=codex");
    vi.useFakeTimers();
    vi.setSystemTime(400_000);
    const finished = { agentId: "finished", agentType: "worker", turnId: null, startedAt: 4_000,
      stoppedAt: 10_000, lastEventAt: 10_000, outcome: "completed", taskTitle: "核對資料" };
    const fresh = { ...finished, agentId: "fresh", stoppedAt: 398_000, lastEventAt: 398_000, taskTitle: "執行測試" };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ evidenceType: "codex-hook", sessions: [
      { sessionId: "other", agents: [], recent: [] },
      { sessionId: "office-live", agents: [finished, fresh], recent: [] },
    ] })));
    render(<AgentOfficeApp />);
    await act(async () => {});

    expect(screen.getByRole("combobox", { name: "Codex 工作階段" })).toHaveValue("office-live");
    expect(screen.getByTestId("agent-fresh")).toHaveAttribute("data-status", "completed");
    fireEvent.click(screen.getByTestId("agent-finished"));
    expect(screen.getByTestId("agent-finished")).toHaveAccessibleName(/離席/);
    expect(screen.getByTestId("detail-status")).toHaveTextContent("離席");
    const detail = screen.getByTestId("detail-panel");
    expect(within(detail).getByText("任務結果").nextElementSibling).toHaveTextContent("已完成");
    expect(detail).toHaveTextContent("核對資料");
    const timeline = within(detail).getByRole("region", { name: "任務時間軸" });
    expect(within(timeline).getAllByRole("listitem")).toHaveLength(2);
    expect(timeline).toHaveTextContent("已完成");
    expect(screen.getByRole("region", { name: "今日完工牆" })).toHaveTextContent("核對資料");
  });

  it("新任務接替已完成的座位，仍能查看前一位子代理的紀錄", async () => {
    window.history.replaceState(null, "", "/?view=codex");
    vi.useFakeTimers();
    vi.setSystemTime(6_000);
    const firstWorkers = Array.from({ length: 5 }, (_, index) => ({
      agentId: `worker-${index + 1}`, agentType: "worker", turnId: null, startedAt: 1_000,
      stoppedAt: null, lastEventAt: 1_000, outcome: null, taskTitle: `任務 ${index + 1}`,
    }));
    const finished = { ...firstWorkers[0]!, stoppedAt: 5_000, lastEventAt: 5_000, outcome: "completed" };
    const newWorker = { ...firstWorkers[0]!, agentId: "worker-6", startedAt: 6_500, lastEventAt: 6_500, taskTitle: "新任務" };
    const completionEvent = { eventId: "completed-1", agentId: "worker-1", agentType: "worker", turnId: null,
      kind: "completed", jobId: "job-1", at: 5_000, taskTitle: "任務 1" };
    let update = false;
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ evidenceType: "codex-hook", sessions: [{
      sessionId: "office-live", agents: update ? [finished, ...firstWorkers.slice(1), newWorker] : firstWorkers,
      recent: update ? [completionEvent] : [],
    }] })));
    render(<AgentOfficeApp />);
    await act(async () => {});
    const first = screen.getByTestId("agent-worker-1");
    const firstSeat = first.getAttribute("data-seat");
    fireEvent.click(first);

    update = true;
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    expect(screen.getByTestId("agent-worker-6")).toHaveAttribute("data-seat", firstSeat);
    expect(screen.queryByTestId("agent-worker-1")).toBeNull();
    const detail = screen.getByTestId("detail-panel");
    expect(detail).toHaveTextContent("worker-1");
    expect(within(detail).getByRole("region", { name: "任務時間軸" })).toHaveTextContent("已完成");
    expect(within(screen.getByRole("region", { name: "今日完工牆" })).getAllByRole("listitem")).toHaveLength(1);
  });

  it("區分自行回報逾時和從未入座，保留最後已知結果", async () => {
    window.history.replaceState(null, "", "/?view=codex");
    vi.stubGlobal("fetch", vi.fn(async () => Response.json(completedReport(CODEX_IDS, "codex"))));
    render(<AgentOfficeApp />);
    fireEvent.click(screen.getByRole("button", { name: "自行回報" }));
    expect(screen.getByTestId("agent-codex-lead")).toHaveAccessibleName(/尚未入座/);
    await act(async () => {});
    expect(screen.getByTestId("agent-codex-lead")).toHaveAccessibleName(/離席/);
    expect(screen.getByTestId("detail-status")).toHaveTextContent("離席");
    const detail = screen.getByTestId("detail-panel");
    expect(within(detail).getByText("回報新鮮度").nextElementSibling).toHaveTextContent("回報逾時");
    expect(within(detail).getByText("任務結果").nextElementSibling).toHaveTextContent("已完成");
    expect(screen.getByTestId("live-note")).toHaveTextContent("已連線");
    fireEvent.click(screen.getByTestId("agent-codex-api"));
    expect(screen.getByTestId("detail-status")).toHaveTextContent("尚未入座");
  });

  it("在台北當日完工牆只列一次任務完成，排除昨日及失敗回報", async () => {
    window.history.replaceState(null, "", "/?view=codex");
    vi.useFakeTimers();
    const today = Date.parse("2026-11-09T16:00:00Z");
    vi.setSystemTime(today + 600_000);
    const report = completedReport(CODEX_IDS, "codex");
    const completed = { ...report.recent[0]!, at: today, acceptedAt: today + 100 };
    const lead = { ...report.agents[0]!, startedAt: today - 2_000, terminalAt: today, lastReportAt: today + 100 };
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({
      ...report,
      agents: [lead, ...report.agents.slice(1)],
      recent: [completed, completed, { ...completed, eventId: "done-retry", at: today + 1 },
        { ...completed, eventId: "yesterday", jobId: "yesterday", taskTitle: "昨日的工作", at: today - 1 },
        { ...completed, eventId: "failed", jobId: "failed", taskTitle: "失敗的工作", type: "task.failed" }],
    })));
    render(<AgentOfficeApp />);
    fireEvent.click(screen.getByRole("button", { name: "自行回報" }));
    await act(async () => {});
    const wall = within(screen.getByRole("region", { name: "今日完工牆" }));
    expect(wall.getAllByRole("listitem")).toHaveLength(1);
    expect(wall.getByText("整理會議記錄")).toBeVisible();
    expect(wall.queryByText("昨日的工作")).toBeNull();
    expect(wall.queryByText("失敗的工作")).toBeNull();
  });

  it("從任務和驗收條件產生可選取的 Codex 動態派工提示詞", async () => {
    window.history.replaceState(null, "", "/?view=codex");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(completedReport(CODEX_IDS, "codex"))));
    const user = userEvent.setup();
    render(<AgentOfficeApp />);

    await user.click(screen.getByText("產生派工提示詞"));
    await user.type(screen.getByRole("textbox", { name: "任務" }), "修正看板更新");
    expect(screen.queryByRole("combobox", { name: "指定座位" })).toBeNull();
    await user.type(screen.getByRole("textbox", { name: "驗收條件" }), "保留上次成功資料");
    const prompt = screen.getByRole<HTMLTextAreaElement>("textbox", { name: "可複製的提示詞" });
    expect(prompt.value).toContain("修正看板更新");
    expect(prompt.value).toContain("--session-id office-live");
    expect(prompt.value).toContain("--agent-id");
    expect(prompt.value).toContain("保留上次成功資料");
    await user.click(screen.getByRole("button", { name: "複製提示詞" }));
    expect(await screen.findByText("已複製提示詞")).toBeTruthy();
    const denied = vi.spyOn(navigator.clipboard, "writeText").mockRejectedValueOnce(new Error("denied"));
    await user.click(screen.getByRole("button", { name: "複製提示詞" }));
    expect(await screen.findByText(/已選取提示詞/)).toBeTruthy();
    expect(prompt).toHaveFocus();
    expect(prompt.value.slice(prompt.selectionStart, prompt.selectionEnd)).toBe(prompt.value);
    denied.mockRestore();
  });
});
