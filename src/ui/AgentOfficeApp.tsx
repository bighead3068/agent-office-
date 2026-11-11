import { useRef, useState, useSyncExternalStore } from "react"
import {
  AUTOPLAY,
  AUTOPLAY_STEP_MS,
  SCENARIOS,
  createScenario,
  dispatchSim,
  sceneAgents,
  type ScenarioId,
  type SimAction,
} from "../adapters/officeAdapter"
import { projectOfficeState } from "../adapters/selfReport"
import type { OfficeState } from "../core/agent-core"
import type { DeskAgent } from "../office/summaryOrder"
import { OfficeFloor } from "./OfficeFloor"
import { ConnectionNotice, useSnapshot } from "./reportConnection"

function useSearch(): string {
  return useSyncExternalStore(
    (callback) => {
      window.addEventListener("popstate", callback)
      return () => window.removeEventListener("popstate", callback)
    },
    () => window.location.search,
    () => "",
  )
}

export function AgentOfficeApp() {
  const demo = new URLSearchParams(useSearch()).get("view") === "demo"
  return demo ? <DemoOffice /> : <RealOffice />
}

function lostConnection(agents: DeskAgent[]): DeskAgent[] {
  return agents.map((agent) => ({
    ...agent,
    lastKnownStatus: agent.effectiveStatus === "unknown" ? agent.lastKnownStatus : agent.effectiveStatus,
    effectiveStatus: "unknown",
    freshness: agent.freshness === "none" ? "none" : "stale",
  }))
}

function RealOffice() {
  const snapshot = useSnapshot(true, "/api/state", projectOfficeState)
  const [selectedId, setSelectedId] = useState(() => (typeof window === "undefined" ? "" : new URLSearchParams(window.location.search).get("seat") ?? ""))
  const loaded = snapshot.data?.agents ?? []
  const agents = snapshot.error ? lostConnection(loaded) : loaded
  return (
    <div className="office-page" data-view="real" data-partition="real">
      <header className="topbar">
        <h1>代理人辦公室</h1>
        <p className="mode-badge mode-real" role="status" data-testid="mode-banner">真實</p>
        <ConnectionNotice snapshot={snapshot} emptyText="沒有回報不是閒置。" />
      </header>
      <p className="sr-only">看泡泡就知道誰在做事、誰卡住、誰做完、誰未知。</p>
      <OfficeFloor
        agents={agents}
        selectedId={selectedId}
        onSelect={setSelectedId}
        now={snapshot.data?.serverNow}
        sourceLabel="Bot自行回報"
      />
    </div>
  )
}

const SIM_ACTIONS: { id: SimAction; label: string }[] = [
  { id: "work", label: "開始工作" },
  { id: "wait", label: "等待" },
  { id: "block", label: "受阻" },
  { id: "fail", label: "失敗" },
  { id: "complete", label: "完成" },
  { id: "idle", label: "明確閒置" },
  { id: "expire", label: "資料過期" },
]

const BOARD: DeskAgent[] = [
  { agentId: "coord", name: "Agent Office 協調", seat: 0, effectiveStatus: "working", lastKnownStatus: "working", freshness: "fresh", taskTitle: "排今天的會議並且把每個人的下一件事寫成一行很長的標題", terminalAt: null, lastReportAt: 1_700_000_000_000, reason: "report" },
  { agentId: "dev", name: "Agent Office 開發", seat: 1, effectiveStatus: "waiting", lastKnownStatus: "waiting", freshness: "fresh", taskTitle: "等編譯結果，這行也刻意寫得很長以免相鄰座位的任務條疊在一起", terminalAt: null, lastReportAt: 1_700_000_000_000, reason: "report" },
  { agentId: "des", name: "Agent Office 設計", seat: 2, effectiveStatus: "blocked", lastKnownStatus: "blocked", freshness: "fresh", taskTitle: "等色票", terminalAt: null, lastReportAt: 1_700_000_000_000, reason: "report" },
  { agentId: "qa", name: "測試助手", seat: 3, effectiveStatus: "failed", lastKnownStatus: "failed", freshness: "fresh", taskTitle: "測試紅了", terminalAt: 1_700_000_000_000, lastReportAt: 1_700_000_000_000, reason: "report" },
  { agentId: "done", name: "完工", seat: 4, effectiveStatus: "completed", lastKnownStatus: "completed", freshness: "fresh", taskTitle: "交卷", terminalAt: 1_699_999_000_000, lastReportAt: 1_699_999_000_000, reason: "report" },
  { agentId: "miss", name: "過期席", seat: 5, effectiveStatus: "unknown", lastKnownStatus: "completed", freshness: "stale", taskTitle: "上次的交卷", terminalAt: 1_699_994_000_000, lastReportAt: 1_699_994_000_000, reason: "ttl" },
  { agentId: "off", name: "離線", seat: 6, effectiveStatus: "offline", lastKnownStatus: "offline", freshness: "fresh", taskTitle: "不在座位", terminalAt: null, lastReportAt: 1_699_990_000_000, reason: "disconnect", disconnected: true },
  { agentId: "nap", name: "閒置", seat: 7, effectiveStatus: "idle", lastKnownStatus: "idle", freshness: "fresh", taskTitle: "明確閒置", terminalAt: null, lastReportAt: 1_700_000_000_000, reason: "report" },
]

function DemoOffice() {
  const cast = new URLSearchParams(useSearch()).get("cast")
  const boot = useRef({ now: Date.now(), nonce: 1 })
  const [office, setOffice] = useState<OfficeState>(() => createScenario("opening", boot.current.now))
  const [scenario, setScenario] = useState<ScenarioId>("opening")
  const [selectedId, setSelectedId] = useState("lin")
  const [notice, setNotice] = useState<string | null>(null)
  const nonce = useRef(10)

  function load(next: ScenarioId) {
    const time = Date.now()
    setScenario(next)
    setOffice(createScenario(next, time))
    setNotice(null)
  }

  function send(action: SimAction) {
    const time = Date.now()
    const result = dispatchSim(office, selectedId, action, time, nonce.current)
    nonce.current += 1
    setOffice(result.state)
    setNotice(result.notice)
  }

  const agents = sceneAgents(office).map(toDesk)
  return (
    <div className="office-page" data-view="demo" data-partition="demo">
      <header className="topbar">
        <h1>代理人辦公室</h1>
        <p className="mode-badge mode-demo" role="status" data-testid="mode-banner"><span data-testid="demo-badge">模擬</span></p>
        <p className="live-callout">未連接真實 Agent</p>
      </header>
      <p className="sr-only">看泡泡就知道誰在做事、誰卡住、誰做完、誰未知。這頁是模擬。</p>
      {cast === "board"
        ? <OfficeFloor agents={BOARD} selectedId={selectedId} onSelect={setSelectedId} demo sourceLabel="模擬" now={1_700_000_000_000} />
        : <OfficeFloor agents={agents} selectedId={selectedId} onSelect={setSelectedId} demo sourceLabel="模擬" />}
      {cast === "board" ? null : (
      <details className="sim" data-testid="sim-panel">
        <summary>模擬操作</summary>
        <p className="hint">只改這間示範辦公室。不會寫進真實接收器。</p>
        <label>
          情境{" "}
          <select data-testid="scenario-select" value={scenario} onChange={(event) => load(event.target.value as ScenarioId)}>
            {SCENARIOS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
          </select>
        </label>
        <div className="sim-row">
          {SIM_ACTIONS.map((action) => (
            <button key={action.id} type="button" className="sim-btn" data-testid={`sim-${action.id}`} onClick={() => send(action.id)}>
              {action.label}
            </button>
          ))}
        </div>
        {notice ? <p className="notice" data-testid="sim-notice">{notice}</p> : null}
        <p className="hint">腳本長度 {AUTOPLAY.length}，每步 {AUTOPLAY_STEP_MS / 1000} 秒。這頁不會讀取真實座位。</p>
      </details>
      )}
    </div>
  )
}

function toDesk(agent: ReturnType<typeof sceneAgents>[number], index: number): DeskAgent {
  const at = agent.lastUpdatedAt ? Date.parse(agent.lastUpdatedAt) : null
  const status = agent.status
  return {
    agentId: agent.id,
    name: agent.name,
    seat: index,
    effectiveStatus: status,
    lastKnownStatus: agent.lastKnownStatus ?? agent.status,
    freshness: agent.freshness,
    taskTitle: agent.task?.title ?? "",
    terminalAt: agent.lastKnownStatus === "completed" || agent.lastKnownStatus === "failed" || agent.status === "completed" || agent.status === "failed" ? at : null,
    lastReportAt: at,
    reason: agent.freshness === "stale" ? "ttl" : "report",
    disconnected: !agent.connected,
  }
}
