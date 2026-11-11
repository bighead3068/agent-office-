import { useEffect, useState, type CSSProperties } from "react"
import atlasUrl from "../../public/art/office-atlas.png"
import manifest from "../../public/art/office-atlas.json"
import { resolveLook } from "../office/look"
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

const SCALE = 2
const SEAT_CAP = 8
const ATTENTION_CAP = 4
const SCENE_W = manifest.scene.cols * manifest.tile * SCALE
const SCENE_H = manifest.scene.rows * manifest.tile * SCALE

type PoseName = keyof typeof manifest.character.poses

function useViewport(): { width: number; height: number } {
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
  return size
}

function tierOf(width: number): "cards" | "bar" | "desk" | "wide" {
  if (width < 1024) return "cards"
  if (width < 1280) return "bar"
  if (width < 1440) return "desk"
  return "wide"
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

function spriteStyle(name: string, x: number, y: number): CSSProperties {
  const sprite = manifest.sprites[name as keyof typeof manifest.sprites]
  if (!sprite) return { display: "none" }
  return {
    position: "absolute",
    left: x * SCALE,
    top: y * SCALE,
    width: sprite.w * SCALE,
    height: sprite.h * SCALE,
    backgroundImage: `url(${atlasUrl})`,
    backgroundRepeat: "no-repeat",
    backgroundPosition: `${-sprite.x * SCALE}px ${-sprite.y * SCALE}px`,
    backgroundSize: `${manifest.size.w * SCALE}px ${manifest.size.h * SCALE}px`,
    imageRendering: "pixelated",
    pointerEvents: "none",
  }
}

function pingpong(index: number, count: number): number {
  const cycle = Math.max(1, count * 2 - 2)
  const pos = index % cycle
  return pos < count ? pos : cycle - pos
}

function usePose(look: string, status: string, fresh: boolean, reduced: boolean, agentId: string): { pose: string; frame: number } {
  const base = manifest.character.statusPose[status as keyof typeof manifest.character.statusPose] ?? "breathe"
  const [pose, setPose] = useState(base)
  const [frame, setFrame] = useState(0)
  useEffect(() => {
    setPose(base)
    setFrame(0)
    if (reduced || status === "unknown" || status === "offline") return
    let stopped = false
    let current = base
    let cursor = 0
    let holdLeft = 0
    let eggUntil = 0
    const timers: number[] = []
    const framesOf = (name: string) => manifest.character.animations[look as keyof typeof manifest.character.animations][name as PoseName].length
    const step = () => {
      if (stopped) return
      const now = Date.now()
      if (status === "idle" && fresh && eggUntil === 0 && current === "breathe") {
        const egg = manifest.character.eggs[agentId.length % manifest.character.eggs.length] ?? "coffee"
        current = egg
        cursor = 0
        eggUntil = now + 8000
      }
      if (eggUntil > 0 && now >= eggUntil) {
        current = "breathe"
        cursor = 0
        eggUntil = -1
      }
      const spec = manifest.character.poses[current as PoseName] as { fps: number; loop: string; then?: string; holdMs?: number }
      const count = framesOf(current)
      if (holdLeft > 0) {
        holdLeft -= Math.round(1000 / spec.fps)
        setPose(current)
        setFrame(0)
      } else if (spec.loop === "once") {
        cursor = Math.min(count - 1, cursor + 1)
        setPose(current)
        setFrame(cursor)
        if (cursor >= count - 1 && spec.then) {
          current = spec.then
          cursor = 0
        }
      } else if (spec.loop === "pingpong") {
        cursor += 1
        setPose(current)
        setFrame(pingpong(cursor, count))
      } else {
        cursor = (cursor + 1) % count
        setPose(current)
        setFrame(cursor)
        if (cursor === 0 && spec.holdMs) holdLeft = spec.holdMs
      }
      const nextFps = (manifest.character.poses[current as PoseName] as { fps: number }).fps
      timers.push(window.setTimeout(step, Math.round(1000 / nextFps)))
    }
    timers.push(window.setTimeout(step, Math.round(1000 / manifest.character.poses[current as PoseName].fps)))
    return () => {
      stopped = true
      for (const timer of timers) window.clearTimeout(timer)
    }
  }, [agentId, base, fresh, look, reduced, status])
  return { pose, frame }
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

function staleMinutes(agent: DeskAgent, now: number): number | null {
  if (agent.freshness !== "stale" || agent.lastReportAt == null) return null
  const minutes = Math.floor((now - agent.lastReportAt) / 60_000)
  return minutes >= 1 ? minutes : null
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

function StatusIcon({ status }: { status: string }) {
  if (status === "failed") return <span className="bubble-icon glyph" aria-hidden="true">✕</span>
  if (status === "blocked") return <span className="bubble-icon glyph" aria-hidden="true">⛔</span>
  if (status === "unknown") return <span className="bubble-icon glyph" aria-hidden="true">?</span>
  if (status === "completed") return <span className="bubble-icon glyph" aria-hidden="true">✓</span>
  if (status === "waiting") return <span className="bubble-icon glyph" aria-hidden="true">⏳</span>
  if (status === "offline") return <span className="bubble-icon glyph" aria-hidden="true">⏻</span>
  if (status === "idle") return <span className="bubble-icon glyph" aria-hidden="true">–</span>
  return <span className="bubble-icon glyph" aria-hidden="true">⚙</span>
}

function DetailCard({
  agent,
  stamp,
  demo,
  sourceLabel,
  left,
  top,
}: {
  agent: DeskAgent
  stamp: number
  demo: boolean
  sourceLabel: string
  left: number
  top: number
}) {
  const previous = previousLine(agent)
  return (
    <article className="detail-card" data-testid="detail-card" style={{ left, top }}>
      <h3>{agent.name}</h3>
      <p className="detail-task">{agent.taskTitle || "尚未回報"}</p>
      <p>{bubbleCopy(agent, stamp)}{previous ? ` · ${previous}` : ""}</p>
      <p className="detail-meta">來源 {demo ? "模擬" : sourceLabel}</p>
      <p className="detail-meta">{agent.lastReportAt == null && agent.terminalAt == null ? "尚未更新" : formatReportTime((agent.lastReportAt ?? agent.terminalAt) as number)}</p>
    </article>
  )
}

function SeatActor({
  agent,
  anchor,
  reduced,
}: {
  agent: DeskAgent
  anchor: readonly number[]
  reduced: boolean
}) {
  const look = resolveLook(agent.agentId, agent.name, manifest)
  const { pose, frame } = usePose(look, agent.effectiveStatus, agent.freshness === "fresh", reduced, agent.agentId)
  const frames = manifest.character.animations[look as keyof typeof manifest.character.animations][pose as PoseName]
    ?? manifest.character.animations[look as keyof typeof manifest.character.animations].breathe
  const sprite = frames[Math.min(frame, frames.length - 1)] ?? frames[0]
  const origin = manifest.character.origin
  const muted = agent.effectiveStatus === "unknown" || agent.effectiveStatus === "offline" || agent.freshness === "stale"
  const sweat = !reduced && agent.effectiveStatus === "blocked" && agent.freshness === "fresh"
    ? manifest.character.sweat[frame % manifest.character.sweat.length]
    : null
  return (
    <>
      <div
        data-look={look}
        data-pose={reduced ? "still" : pose}
        data-frame={reduced ? 0 : frame}
        style={{
          ...spriteStyle(sprite, anchor[0] + origin.x, anchor[1] + origin.y),
          opacity: agent.effectiveStatus === "unknown" || agent.freshness === "stale" ? 0.5 : 1,
          filter: agent.effectiveStatus === "offline" ? "grayscale(1)" : undefined,
          zIndex: 6,
        }}
        className={muted ? "actor is-muted" : "actor"}
      />
      {sweat ? <div style={{ ...spriteStyle(sweat, anchor[0] + origin.x, anchor[1] + origin.y), zIndex: 6 }} /> : null}
    </>
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
  const viewport = useViewport()
  const tier = tierOf(viewport.width)
  const reduced = useReducedMotion()
  const [moreOpen, setMoreOpen] = useState(false)
  const stamp = now ?? Date.now()
  const tally = tallyDesks(agents)
  const attention = attentionAgents(agents)
  const visibleAttention = attention.slice(0, ATTENTION_CAP)
  const hiddenAttention = attention.slice(ATTENTION_CAP)
  const bySeat = new Map(agents.filter((agent) => agent.seat >= 0 && agent.seat < SEAT_CAP).map((agent) => [agent.seat, agent]))
  const selected = agents.find((agent) => agent.agentId === selectedId) ?? null
  const showScene = tier !== "cards"

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
              <span className={`count-bar attention-bar count-${agent.effectiveStatus === "waiting" ? "waiting" : "stuck"}`} />
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
    <aside className="summary-dock" data-testid="summary-panel" aria-label="主管摘要">
      <h2>主管摘要（唯讀）</h2>
      {counts}
      {tier === "bar" || tier === "cards" ? (
        <button type="button" className="more-btn" onClick={() => setMoreOpen(true)}>
          需要注意 {attention.length}
        </button>
      ) : attentionBlock}
      {tier === "bar" || tier === "cards" ? null : (
        <p className="summary-secondary" data-testid="summary-secondary">
          閒置 {tally.idle} · 離線 {tally.offline} · 過期 {tally.stale} · 未入座 {tally.unseated}
        </p>
      )}
      <p className="summary-foot">資料來源：{demo ? "模擬" : "Bot自行回報（非平台原生）"} · 更新 {new Intl.DateTimeFormat("zh-TW", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "Asia/Taipei" }).format(stamp)}</p>
      <p className="sr-only" data-testid="summary-total">共 {tally.total} 人，分格加總 {tally.cells.stuck + tally.cells.working + tally.cells.waiting + tally.cells.completed + tally.cells.unknown + tally.idle + tally.offline}</p>
    </aside>
  )

  const selectedSeat = selected ? manifest.seats.find((seat) => seat.index === selected.seat) : undefined
  const cardLeft = selectedSeat
    ? Math.max(0, Math.min(SCENE_W - 280, selectedSeat.column < 2 ? selectedSeat.anchor[0] * SCALE + 72 : selectedSeat.anchor[0] * SCALE - 72 - 280))
    : 0
  const cardTop = selectedSeat ? Math.max(8, selectedSeat.anchor[1] * SCALE - 140) : 0

  return (
    <div className={demo ? "office-v2 is-demo" : "office-v2"} data-view={demo ? "demo" : "real"} data-tier={tier} data-reduced={reduced ? "true" : "false"} data-scale={showScene ? SCALE : 1}>
      {summary}
      {showScene ? (
        <div className="scene-wrap">
          <div className="scene" data-testid="office-floor" data-scale={SCALE} style={{ width: SCENE_W, height: SCENE_H }}>
            {manifest.layers.filter((layer) => layer.z < 5).map((layer) => (
              <div key={`${layer.sprite}-${layer.x}-${layer.y}`} style={{ ...spriteStyle(layer.sprite, layer.x, layer.y), zIndex: layer.z }} />
            ))}
            {manifest.seats.map((seat) => (
              <div key={`${seat.id}-chair`} style={{ ...spriteStyle(seat.chair.sprite, seat.chair.x, seat.chair.y), zIndex: 5 }} />
            ))}
            {manifest.seats.map((seat) => {
              const agent = bySeat.get(seat.index)
              if (!agent) return null
              return <SeatActor key={agent.agentId} agent={agent} anchor={seat.anchor} reduced={reduced} />
            })}
            {manifest.seats.map((seat) => {
              const agent = bySeat.get(seat.index)
              const monitor = agent?.effectiveStatus === "offline" ? "monitor-off" : seat.monitor.sprite
              const look = agent ? resolveLook(agent.agentId, agent.name, manifest) : ""
              const extras = look ? manifest.character.lookProps[look as keyof typeof manifest.character.lookProps] ?? [] : []
              return (
                <div key={`${seat.id}-desk`}>
                  <div style={{ ...spriteStyle(seat.desk.sprite, seat.desk.x, seat.desk.y), zIndex: 7 }} />
                  <div style={{ ...spriteStyle(monitor, seat.monitor.x, seat.monitor.y), zIndex: 8 }} />
                  <div style={{ ...spriteStyle(seat.clutter.sprite, seat.clutter.x, seat.clutter.y), zIndex: 8 }} />
                  {extras.map((extra) => (
                    <div key={extra.sprite} style={{ ...spriteStyle(extra.sprite, seat.anchor[0] + extra.dx, seat.anchor[1] + extra.dy), zIndex: 8 }} />
                  ))}
                </div>
              )
            })}
            {manifest.layers.filter((layer) => layer.z >= 9).map((layer) => (
              <div key={`${layer.sprite}-${layer.x}-${layer.y}-front`} style={{ ...spriteStyle(layer.sprite, layer.x, layer.y), zIndex: layer.z }} />
            ))}
            {manifest.seats.map((seat) => {
              const agent = bySeat.get(seat.index) ?? null
              const ax = seat.anchor[0] * SCALE
              const ay = seat.anchor[1] * SCALE
              const shown = agent && agent.freshness === "stale" ? "unknown" : agent?.effectiveStatus
              const minutes = agent ? staleMinutes(agent, stamp) : null
              return (
                <div
                  key={seat.id}
                  className={agent?.agentId === selectedId ? "seat-slot is-selected" : "seat-slot"}
                  data-seat={seat.id}
                  data-testid={agent ? `agent-${agent.agentId}` : undefined}
                  data-status={agent?.effectiveStatus}
                  data-freshness={agent?.freshness}
                  style={{ left: ax, top: ay }}
                >
                  {agent ? (
                    <>
                      <button type="button" className="task-pill" onClick={() => choose(agent.agentId)}>
                        {agent.taskTitle || "尚未回報"}
                      </button>
                      <button
                        type="button"
                        className={`bubble bubble-${shown}${agent.freshness === "stale" ? " is-stale" : ""}`}
                        data-bubble={shown}
                        onClick={() => choose(agent.agentId)}
                      >
                        <StatusIcon status={shown ?? "unknown"} />
                        <span className="bubble-copy">
                          <span>{bubbleCopy(agent, stamp)}</span>
                          {previousLine(agent) ? <span className="bubble-sub">{previousLine(agent)}</span> : null}
                        </span>
                        {minutes != null ? <span className="stale-tag">⏱過期 {minutes}分</span> : null}
                      </button>
                      <button
                        type="button"
                        className="desk-hit"
                        data-agent-id={agent.agentId}
                        aria-pressed={agent.agentId === selectedId}
                        title={agent.name}
                        onClick={() => choose(agent.agentId)}
                      />
                      <span className="select-ring" />
                      <span className="nameplate">{plateName(agent.name)}</span>
                    </>
                  ) : <span className="nameplate is-empty">空位</span>}
                </div>
              )
            })}
            {selected && selectedSeat ? <DetailCard agent={selected} stamp={stamp} demo={demo} sourceLabel={sourceLabel} left={cardLeft} top={cardTop} /> : null}
          </div>
        </div>
      ) : (
        <ul className="seat-cards">
          {manifest.seats.map((seat) => {
            const agent = bySeat.get(seat.index)
            if (!agent) return <li key={seat.id} className="seat-card is-empty">空位</li>
            const shown = agent.freshness === "stale" ? "unknown" : agent.effectiveStatus
            return (
              <li key={seat.id}>
                <button
                  type="button"
                  className={`seat-card bubble-${shown}`}
                  data-testid={`agent-${agent.agentId}`}
                  data-status={agent.effectiveStatus}
                  data-freshness={agent.freshness}
                  onClick={() => choose(agent.agentId)}
                >
                  <b>{plateName(agent.name)}</b>
                  <span>{bubbleCopy(agent, stamp)}{previousLine(agent) ? ` ${previousLine(agent)}` : ""}</span>
                  <span>{agent.taskTitle || "尚未回報"}</span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
      {moreOpen ? (
        <div className="more-overlay" role="dialog" aria-label="其餘需要注意的人">
          <button type="button" className="more-btn" onClick={() => setMoreOpen(false)}>關閉</button>
          <ul>
            {(tier === "bar" || tier === "cards" ? attention : hiddenAttention).map((agent) => (
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
