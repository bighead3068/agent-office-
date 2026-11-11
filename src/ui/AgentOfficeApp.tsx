import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import {
  AUTOPLAY,
  AUTOPLAY_STEP_MS,
  DEMO_ROSTER,
  DEMO_SOURCE_ID,
  DEMO_STREAM_ID,
  FRESHNESS_TTL_MS,
  SCENE_EGG,
  SCENARIOS,
  activateMode,
  coreSummary,
  createScenario,
  dispatchSim,
  officeEgg,
  personalEgg,
  sceneAgents,
  type ScenarioId,
  type SimAction,
} from "../adapters/officeAdapter";
import { reducer, selectAgent, type AgentSnapshot, type OfficeState } from "../core/agent-core";
import { OfficeScene } from "../office";
import "../office/OfficeScene.css";
import { CODEX_ACTIVITY_EVIDENCE, CODEX_ACTIVITY_URL, projectCodexActivity } from "../adapters/codexActivity";
import {
  FIXTURE_REPORT_URL,
  SELF_REPORT_URL,
  localFallback,
  projectSelfReport,
  requestedReportView,
  type RealViewModel,
  type SeatModel,
  type SelfReportPayload,
  type TaskHistory,
} from "../adapters/selfReport";
import { CodexActivity } from "./CodexActivity";
import { CodexAssignment } from "./CodexAssignment";
import { CompletionWall } from "./CompletionWall";
import { ConnectionNotice, formatReportTime, ReportTime, useSnapshot } from "./reportConnection";

const STATUS_ZH = {
  working: "工作中",
  waiting: "等待中",
  blocked: "受阻",
  failed: "失敗",
  completed: "已完成",
  idle: "明確閒置",
  unknown: "未知",
} as const;

const CODEX_SCENE_EGG = {
  easterEggIdleWaitMs: 4_000,
  easterEggFrequencyCapMs: 30_000,
  easterEggDurationMs: 6_000,
} as const;

const SIM_GROUPS: { title: string; actions: { id: SimAction; label: string }[] }[] = [
  {
    title: "任務",
    actions: [
      { id: "work", label: "開始工作" },
      { id: "wait", label: "進入等待" },
      { id: "block", label: "受阻" },
      { id: "fail", label: "失敗" },
      { id: "resume", label: "恢復工作" },
      { id: "complete", label: "完成" },
      { id: "idle", label: "明確閒置" },
    ],
  },
  {
    title: "連線與新鮮度",
    actions: [
      { id: "disconnect", label: "中斷連線" },
      { id: "reconnect", label: "重新連線" },
      { id: "heartbeat", label: "心跳" },
      { id: "expire", label: "資料過期" },
    ],
  },
];

export function AgentOfficeApp() {
  const boot = useRef({ now: Date.now(), nonce: 1 });
  const [now, setNow] = useState(boot.current.now);
  const search = typeof window === "undefined" ? "" : window.location.search;
  const [liveView] = useState(() => requestedReportView(search));
  const [office, setOffice] = useState<OfficeState>(() => {
    const demo = createScenario("opening", boot.current.now);
    const openReport = liveView !== "real" || new URLSearchParams(search).get("view") === "real";
    return openReport ? activateMode(demo, "real", boot.current.now, boot.current.nonce) : demo;
  });
  const [scenario, setScenario] = useState<ScenarioId>("opening");
  const [selectedId, setSelectedId] = useState("lin");
  const [notice, setNotice] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [scriptNote, setScriptNote] = useState<string | null>(null);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [codexSource, setCodexSource] = useState<"manual" | "dynamic">("dynamic");
  const [reportSelection, setReportSelection] = useState("");
  const nonce = useRef(10);
  const indexRef = useRef(0);
  const dueRef = useRef(0);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => setReducedMotion(media.matches);
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, []);

  const officeRef = useRef(office);
  officeRef.current = office;

  useEffect(() => {
    if (!running || office.activeMode !== "demo") return;
    const timer = window.setInterval(() => {
      const time = Date.now();
      setNow(time);
      let current = evaluateFreshness(officeRef.current, time);
      const step = AUTOPLAY[indexRef.current];
      if (step && time >= dueRef.current) {
        const result = dispatchSim(current, step.agentId, step.action, time, nonce.current);
        nonce.current += 1;
        current = result.state;
        setNotice(result.notice);
        indexRef.current += 1;
        if (indexRef.current >= AUTOPLAY.length) {
          setRunning(false);
          setScriptNote("腳本播完了。林知夏走完工作、等待、恢復、完成，沒有被自動改成閒置。");
        } else {
          dueRef.current = time + AUTOPLAY_STEP_MS;
        }
      }
      officeRef.current = current;
      setOffice(current);
    }, 400);
    return () => window.clearInterval(timer);
  }, [running, office.activeMode]);

  const summary = coreSummary(office);
  const agents = sceneAgents(office);
  const demoMode = office.activeMode === "demo";
  const codexMode = !demoMode && liveView === "codex";
  const dynamicMode = codexMode && codexSource === "dynamic";
  const projectReports = useCallback((payload: unknown) =>
    payload && typeof payload === "object" ? projectSelfReport(payload as SelfReportPayload, liveView) : null, [liveView]);
  const live = useSnapshot(!demoMode && !dynamicMode, liveView === "fixture" ? FIXTURE_REPORT_URL : SELF_REPORT_URL, projectReports);
  const activity = useSnapshot(dynamicMode, CODEX_ACTIVITY_URL, projectCodexActivity);

  function resetScenario(next: ScenarioId = scenario) {
    setRunning(false);
    indexRef.current = 0;
    setScriptNote(null);
    const time = Date.now();
    setNow(time);
    setScenario(next);
    setOffice(createScenario(next, time));
    setNotice(`已載入情境：${SCENARIOS.find((item) => item.id === next)?.label ?? next}`);
  }

  function togglePlay() {
    if (office.activeMode !== "demo") return;
    if (running) {
      setRunning(false);
      return;
    }
    const time = Date.now();
    if (indexRef.current >= AUTOPLAY.length || scenario !== "opening") {
      indexRef.current = 0;
      setScenario("opening");
      setOffice(createScenario("opening", time));
      setScriptNote("從開場情境播放模擬腳本。");
    }
    setNow(time);
    dueRef.current = time + AUTOPLAY_STEP_MS;
    setRunning(true);
  }

  function send(action: SimAction) {
    if (office.activeMode !== "demo") return;
    const stamp = running ? Date.now() : now;
    const result = dispatchSim(office, selectedId, action, stamp, nonce.current);
    nonce.current += 1;
    setOffice(result.state);
    setNotice(result.notice);
    if (running) setNow(stamp);
  }

  function switchMode(mode: "demo" | "real") {
    if (office.activeMode === mode) return;
    setRunning(false);
    setNotice(null);
    setScriptNote(null);
    const time = Date.now();
    setNow(time);
    setOffice(activateMode(office, mode, time, nonce.current));
    nonce.current += 1;
  }

  const shown = demoMode ? null : (live.data ?? localFallback(liveView));
  const selectedSeat = shown?.seats.find((seat) => seat.agent.id === reportSelection) ?? shown?.seats[0] ?? null;

  function onKeys(event: KeyboardEvent) {
    if (!demoMode) {
      const ids = (shown?.seats ?? []).map((seat) => seat.agent.id);
      const index = Math.max(0, ids.indexOf(selectedSeat?.agent.id ?? ""));
      let next = reportSelection;
      if (event.key === "ArrowRight" || event.key === "ArrowDown") next = ids[(index + 1) % ids.length] ?? reportSelection;
      else if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = ids[(index - 1 + ids.length) % ids.length] ?? reportSelection;
      else if (event.key >= "1" && event.key <= "4") next = ids[Number(event.key) - 1] ?? reportSelection;
      else return;
      event.preventDefault();
      setReportSelection(next);
      return;
    }
    const ids = DEMO_ROSTER.map((agent) => agent.id);
    const index = Math.max(0, ids.indexOf(selectedId as (typeof ids)[number]));
    let next = selectedId;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") next = ids[(index + 1) % ids.length] ?? selectedId;
    else if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = ids[(index - 1 + ids.length) % ids.length] ?? selectedId;
    else if (event.key >= "1" && event.key <= "4") next = ids[Number(event.key) - 1] ?? selectedId;
    else return;
    event.preventDefault();
    setSelectedId(next);
  }

  return (
    <div className="page">
      <header className="top">
        <div className="office-brand">
          <span className="office-mark" aria-hidden="true"><span /></span>
          <div>
            <p className="kicker">Agent Office</p>
            <h1>代理人辦公室</h1>
          </div>
        </div>
        <div className="office-indicators">
          <p className={demoMode ? "banner" : "banner banner-real"} role="status" data-testid="mode-banner" data-partition={demoMode ? "demo" : shown?.partition} data-evidence={demoMode ? "demo" : dynamicMode ? CODEX_ACTIVITY_EVIDENCE : shown?.evidenceType}>
            {demoMode ? "模擬資料・未連接真實 Agent" : dynamicMode ? "Codex 子代理・動態辦公室" : shown?.banner}
          </p>
          {!demoMode ? <ConnectionNotice snapshot={dynamicMode ? activity : live} emptyText={dynamicMode ? "目前無法讀取動態辦公室的活動。" : "座位仍是尚未收到回報，這不是閒置。"} /> : null}
        </div>
      </header>
      <div className="office-toolbar">
        <div className="tabs" role="tablist" aria-label="資料模式">
          <button type="button" className="tab" role="tab" aria-selected={demoMode} data-testid="tab-demo" onClick={() => switchMode("demo")}>示範辦公室</button>
          <button type="button" className="tab" role="tab" aria-selected={!demoMode} data-testid="tab-live" onClick={() => switchMode("real")}>{liveView === "codex" ? "Codex 辦公室" : "Bot自行回報"}</button>
        </div>
        {codexMode ? (
          <div className="tabs report-sources" role="group" aria-label="Codex 資料來源">
            <button type="button" className="play-btn" aria-pressed={dynamicMode} onClick={() => setCodexSource("dynamic")}>動態辦公室</button>
            <button type="button" className="play-btn" aria-pressed={!dynamicMode} onClick={() => setCodexSource("manual")}>自行回報</button>
          </div>
        ) : null}
        {dynamicMode ? <CodexAssignment /> : null}
      </div>
      {dynamicMode ? <CodexActivity sessions={activity.data} reducedMotion={reducedMotion} config={CODEX_SCENE_EGG} /> : <div className="shell">
        <section onKeyDown={onKeys}>
          {demoMode ? (
            <div className="floor-slot">
              <OfficeScene
                className="floor"
                agents={agents}
                selectedId={selectedId}
                onSelect={setSelectedId}
                config={SCENE_EGG}
                reducedMotion={reducedMotion}
              />
            </div>
          ) : shown ? (
            <div className="floor-slot">
              <OfficeScene
                className="floor"
                agents={shown.seats.map((seat) => seat.agent)}
                selectedId={selectedSeat?.agent.id}
                onSelect={setReportSelection}
                config={codexMode ? CODEX_SCENE_EGG : SCENE_EGG}
                reducedMotion={reducedMotion}
                playful={codexMode}
                seatStorageKey={codexMode ? "agent-office:seats:codex:manual" : undefined}
              />
            </div>
          ) : null}
          <p className="caption">
            {demoMode
              ? "方向鍵或數字鍵 1 到 4 可以換人。打盹只在明確閒置、而且資料還新鮮時出現。"
              : "沒有心跳，也不把逾時或漏報推成閒置。"}
          </p>
          {codexMode && shown ? <CompletionWall completions={shown.seats.flatMap(({ agent, jobs }) => jobs.flatMap((job) =>
            job.events.filter((event) => event.type === "task.completed").map((event) => ({
              key: `${agent.id}:${job.jobId}`, title: job.title, person: agent.name, at: event.at,
            })),
          ))} /> : null}
        </section>
        <aside className="side">
          {demoMode || !shown || !selectedSeat ? <SummaryPanel summary={summary} onSelect={demoMode ? setSelectedId : undefined} /> : <RealSummary model={shown} />}
          {demoMode || !selectedSeat ? <DetailPanel state={office} agentId={selectedId} /> : <RealDetail seat={selectedSeat} />}
        </aside>
      </div>}
      {demoMode ? <section className="sim" aria-label="模擬操作" data-testid="sim-panel">
        <h2>模擬操作</h2>
        <p className="hint">這些按鈕只會改這間示範辦公室，不會派工，也不會連到真實 Agent。</p>
        <div className="scenario-row">
          <button type="button" className="play-btn" data-testid="sim-play" aria-pressed={running} disabled={office.activeMode !== "demo"} onClick={togglePlay}>{running ? "暫停模擬" : "播放模擬"}</button>
          <button type="button" className="play-btn" data-testid="sim-reset" disabled={office.activeMode !== "demo"} onClick={() => resetScenario()}>重設這個情境</button>
          <label>
            模擬情境{" "}
            <select data-testid="scenario-select" value={scenario} disabled={office.activeMode !== "demo"} onChange={(event) => resetScenario(event.target.value as ScenarioId)}>
              {SCENARIOS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
            </select>
          </label>
          <span className="hint">{SCENARIOS.find((item) => item.id === scenario)?.hint}</span>
        </div>
        <p className="hint">模擬事件會送給：{office.activeMode === "demo" ? (DEMO_ROSTER.find((agent) => agent.id === selectedId)?.name ?? "尚未選擇") : "真實視圖不接受"}。腳本進度 {Math.min(indexRef.current, AUTOPLAY.length)}／{AUTOPLAY.length}。</p>
        {SIM_GROUPS.map((group) => (
          <div key={group.title} className="sim-row" style={{ marginTop: 8 }}>
            <strong>{group.title}</strong>
            {group.actions.map((action) => (
              <button key={action.id} type="button" className="sim-btn" data-testid={`sim-${action.id}`} disabled={office.activeMode !== "demo"} onClick={() => send(action.id)}>
                {action.label}
              </button>
            ))}
          </div>
        ))}
        {scriptNote ? <p className="notice" role="status">{scriptNote}</p> : null}
        {notice ? <p className="notice" role="status" data-testid="sim-notice">{notice}</p> : null}
      </section> : null}
      <footer className="foot">
        <p>{demoMode ? "完成或失敗都不會自己變成閒置。" : dynamicMode ? "啟動與結束來自 Codex Hook 或本機回報。任務結果來自子代理的明確回報。" : codexMode ? "證據類型 bot-self-report。回報逾時顯示離席，詳情保留最後已知工作和任務結果。" : shown?.partition === "fixture" ? "這一頁是夾具，不是四個受信任來源，也不能當成父層 Bot 的回報。" : "證據類型 bot-self-report。逾時後有效狀態是未知，最後已知的工作還留在詳情。不會自己補心跳或閒置。"}</p>
        {demoMode ? (
          <details>
            <summary>來源與時間設定</summary>
            <p>示範來源 {DEMO_SOURCE_ID}／{DEMO_STREAM_ID}。新鮮度門檻 {FRESHNESS_TTL_MS / 1000} 秒。閒置小動畫先等 {SCENE_EGG.easterEggIdleWaitMs / 1000} 秒，同一人至少隔 {SCENE_EGG.easterEggFrequencyCapMs / 1000} 秒，每次約 {SCENE_EGG.easterEggDurationMs / 1000} 秒。這些是這個示範自己的設定，不是官方保證。人物外形跟著座位，不跟著姓名。</p>
          </details>
        ) : null}
      </footer>
    </div>
  );
}

function evaluateFreshness(state: OfficeState, time: number): OfficeState {
  if (state.activeMode !== "demo") return state;
  return reducer(state, {
    type: "office.evaluate_freshness",
    eventId: `fresh-${time}`,
    mode: "demo",
    generation: state.generation,
    now: time,
    staleAfterMs: FRESHNESS_TTL_MS,
  });
}

function SummaryPanel({
  summary,
  onSelect,
}: {
  summary: ReturnType<typeof coreSummary>;
  onSelect?: (id: string) => void;
}) {
  const rows = [
    ["工作中", summary.counts.working],
    ["等待中", summary.counts.waiting],
    ["受阻", summary.counts.blocked],
    ["失敗", summary.counts.failed],
    ["已完成", summary.counts.completed],
    ["明確閒置", summary.counts.idle],
    ["未知", summary.counts.unknown],
  ] as const;
  return (
    <section className="panel" id="summary-panel" tabIndex={-1} data-testid="summary-panel" aria-label="監督總覽">
      <h2>監督總覽 <span className="stamp">唯讀</span></h2>
      <p className="hint">{summary.mode === "real" ? "沒有可彙整的真實代理人。" : `共 ${summary.totalAgents} 人。`}沒有派工。一個人只進一個欄位。</p>
      <dl className="counts">
        {rows.map(([label, value]) => (
          <div key={label}><dt>{label}</dt><dd>{value}</dd></div>
        ))}
      </dl>
      <p data-testid="unknown-breakdown">未知的組成：資料過期 {summary.stale.length}，連線中斷 {summary.disconnected.length}。</p>
      <NameList title="受阻" people={summary.blocked} onSelect={onSelect} />
      <NameList title="失敗" people={summary.failed} onSelect={onSelect} />
      <NameList title="未知" people={summary.unknown} onSelect={onSelect} />
      <NameList title="資料過期" people={summary.stale} onSelect={onSelect} />
      <NameList title="連線中斷" people={summary.disconnected} onSelect={onSelect} />
    </section>
  );
}

function NameList({
  title,
  people,
  onSelect,
}: {
  title: string;
  people: readonly AgentSnapshot[];
  onSelect?: (id: string) => void;
}) {
  if (people.length === 0) return null;
  return (
    <div>
      <strong>{title}</strong>
      <ul className="person-list">
        {people.map((person) => (
          <li key={`${title}-${person.agentId}`}>
            {onSelect ? (
              <button type="button" className="text-btn" onClick={() => onSelect(person.agentId)}>查看{person.label ?? person.agentId}</button>
            ) : (
              <span>{person.label ?? person.agentId}</span>
            )}
            <p>最後已知：{STATUS_ZH[person.lastKnownStatus as keyof typeof STATUS_ZH] ?? person.lastKnownStatus}・{person.lastKnownTask?.title ?? "沒有任務"}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}

function RealSummary({ model }: { model: RealViewModel }) {
  const rows = [
    ["工作中", model.counts.working],
    ["等待中", model.counts.waiting],
    ["受阻", model.counts.blocked],
    ["失敗", model.counts.failed],
    ["已完成", model.counts.completed],
    ["明確閒置", model.counts.idle],
    ["未知", model.counts.unknown],
  ] as const;
  return (
    <section className="panel" data-testid="summary-panel" aria-label="監督總覽">
      <h2>監督總覽 <span className="stamp">唯讀</span></h2>
      <p className="hint">共 {model.seats.length} 人。證據 {model.evidenceType}。沒有派工，沒有閒置推論。</p>
      <dl className="counts">
        {rows.map(([label, value]) => (
          <div key={label}><dt>{label}</dt><dd>{value}</dd></div>
        ))}
      </dl>
      <p data-testid="unknown-breakdown">未知的組成：資料過期 {model.stale}，連線中斷 {model.disconnected}。</p>
    </section>
  );
}

const TASK_EVENT_LABELS = {
  "task.started": "開始",
  "task.progress": "進度",
  "task.completed": "已完成",
  "task.failed": "失敗",
} as const;

function formatDuration(ms: number): string {
  if (ms > 0 && ms < 1_000) return `${ms} 毫秒`;
  const hours = Math.floor(ms / 3_600_000);
  const minutes = Math.floor(ms / 60_000) % 60;
  const seconds = Math.floor(ms / 1_000) % 60;
  return [hours ? `${hours} 小時` : "", minutes ? `${minutes} 分` : "", seconds ? `${seconds} 秒` : ""].filter(Boolean).join(" ") || "0 秒";
}

function TaskTimeline({ jobs }: { jobs: TaskHistory[] }) {
  return (
    <section className="task-timeline" aria-label="任務時間軸">
      <h3>任務時間軸</h3>
      {jobs.length === 0 ? <p className="hint">這個席位尚無任務事件。</p> : null}
      {jobs.map((job, index) => (
        <details key={job.jobId} open={index === 0}>
          <summary>
            {job.title} {job.durationMs == null ? null : <span className="timeline-duration">耗時 {formatDuration(job.durationMs)}</span>}
          </summary>
          <ol className="timeline-events">
            {job.events.map((event) => (
              <li key={event.eventId} title={event.acceptedAt == null ? undefined : `接收時間 ${formatReportTime(event.acceptedAt)}`}>
                <strong>{TASK_EVENT_LABELS[event.type]}</strong> <ReportTime at={event.at} />
                {event.taskTitle && event.taskTitle !== job.title ? <span className="timeline-event-title">{event.taskTitle}</span> : null}
              </li>
            ))}
          </ol>
        </details>
      ))}
    </section>
  );
}

function RealDetail({ seat }: { seat: SeatModel }) {
  const freshness = { fresh: "新鮮", stale: "已過期", none: "尚無回報" } as const;
  return (
    <section className="panel" data-testid="detail-panel" aria-label="席位詳情">
      <h2>席位詳情</h2>
      <p className="detail-status" data-testid="detail-status">{seat.agent.name}・{seat.effectiveLabel}</p>
      <p className="hint">{seat.agent.role}</p>
      <dl className="facts">
        <dt>身分</dt>
        <dd>{seat.agent.id}</dd>
        <dt>手上的事</dt>
        <dd>{seat.taskTitle}</dd>
        <dt>目前</dt>
        <dd>{seat.effectiveLabel}</dd>
        <dt>最後已知</dt>
        <dd>{seat.lastKnownLabel}</dd>
        <dt>任務結果</dt>
        <dd>{seat.outcomeLabel ?? "尚無結案回報"}</dd>
        <dt>回報新鮮度</dt>
        <dd>{seat.agent.deskPresence === "away" ? "回報逾時" : freshness[seat.reportFreshness]}</dd>
        <dt>回報時間</dt>
        <dd>{seat.reportedAt == null ? "還沒有時間" : <ReportTime at={seat.reportedAt} />}</dd>
        <dt>證據</dt>
        <dd>{seat.evidenceType}</dd>
        <dt>閒置小動畫</dt>
        <dd>不會出現</dd>
      </dl>
      <TaskTimeline key={seat.agent.id} jobs={seat.jobs} />
      <details className="dev-note">
        <summary>來源細節</summary>
        <p>{seat.provenanceText}</p>
      </details>
    </section>
  );
}

function DetailPanel({ state, agentId }: { state: OfficeState; agentId: string }) {
  const agent = state.activeMode === "demo" ? selectAgent(state, agentId) : null;
  return (
    <section className="panel" data-testid="detail-panel" aria-label="席位詳情">
      <h2>席位詳情</h2>
      {!agent ? (
        <p data-testid="detail-status">沒有可查看的真實代理人。</p>
      ) : (
        <>
          <p className="detail-status" data-testid="detail-status">{agent.label}・{STATUS_ZH[agent.effectiveStatus]}</p>
          <p className="hint">{DEMO_ROSTER.find((person) => person.id === agent.agentId)?.role}</p>
          <dl className="facts">
            <dt>手上的事</dt>
            <dd>{agent.lastKnownTask?.title ?? "沒有任務"}（{STATUS_ZH[agent.lastKnownStatus]}）</dd>
            <dt>連線</dt>
            <dd>{agent.link === "up" ? "已連線" : "已中斷，人還在座位上"}</dd>
            <dt>新鮮度</dt>
            <dd>{agent.freshness === "fresh" ? "新鮮" : "已過期，目前未知"}</dd>
            <dt>閒置小動畫</dt>
            <dd>{personalEgg(state, agent.agentId) ? "可能出現" : "不會出現"}</dd>
          </dl>
          <details className="dev-note">
            <summary>來源細節</summary>
            <p>{agent.statusProvenance ? `${agent.statusProvenance.sourceId}／${agent.statusProvenance.streamId}・序號 ${agent.statusProvenance.seq}・${formatReportTime(agent.statusProvenance.at)}` : "還沒有狀態事件。"}</p>
            <p>{officeEgg(state) ? "目前沒有人在工作、等待、受阻、失敗或剛完成。" : "還有人在做事或剛做完，所以不會全員一起進入閒置。"}</p>
          </details>
        </>
      )}
    </section>
  );
}
