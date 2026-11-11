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

function RealOffice() {
  const snapshot = useSnapshot(true, "/api/state", projectOfficeState)
  const [selectedId, setSelectedId] = useState(() => (typeof window === "undefined" ? "" : new URLSearchParams(window.location.search).get("seat") ?? ""))
  const agents = snapshot.data?.agents ?? []
  return (
    <div className="office-page" data-view="real" data-partition="real">
      <header className="topbar">
        <h1>代理人辦公室</h1>
        <p className="mode-badge mode-real" role="status" data-testid="mode-banner">真實</p>
        <ConnectionNotice snapshot={snapshot} emptyText="沒有回報不是閒置。" />
      </header>
      <p className="tagline">看泡泡就知道誰在做事、誰卡住、誰做完、誰未知。</p>
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

function DemoOffice() {
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
      <p className="tagline">看泡泡就知道誰在做事、誰卡住、誰做完、誰未知。這頁是模擬。</p>
      <OfficeFloor agents={agents} selectedId={selectedId} onSelect={setSelectedId} demo sourceLabel="模擬" />
      <section className="sim" aria-label="模擬操作" data-testid="sim-panel">
        <h2>模擬操作</h2>
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
      </section>
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
    terminalAt: agent.status === "completed" || agent.status === "failed" ? at : null,
    lastReportAt: at,
    reason: agent.freshness === "stale" ? "ttl" : "report",
    disconnected: !agent.connected,
  }
}
