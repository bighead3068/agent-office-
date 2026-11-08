import { useEffect, useRef, useState, type KeyboardEvent } from "react";
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

const STATUS_ZH = {
  working: "工作中",
  waiting: "等待中",
  blocked: "受阻",
  failed: "失敗",
  completed: "已完成",
  idle: "明確閒置",
  unknown: "未知",
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

const taipei = new Intl.DateTimeFormat("zh-TW", {
  timeZone: "Asia/Taipei",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

export function AgentOfficeApp() {
  const boot = useRef({ now: Date.now(), nonce: 1 });
  const [now, setNow] = useState(boot.current.now);
  const [office, setOffice] = useState<OfficeState>(() => createScenario("opening", boot.current.now));
  const [scenario, setScenario] = useState<ScenarioId>("opening");
  const [selectedId, setSelectedId] = useState("lin");
  const [notice, setNotice] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [scriptNote, setScriptNote] = useState<string | null>(null);
  const [reducedMotion, setReducedMotion] = useState(false);
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

  function onKeys(event: KeyboardEvent) {
    if (office.activeMode !== "demo") return;
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
        <div>
          <p className="kicker">Agent Office 0.1</p>
          <h1>代理人辦公室</h1>
          <p className="lede">
            {demoMode
              ? "四位示範代理人坐在固定座位。點一個人，就能看到手上的事，以及你現在還掌握得住什麼。"
              : "真實來源尚未連接。這裡沒有代理人，也沒有事件。"}
          </p>
        </div>
        <p className={demoMode ? "banner" : "banner banner-real"} role="status" data-testid="mode-banner">
          {demoMode ? "模擬資料・未連接真實 Agent" : "真實資料・未連接"}
        </p>
      </header>
      <div className="tabs" role="tablist" aria-label="資料模式">
        <button type="button" className="tab" role="tab" aria-selected={demoMode} data-testid="tab-demo" onClick={() => switchMode("demo")}>示範辦公室</button>
        <button type="button" className="tab" role="tab" aria-selected={!demoMode} data-testid="tab-live" onClick={() => switchMode("real")}>真實資料（未連接）</button>
      </div>
      {demoMode ? null : (
        <p className="live-callout" data-testid="live-empty">尚未連接。沒有可顯示的人，也沒有事件。</p>
      )}
      <div className="shell">
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
          ) : (
            <div className="live-floor" data-testid="live-floor">
              <p>沒有座位上的人</p>
              <p>連上真實來源之前，這裡保持空白。</p>
            </div>
          )}
          <p className="caption">
            {demoMode
              ? "方向鍵或數字鍵 1 到 4 可以換人。打盹只在明確閒置、而且資料還新鮮時出現。"
              : "這個畫面不顯示示範座位。"}
          </p>
        </section>
        <aside className="side">
          <SummaryPanel summary={summary} onSelect={demoMode ? setSelectedId : undefined} />
          <DetailPanel state={office} agentId={selectedId} />
        </aside>
      </div>
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
        <p>{demoMode ? "完成或失敗都不會自己變成閒置。" : "尚未連接真實資料。"}</p>
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
            <p>{agent.statusProvenance ? `${agent.statusProvenance.sourceId}／${agent.statusProvenance.streamId}・序號 ${agent.statusProvenance.seq}・${taipei.format(new Date(agent.statusProvenance.at))}（台北）` : "還沒有狀態事件。"}</p>
            <p>{officeEgg(state) ? "目前沒有人在工作、等待、受阻、失敗或剛完成。" : "還有人在做事或剛做完，所以不會全員一起進入閒置。"}</p>
          </details>
        </>
      )}
    </section>
  );
}
