import { describe, expect, it } from "vitest";
import { isEasterEggEligible, reducer, selectAgent, selectSummary } from "../core/agent-core";
import {
  AUTOPLAY,
  DEMO_SOURCE_ID,
  DEMO_STREAM_ID,
  SCENE_EGG,
  activateMode,
  createScenario,
  dispatchSim,
  officeEgg,
  personalEgg,
  sceneAgents,
  toOfficeAgent,
} from "./officeAdapter";

const NOW = 1_700_000_000_000;

describe("示範轉接器接到狀態核心", () => {
  it("工作、等待、恢復、完成不會變成閒置", () => {
    let state = createScenario("opening", NOW);
    let nonce = 1;
    for (const step of AUTOPLAY) {
      const result = dispatchSim(state, step.agentId, step.action, NOW + nonce, nonce);
      state = result.state;
      nonce += 1;
    }
    const lin = selectAgent(state, "lin");
    expect(lin?.lastKnownStatus).toBe("completed");
    expect(lin?.effectiveStatus).toBe("completed");
    expect(personalEgg(state, "lin")).toBe(false);
    expect(toOfficeAgent(lin!).status).toBe("completed");
  });

  it("明確閒置才有個人彩蛋資格，完成的人沒有", () => {
    const state = createScenario("opening", NOW);
    expect(personalEgg(state, "gao")).toBe(true);
    expect(selectAgent(state, "gao")?.lastKnownStatus).toBe("idle");
    expect(selectAgent(state, "fang")?.effectiveStatus).toBe("completed");
    expect(personalEgg(state, "fang")).toBe(false);
    expect(officeEgg(state)).toBe(false);
    expect(toOfficeAgent(selectAgent(state, "gao")!).status).toBe("idle");
  });

  it("過期或斷線停掉彩蛋，並留下最後已知", () => {
    let state = createScenario("opening", NOW);
    state = dispatchSim(state, "gao", "expire", NOW, 1).state;
    const stale = selectAgent(state, "gao");
    expect(stale?.effectiveStatus).toBe("unknown");
    expect(stale?.lastKnownStatus).toBe("idle");
    expect(stale?.freshness).toBe("stale");
    expect(personalEgg(state, "gao")).toBe(false);
    expect(toOfficeAgent(stale!).freshness).toBe("stale");
    expect(toOfficeAgent(stale!).status).toBe("idle");

    state = createScenario("opening", NOW);
    state = dispatchSim(state, "gao", "disconnect", NOW, 2).state;
    const dropped = selectAgent(state, "gao");
    expect(dropped?.link).toBe("down");
    expect(dropped?.effectiveStatus).toBe("unknown");
    expect(dropped?.lastKnownTask?.title).toBe("調整桌燈配色");
    expect(personalEgg(state, "gao")).toBe(false);
    const noted = dispatchSim(state, "gao", "work", NOW + 5, 9);
    expect(noted.notice).toContain("有效狀態仍是未知");
    expect(selectAgent(noted.state, "gao")?.effectiveStatus).toBe("unknown");
    const view = toOfficeAgent(dropped!);
    expect(view.status).toBe("offline");
    expect(view.connected).toBe(false);

    state = dispatchSim(state, "gao", "reconnect", NOW + 10, 3).state;
    const back = selectAgent(state, "gao");
    expect(back?.link).toBe("up");
    expect(back?.effectiveStatus).toBe("unknown");
    expect(personalEgg(state, "gao")).toBe(false);
    expect(isEasterEggEligible(state, "gao")).toBe(false);
  });

  it("心跳不會製造閒置，也不會把過期救回閒置", () => {
    let state = createScenario("opening", NOW);
    state = dispatchSim(state, "fang", "heartbeat", NOW, 1).state;
    expect(selectAgent(state, "fang")?.effectiveStatus).toBe("completed");
    expect(personalEgg(state, "fang")).toBe(false);
    state = dispatchSim(state, "lin", "heartbeat", NOW, 2).state;
    expect(selectAgent(state, "lin")?.lastKnownStatus).toBe("working");
    state = dispatchSim(state, "gao", "expire", NOW, 3).state;
    state = dispatchSim(state, "gao", "heartbeat", NOW + 5, 4).state;
    expect(selectAgent(state, "gao")?.effectiveStatus).toBe("unknown");
    expect(personalEgg(state, "gao")).toBe(false);
  });

  it("同一條串流的序號會擋住過期事件，也不會改到別人", () => {
    const opening = createScenario("opening", NOW);
    const rejected = dispatchSim(opening, "lin", "complete", NOW - 50_000, 1);
    const again = dispatchSim(rejected.state, "lin", "complete", NOW, 1);
    expect(again.notice).toContain("重複");
    const chen = selectAgent(opening, "chen");
    const moved = dispatchSim(opening, "fang", "work", NOW, 9).state;
    expect(selectAgent(moved, "chen")?.lastKnownStatus).toBe(chen?.lastKnownStatus);
    expect(selectAgent(moved, "fang")?.effectiveStatus).toBe("working");
  });

  it("真實模式是空的，晚到的示範事件不會寫進去", () => {
    const demo = createScenario("opening", NOW);
    const live = activateMode(demo, "real", NOW, 1);
    expect(selectSummary(live).mode).toBe("real");
    expect(selectSummary(live).totalAgents).toBe(0);
    expect(sceneAgents(live)).toEqual([]);
    const late = dispatchSim(live, "lin", "complete", NOW, 2);
    expect(late.notice).toContain("真實資料");
    expect(selectSummary(late.state).totalAgents).toBe(0);
    const back = activateMode(late.state, "demo", NOW, 3);
    expect(selectSummary(back).counts.idle).toBe(1);
    expect(selectAgent(back, "lin")?.effectiveStatus).toBe("working");

    const contrast = createScenario("link_contrast", NOW);
    const real = activateMode(contrast, "real", NOW + 20, 40);
    const fact = { sourceId: DEMO_SOURCE_ID, streamId: DEMO_STREAM_ID, seq: 99, at: NOW + 21 };
    const leaked = reducer(real, {
      type: "agent.state",
      eventId: "late-demo-callback",
      mode: "demo",
      generation: contrast.generation,
      at: NOW + 21,
      identity: { agentId: "lin", label: "林知夏", provenance: fact },
      status: { value: "idle", provenance: { ...fact } },
    });
    expect(selectSummary(leaked).mode).toBe("real");
    expect(selectSummary(leaked).totalAgents).toBe(0);
    expect(["stale_generation", "mode_mismatch"]).toContain(leaked.diagnostics.at(-1)?.code);
    const sameGeneration = reducer(real, {
      type: "agent.state",
      eventId: "late-demo-same-generation",
      mode: "demo",
      generation: real.generation,
      at: NOW + 22,
      identity: { agentId: "lin", label: "林知夏", provenance: { ...fact, seq: 100, at: NOW + 22 } },
      status: { value: "idle", provenance: { ...fact, seq: 100, at: NOW + 22 } },
    });
    expect(selectSummary(sameGeneration).totalAgents).toBe(0);
    expect(sameGeneration.diagnostics.at(-1)?.code).toBe("mode_mismatch");
    const restored = activateMode(sameGeneration, "demo", NOW + 23, 41);
    expect(selectSummary(restored).totalAgents).toBe(4);
    expect(selectAgent(restored, "lin")?.link).toBe("down");
  });

  it("監督摘要與有效狀態一致", () => {
    for (const scenario of ["opening", "all_working", "blocked_waiting", "explicit_idle", "failed", "link_contrast"] as const) {
      const state = createScenario(scenario, NOW);
      const summary = selectSummary(state);
      const agents = ["lin", "chen", "gao", "fang"].map((id) => selectAgent(state, id));
      const counts = { working: 0, waiting: 0, blocked: 0, failed: 0, completed: 0, idle: 0, unknown: 0 };
      for (const agent of agents) {
        if (!agent) continue;
        counts[agent.effectiveStatus] += 1;
      }
      expect(summary.counts).toMatchObject(counts);
      expect(summary.totalAgents).toBe(4);
      const sum = Object.values(summary.counts).reduce((total, value) => total + value, 0);
      expect(sum).toBe(summary.totalAgents);
    }
    const opening = selectSummary(createScenario("opening", NOW));
    expect(opening.counts).toMatchObject({ working: 1, waiting: 1, completed: 1, idle: 1, unknown: 0 });
    const contrast = createScenario("link_contrast", NOW);
    const summary = selectSummary(contrast);
    expect(summary.disconnected.map((agent) => agent.agentId)).toEqual(["lin"]);
    expect(summary.stale.map((agent) => agent.agentId)).toEqual(["fang"]);
    expect(summary.counts.unknown).toBe(2);
    expect(sceneAgents(contrast).find((agent) => agent.id === "lin")?.status).toBe("offline");
    expect(sceneAgents(contrast).find((agent) => agent.id === "fang")?.freshness).toBe("stale");
  });

  it("失敗單獨計數，恢復或新工作都不會變成閒置", () => {
    const state = createScenario("failed", NOW);
    const summary = selectSummary(state);
    expect(summary.counts.failed).toBe(1);
    expect(summary.counts.blocked).toBe(1);
    expect(summary.counts.waiting).toBe(1);
    expect(summary.counts.working).toBe(1);
    expect(summary.counts.idle).toBe(0);
    expect(summary.failed.map((agent) => agent.agentId)).toEqual(["fang"]);
    expect(personalEgg(state, "fang")).toBe(false);
    expect(toOfficeAgent(selectAgent(state, "fang")!).status).toBe("failed");
    expect(toOfficeAgent(selectAgent(state, "chen")!).status).toBe("blocked");
    expect(toOfficeAgent(selectAgent(state, "gao")!).status).toBe("waiting");

    const resumed = dispatchSim(state, "fang", "resume", NOW + 1, 1).state;
    expect(selectAgent(resumed, "fang")?.effectiveStatus).toBe("working");
    expect(selectSummary(resumed).counts.failed).toBe(0);
    expect(personalEgg(resumed, "fang")).toBe(false);

    const failedAgain = dispatchSim(resumed, "fang", "fail", NOW + 2, 2).state;
    const next = dispatchSim(failedAgain, "fang", "work", NOW + 3, 3);
    expect(selectAgent(next.state, "fang")?.effectiveStatus).toBe("working");
    expect(selectAgent(next.state, "fang")?.lastKnownTask?.taskId).not.toBe("task-fang-fail");
    expect(personalEgg(next.state, "fang")).toBe(false);
    expect(selectSummary(next.state).counts.idle).toBe(0);
  });

  it("畫面彩蛋用較長的設定，而不是 1 秒測試預設", () => {
    expect(SCENE_EGG.easterEggIdleWaitMs).toBeGreaterThan(1_000);
    expect(SCENE_EGG.easterEggFrequencyCapMs).toBeGreaterThan(5_000);
    expect(SCENE_EGG.easterEggDurationMs).toBeLessThanOrEqual(8_000);
  });
});
