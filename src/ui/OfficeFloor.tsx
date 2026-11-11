import { STATUS_LABEL, countDesks, shortName, sortDesks, type DeskAgent } from "../office/summaryOrder"
import { formatReportTime } from "./reportConnection"
import "./OfficeFloor.css"

const SHIRTS = ["#3f8f6b", "#d07a3a", "#7d6bb5", "#c45c5c", "#3d7ea6"]
const HAIR = ["#3b291c", "#8a4b2f", "#1d1a24", "#c9842a", "#4a3428"]

function PixelPerson({ index, dim }: { index: number; dim: boolean }) {
  const shirt = SHIRTS[index % SHIRTS.length] ?? "#3f8f6b"
  const hair = HAIR[index % HAIR.length] ?? "#3b291c"
  return (
    <svg className="pixel-person" width="72" height="84" viewBox="0 0 16 20" shapeRendering="crispEdges" aria-hidden="true" opacity={dim ? 0.55 : 1}>
      <rect x="4" y="1" width="8" height="3" fill={hair} />
      <rect x="5" y="3" width="6" height="5" fill="#f0c29a" />
      <rect x="6" y="5" width="1" height="1" fill="#2b211c" />
      <rect x="9" y="5" width="1" height="1" fill="#2b211c" />
      <rect x="3" y="8" width="10" height="6" fill={shirt} />
      <rect x="2" y="8" width="2" height="4" fill="#e0aa78" />
      <rect x="12" y="8" width="2" height="4" fill="#e0aa78" />
      <rect x="5" y="14" width="2" height="4" fill="#5c4636" />
      <rect x="9" y="14" width="2" height="4" fill="#5c4636" />
      <rect x="4" y="18" width="3" height="1" fill="#3b291c" />
      <rect x="9" y="18" width="3" height="1" fill="#3b291c" />
    </svg>
  )
}

function Plant() {
  return (
    <svg viewBox="0 0 14 18" width="28" height="36" shapeRendering="crispEdges" aria-hidden="true">
      <rect x="6" y="8" width="2" height="8" fill="#6b8f4e" />
      <rect x="2" y="4" width="4" height="4" fill="#7eaa55" />
      <rect x="8" y="3" width="4" height="4" fill="#648a42" />
      <rect x="5" y="1" width="4" height="3" fill="#8fbf63" />
      <rect x="4" y="16" width="6" height="2" fill="#a96b3c" />
    </svg>
  )
}

function bubbleText(agent: DeskAgent): string {
  const label = STATUS_LABEL[agent.effectiveStatus] ?? "未知"
  if (agent.freshness === "stale") return `${label}・過期`
  return label
}

function completedTime(agent: DeskAgent): string | null {
  if (agent.effectiveStatus !== "completed" && agent.lastKnownStatus !== "completed") return null
  if (agent.terminalAt == null || !Number.isFinite(agent.terminalAt)) return null
  return formatReportTime(agent.terminalAt)
}

export function OfficeFloor({
  agents,
  selectedId,
  onSelect,
  demo = false,
}: {
  agents: readonly DeskAgent[]
  selectedId?: string
  onSelect?: (id: string) => void
  demo?: boolean
}) {
  const counts = countDesks(agents)
  const glance = [
    ["working", "工作中"],
    ["blocked", "受阻"],
    ["failed", "失敗"],
    ["completed", "已完成"],
    ["unknown", "未知"],
  ] as const
  const ordered = [...agents].sort((left, right) => left.seat - right.seat || left.agentId.localeCompare(right.agentId))
  const summary = sortDesks(agents)

  return (
    <div className={demo ? "office-v2 demo-office" : "office-v2"} data-view={demo ? "demo" : "real"}>
      <div className="floor-column">
        {demo ? <p className="demo-badge" data-testid="demo-badge">DEMO</p> : null}
        <ul className="glance" aria-label="狀態一眼">
          {glance.map(([status, label]) => (
            <li key={status} data-glance={status}>
              <span>{label}</span>
              <strong>{counts[status] ?? 0}</strong>
            </li>
          ))}
        </ul>
        <div className="floor-wood" data-testid="office-floor">
          <span className="plant plant-left"><Plant /></span>
          <span className="plant plant-right"><Plant /></span>
          {ordered.length === 0 ? (
            <div className="empty-floor">
              <strong>還沒有登記 bot</strong>
              <p>空著的辦公室不是閒置，也還沒有未知以外的狀態。</p>
            </div>
          ) : (
            <div className="desk-grid">
              {ordered.map((agent) => {
                const time = completedTime(agent)
                const title = agent.taskTitle || (agent.effectiveStatus === "unknown" ? "尚未回報" : "沒有任務標題")
                return (
                  <button
                    key={agent.agentId}
                    type="button"
                    className="desk"
                    data-testid={`agent-${agent.agentId}`}
                    data-agent-id={agent.agentId}
                    data-seat={`S${agent.seat + 1}`}
                    data-status={agent.effectiveStatus}
                    data-freshness={agent.freshness}
                    aria-pressed={agent.agentId === selectedId}
                    title={agent.name}
                    onClick={() => onSelect?.(agent.agentId)}
                  >
                    <span className={`bubble bubble-${agent.effectiveStatus}${agent.freshness === "stale" ? " bubble-stale" : ""}`} data-bubble={agent.effectiveStatus}>
                      {bubbleText(agent)}
                      {time ? <small>{time}</small> : null}
                    </span>
                    <PixelPerson index={agent.seat} dim={agent.effectiveStatus === "unknown" || agent.freshness === "stale"} />
                    {agent.effectiveStatus === "idle" && agent.freshness === "fresh" ? <span className="egg">咖啡</span> : null}
                    <p className="task-line">{title}</p>
                    <span className="nameplate">{shortName(agent.name)}</span>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      </div>
      <aside className="summary-dock" data-testid="summary-panel" aria-label="監督總覽">
        <h2>監督總覽</h2>
        <p className="hint">受阻、失敗、工作中、等待中、已完成、未知。一共 {agents.length} 人。</p>
        <ol className="summary-list">
          {summary.map((agent) => (
            <li key={agent.agentId}>
              <button type="button" className="summary-row" onClick={() => onSelect?.(agent.agentId)}>
                <span className={`dot dot-${agent.effectiveStatus}`} />
                <b title={agent.name}>{shortName(agent.name)}</b>
                <span>
                  <em>{STATUS_LABEL[agent.effectiveStatus] ?? "未知"}{agent.freshness === "stale" ? "・過期" : ""}</em>
                  <span className="summary-task">{agent.taskTitle || "尚未回報"}{completedTime(agent) ? ` ${completedTime(agent)}` : ""}</span>
                </span>
              </button>
            </li>
          ))}
        </ol>
      </aside>
    </div>
  )
}
