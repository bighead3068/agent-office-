import {
  createInitialState,
  isEasterEggEligible,
  reducer,
  selectAgent,
  selectStream,
  selectSummary,
  type AgentOfficeEvent,
  type AgentSnapshot,
  type AssertedStatus,
  type Diagnostic,
  type FactProvenance,
  type OfficeState,
} from "../core/agent-core";
import type { AgentStatus, OfficeAgent } from "../office/types";

export const DEMO_SOURCE_ID = "demo-sim";
export const DEMO_STREAM_ID = "demo-main";

/** App choice for this demo, not an official freshness guarantee. */
export const FRESHNESS_TTL_MS = 45_000;

/**
 * Scene timings for the product floor. The component's omitted defaults
 * (1s / 5s / 4s) are test values and are not used here.
 */
export const SCENE_EGG = {
  easterEggIdleWaitMs: 12_000,
  easterEggFrequencyCapMs: 36_000,
  easterEggDurationMs: 6_000,
} as const;

export const DEMO_ROSTER = [
  { id: "lin", name: "林知夏", role: "研究調度" },
  { id: "chen", name: "陳墨白", role: "程式實作" },
  { id: "gao", name: "高小滿", role: "視覺設計" },
  { id: "fang", name: "方寧遠", role: "品質審查" },
] as const;

export type DemoAgentId = (typeof DEMO_ROSTER)[number]["id"];
export type ScenarioId = "opening" | "all_working" | "blocked_waiting" | "explicit_idle" | "failed" | "link_contrast";

export const SCENARIOS: { id: ScenarioId; label: string; hint: string }[] = [
  { id: "opening", label: "開場・各自有事", hint: "工作、等待、明確閒置、已完成各一" },
  { id: "all_working", label: "全員工作中", hint: "四個人都在做事" },
  { id: "blocked_waiting", label: "等待與受阻", hint: "一位在等，一位被卡住" },
  { id: "failed", label: "失敗後可以再做", hint: "失敗的人可以恢復，或接一件新工作" },
  { id: "explicit_idle", label: "明確閒置", hint: "只有明確閒置的人才會打盹" },
  { id: "link_contrast", label: "斷線與過期", hint: "連線中斷、資料過期，最後已知都還在" },
];

export const AUTOPLAY: { agentId: DemoAgentId; action: "wait" | "resume" | "complete" }[] = [
  { agentId: "lin", action: "wait" },
  { agentId: "lin", action: "resume" },
  { agentId: "lin", action: "complete" },
];

export const AUTOPLAY_STEP_MS = 1800;

export type SimAction = "work" | "wait" | "block" | "fail" | "resume" | "complete" | "idle" | "disconnect" | "reconnect" | "heartbeat" | "expire";

const STATUS_SCENE: Record<AssertedStatus, AgentStatus> = {
  working: "working",
  waiting: "waiting",
  blocked: "blocked",
  failed: "failed",
  completed: "completed",
  idle: "idle",
};

const REJECT_ZH: Record<string, string> = {
  invalid_schema: "事件格式無效，沒有寫入。",
  missing_provenance: "缺少來源、串流或序號，沒有寫入。",
  provenance_mismatch: "同一則事件裡的來源不一致，沒有寫入。",
  inactive_session: "這個模式還沒啟動，沒有寫入。",
  mode_mismatch: "事件模式與目前畫面不同，沒有寫入。",
  stale_generation: "這是上一輪的回呼，世代已經換過，沒有寫入。",
  out_of_order: "序號沒有往前，沒有默默套用。",
  duplicate_event: "重複事件，已略過。",
  source_conflict: "來源與這位已綁定的來源不同，沒有改寫。",
  untrusted_stream: "這個串流還沒被信任的重置接納。",
  untrusted_reset: "重置沒有通過信任條件，沒有套用。",
  unknown_agent: "還沒有這位代理人，沒有憑空建立。",
  episode_mismatch: "彩蛋回合對不上，沒有消費。",
  not_eligible: "目前沒有可消費的閒置彩蛋。",
  already_consumed: "這一輪閒置彩蛋已經消費過。",
};

export function diagnosticText(code: string): string {
  return REJECT_ZH[code] ?? "事件沒有被接受。";
}

function roleOf(agentId: string): string {
  return DEMO_ROSTER.find((agent) => agent.id === agentId)?.role ?? "代理人";
}

function nameOf(agentId: string): string {
  return DEMO_ROSTER.find((agent) => agent.id === agentId)?.name ?? agentId;
}

function provenance(seq: number, at: number): FactProvenance {
  return { sourceId: DEMO_SOURCE_ID, streamId: DEMO_STREAM_ID, seq, at };
}

function newestDiagnostic(before: OfficeState, after: OfficeState): Diagnostic | null {
  if (after.diagnostics.length === before.diagnostics.length) return null;
  return after.diagnostics[after.diagnostics.length - 1] ?? null;
}

export function applyEvent(state: OfficeState, event: AgentOfficeEvent): { state: OfficeState; diagnostic: Diagnostic | null } {
  const next = reducer(state, event);
  return { state: next, diagnostic: newestDiagnostic(state, next) };
}

function activate(state: OfficeState, mode: "demo" | "real", at: number, eventId: string, resetPartition = false): OfficeState {
  return reducer(state, {
    type: "session.activate",
    eventId,
    mode,
    at,
    ...(resetPartition ? { resetPartition: true } : {}),
  });
}

type Seed = {
  agentId: DemoAgentId;
  status: AssertedStatus;
  taskId: string;
  title: string;
  at?: number;
};

function seedStates(state: OfficeState, rows: Seed[], at: number): OfficeState {
  let next = state;
  for (const row of rows) {
    const cursor = selectStream(next, DEMO_SOURCE_ID, DEMO_STREAM_ID);
    const seq = (cursor?.lastStateSeq ?? 0) + 1;
    const fact = provenance(seq, row.at ?? at);
    const result = applyEvent(next, {
      type: "agent.state",
      eventId: `seed-${row.agentId}-${row.status}-${seq}`,
      mode: "demo",
      generation: next.generation,
      at: row.at ?? at,
      identity: { agentId: row.agentId, label: nameOf(row.agentId), provenance: fact },
      status: { value: row.status, provenance: { ...fact } },
      task: { taskId: row.taskId, title: row.title, provenance: { ...fact } },
    });
    if (result.diagnostic) {
      throw new Error(`seed rejected: ${result.diagnostic.code} ${result.diagnostic.message}`);
    }
    next = result.state;
  }
  return next;
}

export function createScenario(scenario: ScenarioId, now: number): OfficeState {
  const recent = now - 2_000;
  let state = activate(createInitialState(), "demo", now - 3_000, `session-${scenario}-${now}`, true);
  if (scenario === "opening") {
    state = seedStates(state, [
      { agentId: "lin", status: "working", taskId: "task-lin-meet", title: "整理晨會決策" },
      { agentId: "chen", status: "working", taskId: "task-chen-draw", title: "修補繪圖時序" },
      { agentId: "chen", status: "waiting", taskId: "task-chen-draw", title: "修補繪圖時序" },
      { agentId: "gao", status: "working", taskId: "task-gao-lamp", title: "調整桌燈配色" },
      { agentId: "gao", status: "completed", taskId: "task-gao-lamp", title: "調整桌燈配色" },
      { agentId: "gao", status: "idle", taskId: "task-gao-lamp", title: "調整桌燈配色" },
      { agentId: "fang", status: "working", taskId: "task-fang-qa", title: "覆核回歸測試" },
      { agentId: "fang", status: "completed", taskId: "task-fang-qa", title: "覆核回歸測試" },
    ], recent);
  } else if (scenario === "all_working") {
    state = seedStates(state, [
      { agentId: "lin", status: "working", taskId: "task-lin-list", title: "核對今日清單" },
      { agentId: "chen", status: "working", taskId: "task-chen-seat", title: "實作席位點選" },
      { agentId: "gao", status: "working", taskId: "task-gao-poster", title: "畫一張窗邊海報" },
      { agentId: "fang", status: "working", taskId: "task-fang-case", title: "補上一則測試案例" },
    ], recent);
  } else if (scenario === "blocked_waiting") {
    state = seedStates(state, [
      { agentId: "lin", status: "working", taskId: "task-lin-note", title: "整理同事補充" },
      { agentId: "chen", status: "blocked", taskId: "task-chen-spec", title: "等待規格確認" },
      { agentId: "gao", status: "waiting", taskId: "task-gao-swatch", title: "等色票送回" },
      { agentId: "fang", status: "completed", taskId: "task-fang-pass", title: "晨間檢查" },
    ], recent);
  } else if (scenario === "failed") {
    state = seedStates(state, [
      { agentId: "lin", status: "working", taskId: "task-lin-fail", title: "整理晨會決策" },
      { agentId: "chen", status: "blocked", taskId: "task-chen-block", title: "等待規格確認" },
      { agentId: "gao", status: "waiting", taskId: "task-gao-wait", title: "等色票送回" },
      { agentId: "fang", status: "working", taskId: "task-fang-fail", title: "重跑失敗的案例" },
      { agentId: "fang", status: "failed", taskId: "task-fang-fail", title: "重跑失敗的案例" },
    ], recent);
  } else if (scenario === "explicit_idle") {
    state = seedStates(state, [
      { agentId: "lin", status: "working", taskId: "task-lin-read", title: "看一輪晨會紀錄" },
      { agentId: "chen", status: "working", taskId: "task-chen-note", title: "整理程式註解" },
      { agentId: "fang", status: "working", taskId: "task-fang-list", title: "對一下清單" },
      { agentId: "gao", status: "completed", taskId: "task-gao-swatch", title: "收好色票" },
      { agentId: "gao", status: "idle", taskId: "task-gao-swatch", title: "收好色票" },
    ], recent);
  } else {
    state = seedStates(state, [
      { agentId: "lin", status: "working", taskId: "task-lin-light", title: "核對窗邊光線" },
      { agentId: "chen", status: "working", taskId: "task-chen-review", title: "收齊審查意見" },
      { agentId: "fang", status: "completed", taskId: "task-fang-old", title: "修補繪圖時序" },
      { agentId: "gao", status: "working", taskId: "task-gao-sketch", title: "畫一張座位草圖" },
    ], recent);
    state = mustControl(state, {
      type: "agent.link",
      eventId: `seed-lin-down-${now}`,
      mode: "demo",
      generation: state.generation,
      at: recent,
      agentId: "lin",
      link: "down",
    });
    state = mustControl(state, {
      type: "agent.mark_stale",
      eventId: `seed-fang-stale-${now}`,
      mode: "demo",
      generation: state.generation,
      at: recent,
      agentId: "fang",
    });
  }
  return state;
}

function mustControl(state: OfficeState, event: AgentOfficeEvent): OfficeState {
  const result = applyEvent(state, event);
  if (result.diagnostic && result.diagnostic.level !== "info") {
    throw new Error(`control rejected: ${result.diagnostic.code}`);
  }
  return result.state;
}

const TASK_TITLES = ["處理新的交辦", "核對今日清單", "整理手上的草稿", "補上缺少的註記"];

export function dispatchSim(
  state: OfficeState,
  agentId: string,
  action: SimAction,
  now: number,
  nonce: number,
): { state: OfficeState; notice: string } {
  if (state.activeMode !== "demo") {
    return { state, notice: "真實資料視圖不接受模擬事件。" };
  }
  const agent = selectAgent(state, agentId);
  if (!agent) return { state, notice: "沒有這位代理人。" };
  const who = nameOf(agentId);
  const eventId = `sim-${nonce}-${action}`;

  if (action === "expire") {
    const result = applyEvent(state, {
      type: "agent.mark_stale",
      eventId,
      mode: "demo",
      generation: state.generation,
      at: now,
      agentId,
    });
    return { state: result.state, notice: result.diagnostic ? `${who}：${diagnosticText(result.diagnostic.code)}` : `已模擬資料過期：${who}。最後已知還在，有效狀態改為未知。` };
  }

  if (action === "disconnect" || action === "reconnect") {
    const result = applyEvent(state, {
      type: "agent.link",
      eventId,
      mode: "demo",
      generation: state.generation,
      at: now,
      agentId,
      link: action === "disconnect" ? "down" : "up",
    });
    const ok = action === "disconnect"
      ? `已模擬中斷連線：${who}。人還在座位上，目前掌握是未知。`
      : `已模擬重新連線：${who}。連線恢復不會把人變回閒置，要等新的狀態事件。`;
    return { state: result.state, notice: result.diagnostic ? `${who}：${diagnosticText(result.diagnostic.code)}` : ok };
  }

  if (action === "heartbeat") {
    const cursor = selectStream(state, DEMO_SOURCE_ID, DEMO_STREAM_ID);
    const result = applyEvent(state, {
      type: "agent.heartbeat",
      eventId,
      mode: "demo",
      generation: state.generation,
      at: now,
      agentId,
      sourceId: DEMO_SOURCE_ID,
      streamId: DEMO_STREAM_ID,
      seq: (cursor?.lastHeartbeatSeq ?? 0) + 1,
    });
    return {
      state: result.state,
      notice: result.diagnostic
        ? `${who}：${diagnosticText(result.diagnostic.code)}`
        : `已送出心跳：${who}。心跳不會讓人變成閒置，也不會把過期的閒置資格救回來。`,
    };
  }

  const status: AssertedStatus =
    action === "work" || action === "resume"
      ? "working"
      : action === "wait"
        ? "waiting"
        : action === "block"
          ? "blocked"
          : action === "fail"
            ? "failed"
            : action === "complete"
              ? "completed"
              : "idle";
  const cursor = selectStream(state, DEMO_SOURCE_ID, DEMO_STREAM_ID);
  const seq = (cursor?.lastStateSeq ?? 0) + 1;
  const fact = provenance(seq, now);
  const previous = agent.lastKnownTask;
  const taskId = action === "work" || !previous ? `task-${agentId}-${nonce}` : previous.taskId;
  const title = action === "work" || !previous?.title ? TASK_TITLES[nonce % TASK_TITLES.length] ?? "處理新的交辦" : previous.title;
  const result = applyEvent(state, {
    type: "agent.state",
    eventId,
    mode: "demo",
    generation: state.generation,
    at: now,
    identity: { agentId, label: who, provenance: fact },
    status: { value: status, provenance: { ...fact } },
    task: { taskId, title, provenance: { ...fact } },
  });
  if (result.diagnostic) return { state: result.state, notice: `${who}：${diagnosticText(result.diagnostic.code)}` };
  const after = selectAgent(result.state, agentId);
  if (after?.link === "down") {
    return { state: result.state, notice: `已記下${who}的最後已知，但連線中斷，有效狀態仍是未知。` };
  }
  return { state: result.state, notice: `已送出模擬事件：${who}。` };
}

export function activateMode(state: OfficeState, mode: "demo" | "real", now: number, nonce: number): OfficeState {
  return activate(state, mode, now, `mode-${mode}-${nonce}`, false);
}

export function sceneAgents(state: OfficeState): OfficeAgent[] {
  if (state.activeMode !== "demo") return [];
  const agents: OfficeAgent[] = [];
  for (const person of DEMO_ROSTER) {
    const snapshot = selectAgent(state, person.id);
    if (!snapshot) continue;
    agents.push(toOfficeAgent(snapshot, person.role));
  }
  return agents;
}

export function toOfficeAgent(snapshot: AgentSnapshot, role = roleOf(snapshot.agentId)): OfficeAgent {
  const offline = snapshot.link === "down";
  const stale = !offline && snapshot.freshness === "stale";
  const unknown = !offline && !stale && snapshot.effectiveStatus === "unknown";
  const known = snapshot.lastKnownStatus === "unknown" ? "unknown" : STATUS_SCENE[snapshot.lastKnownStatus];
  const status: AgentStatus = offline ? "offline" : unknown ? "unknown" : stale ? known : STATUS_SCENE[snapshot.effectiveStatus as AssertedStatus] ?? "unknown";
  const at = snapshot.statusProvenance?.at ?? snapshot.lastStateAt;
  return {
    id: snapshot.agentId,
    name: snapshot.label ?? nameOf(snapshot.agentId),
    role,
    status,
    freshness: stale ? "stale" : "fresh",
    connected: snapshot.link === "up",
    ...(at != null ? { lastUpdatedAt: new Date(at).toISOString() } : {}),
    ...(snapshot.lastKnownTask?.title
      ? {
          task: {
            title: snapshot.lastKnownTask.title,
            source: snapshot.authoritativeSourceId ?? DEMO_SOURCE_ID,
          },
        }
      : {}),
  };
}

export function coreSummary(state: OfficeState) {
  return selectSummary(state);
}

export function personalEgg(state: OfficeState, agentId: string): boolean {
  return isEasterEggEligible(state, agentId);
}

export function officeEgg(state: OfficeState): boolean {
  return isEasterEggEligible(state);
}
