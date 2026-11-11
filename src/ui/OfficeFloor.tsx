import { useEffect, useState } from "react"
import {
  ATTENTION_ORDER,
  COUNT_CELLS,
  STATUS_LABEL,
  attentionAgents,
  elapsedLabel,
  plateName,
  tallyDesks,
  type DeskAgent,
} from "../office/summaryOrder"
import { formatReportTime } from "./reportConnection"
import "./OfficeFloor.css"

const TILE = 16
const COLUMNS = 22
const ROWS = 16
const SEAT_CAP = 8
const ATTENTION_CAP = 4

const SEATS = [
  { id: "A1", x: 2, y: 5 },
  { id: "A2", x: 7, y: 5 },
  { id: "A3", x: 12, y: 5 },
  { id: "A4", x: 17, y: 5 },
  { id: "B1", x: 2, y: 12 },
  { id: "B2", x: 7, y: 12 },
  { id: "B3", x: 12, y: 12 },
  { id: "B4", x: 17, y: 12 },
] as const

const SHIRTS = ["#3E8ED0", "#E5A41F", "#5AA552", "#D9483B", "#7B6FA8", "#3F7A35", "#8A5A2B", "#6E5440"]

function useTier(): "x3" | "x2" | "compact" {
  const [size, setSize] = useState(() => (
    typeof window === "undefined"
      ? { width: 1440, height: 900 }
      : { width: window.innerWidth, height: window.innerHeight }
  ))
  useEffect(() => {
    const apply = () => setSize({ width: window.innerWidth, height: window.innerHeight })
    apply()
    window.addEventListener("resize", apply)
    return () => window.removeEventListener("resize", apply)
  }, [])
  if (size.width >= 1400 && size.height >= 900) return "x3"
  if (size.width >= 1024) return "x2"
  return "compact"
}

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false)
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)")
    const apply = () => setReduced(media.matches)
    apply()
    media.addEventListener("change", apply)
    return () => media.removeEventListener("change", apply)
  }, [])
  return reduced
}

function PixelPerson({ index, muted, tall }: { index: number; muted: boolean; tall: number }) {
  const shirt = SHIRTS[index % SHIRTS.length] ?? "#3E8ED0"
  return (
    <svg className={muted ? "pixel-person is-muted" : "pixel-person"} viewBox="0 0 16 20" style={{ height: tall, width: Math.round(tall * 0.8) }} shapeRendering="crispEdges" aria-hidden="true">
      <rect x="4" y="1" width="8" height="3" fill="#3B2A20" />
      <rect x="5" y="3" width="6" height="5" fill="#F0C29A" />
      <rect x="6" y="5" width="1" height="1" fill="#3B2A20" />
      <rect x="9" y="5" width="1" height="1" fill="#3B2A20" />
      <rect x="3" y="8" width="10" height="6" fill={shirt} />
      <rect x="2" y="8" width="2" height="4" fill="#E0AA78" />
      <rect x="12" y="8" width="2" height="4" fill="#E0AA78" />
      <rect x="5" y="14" width="2" height="4" fill="#5C4636" />
      <rect x="9" y="14" width="2" height="4" fill="#5C4636" />
    </svg>
  )
}

function StatusIcon({ status }: { status: string }) {
  if (status === "working") {
    return (
      <svg className="bubble-icon gear" viewBox="0 0 20 20" aria-hidden="true">
        <circle cx="10" cy="10" r="3" fill="currentColor" />
        <path fill="currentColor" d="M9 1h2v3h-2zm0 15h2v3h-2zM1 9h3v2H1zm15 0h3v2h-3zM3.5 3.5l2 2-1.4 1.4-2-2zm12.4 12.4 2 2-1.4 1.4-2-2zM3.5 16.5l1.4-1.4 2 2-1.4 1.4zM15.1 4.9l1.4-1.4 2 2-1.4 1.4z" />
      </svg>
    )
  }
  if (status === "waiting") {
    return (
      <svg className="bubble-icon" viewBox="0 0 20 20" aria-hidden="true">
        <path fill="currentColor" d="M5 2h10v2H5zm1 3h8l-4 4 4 4H6l4-4zm-1 10h10v2H5z" />
      </svg>
    )
  }
  if (status === "failed") {
    return <span className="bubble-icon glyph" aria-hidden="true">✕</span>
  }
  if (status === "completed") {
    return (
      <svg className="bubble-icon" viewBox="0 0 20 20" aria-hidden="true">
        <path fill="currentColor" d="M4 10.5 8 14.5 16 5.5l1.5 1.4L8 17.5 2.5 12z" />
      </svg>
    )
  }
  if (status === "unknown") {
    return <span className="bubble-icon glyph" aria-hidden="true">?</span>
  }
  if (status === "offline") {
    return (
      <svg className="bubble-icon" viewBox="0 0 20 20" aria-hidden="true">
        <path fill="currentColor" d="M7 2h6v4h4v2H11v2h5v2H4v-2h5V8H3V6h4z" />
      </svg>
    )
  }
  if (status === "idle") return <span className="bubble-icon glyph" aria-hidden="true">—</span>
  return <span className="bubble-icon glyph" aria-hidden="true">!</span>
}

const PREVIOUS_WORD: Record<string, string> = {
  completed: "完成",
  failed: "失敗",
  blocked: "受阻",
  working: "工作中",
  waiting: "等待",
  idle: "閒置",
  offline: "離線",
}

function previousLine(agent: DeskAgent): string | null {
  if (agent.freshness !== "stale") return null
  const word = agent.lastKnownStatus ? PREVIOUS_WORD[agent.lastKnownStatus] : undefined
  return word ? `上次：${word}` : null
}

function bubbleCopy(agent: DeskAgent, now: number): string {
  if (agent.freshness === "stale") return "未知"
  if (agent.effectiveStatus === "completed") {
    const ago = elapsedLabel(agent.terminalAt, now)
    return ago ? `完成 · ${ago}` : "完成"
  }
  if (agent.effectiveStatus === "idle") return "閒置"
  if (agent.effectiveStatus === "failed") return "失敗"
  if (agent.effectiveStatus === "blocked") return "受阻"
  if (agent.effectiveStatus === "offline") return "離線"
  return STATUS_LABEL[agent.effectiveStatus] ?? "未知"
}

function SceneArt() {
  return (
    <svg className="scene-art" viewBox="0 0 22 16" shapeRendering="crispEdges" aria-hidden="true">
      <rect width="22" height="4.2" fill="#E8D5A8" />
      <rect y="4.2" width="22" height="0.35" fill="#8A5A2B" />
      <rect y="4.55" width="22" height="11.45" fill="#C8945A" />
      <rect x="0" y="6" width="22" height="0.08" fill="#A86E3C" />
      <rect x="0" y="9" width="22" height="0.08" fill="#A86E3C" />
      <rect x="0" y="12" width="22" height="0.08" fill="#A86E3C" />
      <rect x="1" y="0.6" width="3" height="2.2" fill="#FFE9A8" stroke="#8A5A2B" strokeWidth="0.12" />
      <rect x="8" y="0.6" width="3" height="2.2" fill="#FFE9A8" stroke="#8A5A2B" strokeWidth="0.12" />
      <rect x="14.2" y="0.5" width="2.4" height="3.2" fill="#8A5A2B" />
      <rect x="14.45" y="0.8" width="1.9" height="0.45" fill="#5AA552" />
      <rect x="14.45" y="1.45" width="1.9" height="0.45" fill="#3E8ED0" />
      <rect x="14.45" y="2.1" width="1.9" height="0.45" fill="#E5A41F" />
      <rect x="0.4" y="1.2" width="0.35" height="1.5" fill="#3F7A35" />
      <rect x="0.15" y="0.7" width="0.9" height="0.7" fill="#5E9E4A" />
      <rect x="20.6" y="15.15" width="1.2" height="0.7" fill="#B8574A" />
      <rect x="20.75" y="14.85" width="0.45" height="0.35" fill="#FFF6DD" stroke="#3B2A20" strokeWidth="0.06" />
    </svg>
  )
}

function DetailCard({
  agent,
  stamp,
  demo,
  sourceLabel,
}: {
  agent: DeskAgent
  stamp: number
  demo: boolean
  sourceLabel: string
}) {
  const previous = previousLine(agent)
  return (
    <article className="detail-card" data-testid="detail-card">
      <h3>{agent.name}</h3>
      <p className="detail-task">{agent.taskTitle || "尚未回報"}</p>
      <p>{bubbleCopy(agent, stamp)}{previous ? ` · ${previous}` : ""}</p>
      <p className="detail-meta">來源 {demo ? "模擬" : sourceLabel}</p>
      <p className="detail-meta">{agent.lastReportAt == null && agent.terminalAt == null ? "尚未更新" : formatReportTime((agent.lastReportAt ?? agent.terminalAt) as number)}</p>
    </article>
  )
}

export function OfficeFloor({
  agents,
  selectedId,
  onSelect,
  demo = false,
  now,
  sourceLabel = "Bot自行回報",
}: {
  agents: readonly DeskAgent[]
  selectedId?: string
  onSelect?: (id: string) => void
  demo?: boolean
  now?: number | null
  sourceLabel?: string
}) {
  const tier = useTier()
  const reduced = useReducedMotion()
  const scale = tier === "x3" ? 3 : 2
  const panelWidth = tier === "x2" ? 288 : 320
  const compact = tier === "compact"
  const [moreOpen, setMoreOpen] = useState(false)
  const stamp = now ?? Date.now()
  const tally = tallyDesks(agents)
  const attention = attentionAgents(agents)
  const visibleAttention = attention.slice(0, ATTENTION_CAP)
  const hiddenAttention = attention.slice(ATTENTION_CAP)
  const bySeat = new Map(agents.filter((agent) => agent.seat >= 0 && agent.seat < SEAT_CAP).map((agent) => [agent.seat, agent]))
  const selected = agents.find((agent) => agent.agentId === selectedId) ?? null
  const sceneStyle = { width: COLUMNS * TILE * scale, height: ROWS * TILE * scale }

  function choose(id: string) {
    onSelect?.(id)
    setMoreOpen(false)
  }

  const counts = (
    <ul className="count-row" aria-label="狀態人數">
      {COUNT_CELLS.map((cell) => {
        const value = tally.cells[cell.id]
        return (
          <li key={cell.id} className={value === 0 ? "count-cell is-zero" : "count-cell"} data-count={cell.id}>
            <span className={`count-bar count-${cell.id}`} />
            <strong>{value}</strong>
            <span>{cell.label}</span>
          </li>
        )
      })}
    </ul>
  )

  const attentionBlock = (
    <div className="attention">
      <h3>需要注意</h3>
      <ol className="attention-list">
        {visibleAttention.map((agent) => (
          <li key={agent.agentId}>
            <button type="button" className="attention-row" onClick={() => choose(agent.agentId)}>
              <span className={`count-bar attention-bar count-${agent.effectiveStatus === "failed" ? "stuck" : agent.effectiveStatus === "waiting" ? "waiting" : "stuck"}`} />
              <b title={agent.name}>{plateName(agent.name)}</b>
              <span className="attention-word">{agent.effectiveStatus === "blocked" ? "受阻" : agent.effectiveStatus === "failed" ? "失敗" : "等待"}</span>
              <span className="attention-task">{agent.taskTitle || "尚未回報"}</span>
              <em>{elapsedLabel(agent.lastReportAt, stamp)}</em>
            </button>
          </li>
        ))}
      </ol>
      {hiddenAttention.length > 0 ? (
        <button type="button" className="more-btn" data-testid="attention-more" onClick={() => setMoreOpen(true)}>
          +{hiddenAttention.length} 個
        </button>
      ) : null}
    </div>
  )

  const summary = (
    <aside className="summary-dock" data-testid="summary-panel" aria-label="主管摘要" style={compact ? undefined : { width: panelWidth }}>
      <h2>主管摘要（唯讀）</h2>
      {counts}
      {compact ? (
        <button type="button" className="more-btn" onClick={() => setMoreOpen(true)}>
          需要注意 {attention.length}
        </button>
      ) : attentionBlock}
      <p className="summary-secondary" data-testid="summary-secondary">
        閒置 {tally.idle} · 離線 {tally.offline} · 過期 {tally.stale} · 未入座 {tally.unseated}
      </p>
      <p className="summary-foot">資料來源：{demo ? "模擬" : "Bot自行回報（非平台原生）"} · 更新 {new Intl.DateTimeFormat("zh-TW", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "Asia/Taipei" }).format(stamp)}</p>
      {selected ? <DetailCard agent={selected} stamp={stamp} demo={demo} sourceLabel={sourceLabel} /> : null}
      <p className="sr-only" data-testid="summary-total">共 {tally.total} 人，分格加總 {tally.cells.stuck + tally.cells.working + tally.cells.waiting + tally.cells.completed + tally.cells.unknown + tally.idle + tally.offline}</p>
    </aside>
  )

  return (
    <div className={demo ? "office-v2 is-demo" : "office-v2"} data-view={demo ? "demo" : "real"} data-tier={tier} data-reduced={reduced ? "true" : "false"}>
      <div className="scene-wrap">
        <div className="scene" data-testid="office-floor" data-scale={scale} style={sceneStyle}>
          <SceneArt />
          {SEATS.map((slot, index) => {
            const agent = bySeat.get(index) ?? null
            const unit = TILE * scale
            const headOverflow = scale === 3 ? 24 : 16
            const charH = 2 * unit + headOverflow
            const bubbleTop = -(36 + 4 + 24 + 6 + headOverflow)
            const taskTop = bubbleTop + 36 + 4
            const taskW = Math.min(216, 5 * unit - 16)
            return (
              <div
                key={slot.id}
                className="seat-slot"
                data-seat={slot.id}
                data-testid={agent ? `agent-${agent.agentId}` : undefined}
                data-status={agent?.effectiveStatus}
                data-freshness={agent?.freshness}
                style={{ left: slot.x * unit, top: slot.y * unit, width: 3 * unit, height: 2 * unit }}
              >
                {agent ? (
                  <>
                    <button
                      type="button"
                      className={`bubble bubble-${agent.freshness === "stale" ? "unknown" : agent.effectiveStatus}`}
                      data-bubble={agent.freshness === "stale" ? "unknown" : agent.effectiveStatus}
                      style={{ top: bubbleTop, maxWidth: taskW }}
                      onClick={() => choose(agent.agentId)}
                    >
                      <StatusIcon status={agent.freshness === "stale" ? "unknown" : agent.effectiveStatus} />
                      {agent.effectiveStatus === "working" && agent.freshness !== "stale" ? <span className="work-dots" aria-hidden="true"><i /><i /><i /></span> : null}
                      <span>{bubbleCopy(agent, stamp)}{previousLine(agent) ? ` ${previousLine(agent)}` : ""}</span>
                    </button>
                    <button
                      type="button"
                      className="desk-hit"
                      data-agent-id={agent.agentId}
                      aria-pressed={agent.agentId === selectedId}
                      title={agent.name}
                      onClick={() => choose(agent.agentId)}
                    >
                      <PixelPerson index={index} muted={agent.effectiveStatus === "unknown" || agent.effectiveStatus === "offline" || agent.freshness === "stale"} tall={charH} />
                      {agent.effectiveStatus === "idle" && agent.freshness === "fresh" ? <span className="seat-cup" aria-hidden="true" /> : null}
                    </button>
                    <button type="button" className="task-pill" style={{ top: taskTop, width: taskW }} onClick={() => choose(agent.agentId)}>
                      {agent.taskTitle || "尚未回報"}
                    </button>
                    <span className="nameplate" style={{ top: 2 * unit + 4 }}>{plateName(agent.name)}</span>
                  </>
                ) : (
                  <>
                    <div className="desk-empty" aria-hidden="true" />
                    <span className="nameplate is-empty" style={{ top: 2 * unit + 4 }}>空位</span>
                  </>
                )}
              </div>
            )
          })}
        </div>
      </div>
      {compact ? null : summary}
      {compact ? <div className="compact-summary">{summary}</div> : null}
      {moreOpen ? (
        <div className="more-overlay" role="dialog" aria-label="其餘需要注意的人">
          <button type="button" className="more-btn" onClick={() => setMoreOpen(false)}>關閉</button>
          <ul>
            {(compact ? attention : hiddenAttention).map((agent) => (
              <li key={agent.agentId}>
                <button type="button" onClick={() => choose(agent.agentId)}>{agent.name} · {agent.taskTitle || "尚未回報"}</button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <p className="sr-only">{ATTENTION_ORDER.join(" ")}</p>
    </div>
  )
}
