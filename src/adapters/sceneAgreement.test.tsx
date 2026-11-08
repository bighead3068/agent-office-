import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { selectSummary } from "../core/agent-core";
import { OfficeScene } from "../office";
import { presentSeat } from "../office/presentation";
import { createScenario, sceneAgents } from "./officeAdapter";

const NOW = 1_700_000_000_000;

function boardCount(status: string): string {
  const row = document.querySelector(`[data-count="${status}"] span:last-child`);
  return row?.textContent ?? "";
}

describe("座位畫面與核心同一狀態", () => {
  it("失敗與受阻同時存在時，小摘要、圖示和監督人數一致", () => {
    const state = createScenario("failed", NOW);
    const summary = selectSummary(state);
    const agents = sceneAgents(state);
    render(<OfficeScene now={0} agents={agents} selectedId="fang" />);

    const fang = screen.getByTestId("agent-fang");
    expect(fang.getAttribute("data-status")).toBe("failed");
    expect(fang.getAttribute("data-bubble")).toBe("bang");
    expect(fang.getAttribute("data-monitor")).toBe("red");
    expect(fang.getAttribute("data-pose")).toBe("slump");
    expect(
      presentSeat(agents.find((agent) => agent.id === "fang")!, {
        reducedMotion: false,
        now: 0,
        waitingSince: null,
        egg: null,
      }).bubble,
    ).toBe("bang");

    const chen = screen.getByTestId("agent-chen");
    expect(chen.getAttribute("data-status")).toBe("blocked");
    expect(chen.getAttribute("data-bubble")).toBe("block");
    expect(chen.getAttribute("data-monitor")).toBe("amber");
    expect(chen.getAttribute("data-pose")).toBe("sit");

    const gao = screen.getByTestId("agent-gao");
    expect(gao.getAttribute("data-status")).toBe("waiting");
    expect(gao.getAttribute("data-bubble")).toBe("ellipsis");

    expect(boardCount("working")).toBe(String(summary.counts.working));
    expect(boardCount("waiting")).toBe(String(summary.counts.waiting));
    expect(boardCount("blocked")).toBe(String(summary.counts.blocked));
    expect(boardCount("failed")).toBe(String(summary.counts.failed));
    expect(boardCount("waiting")).toBe("1");
    expect(boardCount("blocked")).toBe("1");
    expect(boardCount("failed")).toBe("1");
  });
});
