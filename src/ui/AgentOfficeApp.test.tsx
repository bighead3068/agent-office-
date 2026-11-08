import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentOfficeApp } from "./AgentOfficeApp";

const DEMO_NAMES = ["林知夏", "陳墨白", "高小滿", "方寧遠"];

describe("真實資料畫面", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
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
    expect(await screen.findByTestId("live-empty")).toBeTruthy();
    expect(screen.getByTestId("mode-banner").textContent).toBe("Bot自行回報・非平台原生");
    expect(screen.getByTestId("live-empty").textContent ?? "").toContain("不是閒置");
    expect(screen.queryByTestId("sim-panel")).toBeNull();
    expect(screen.queryByTestId("sim-notice")).toBeNull();
    expect(document.querySelectorAll("[data-agent-id]")).toHaveLength(0);
    expect(document.querySelectorAll("[data-seat]")).toHaveLength(0);

    const visible = document.body.textContent ?? "";
    for (const name of DEMO_NAMES) expect(visible).not.toContain(name);
    expect(visible).not.toContain("斷線與過期");
    expect(visible).not.toContain("已記下");
    expect(visible).not.toContain("模擬資料・未連接真實 Agent");

    const summary = screen.getByTestId("summary-panel").textContent ?? "";
    expect(summary).toContain("工作中");
    expect(summary).toContain("失敗");
    expect(screen.getByTestId("unknown-breakdown").textContent).toBe("未知的組成：資料過期 0，連線中斷 0。");
    for (const node of screen.getByTestId("summary-panel").querySelectorAll("dd")) {
      expect(node.textContent).toBe("0");
    }

    await user.click(screen.getByTestId("tab-demo"));
    expect(screen.getByTestId("mode-banner").textContent).toBe("模擬資料・未連接真實 Agent");
    expect(screen.getByTestId("tab-demo").getAttribute("aria-selected")).toBe("true");
    expect(screen.getByTestId("sim-panel")).toBeTruthy();
    expect(screen.queryByTestId("sim-notice")).toBeNull();
    expect(document.body.textContent ?? "").toContain("林知夏");
    expect(document.querySelectorAll("[data-agent-id]").length).toBeGreaterThan(0);
  });
});
