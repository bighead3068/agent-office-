import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react"
import atlasUrl from "../../public/art/office-atlas.png"
import manifest from "../../public/art/office-atlas.json"
import { hashId, resolveLook } from "../office/look"
import {
  ATTENTION_ORDER,
  LEDGER_COUNTS,
  STATUS_LABEL,
  attentionQueue,
  elapsedLabel,
  eventMillis,
  ledgerTotals,
  plateName,
  type DeskAgent,
} from "../office/summaryOrder"
import { formatReportTime } from "./reportConnection"
import "./OfficeFloor.css"

const SCALE = 2
const SEAT_CAP = 8
const SCENE_W = manifest.scene.cols * manifest.tile * SCALE
const SCENE_H = manifest.scene.rows * manifest.tile * SCALE
const INK_ICONS = new Set(["waiting", "idle"])

type PoseName = keyof typeof manifest.character.poses
type Change = { id: string; at: number; name: string; status: string }

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

function tierOf(width: number, height: number): "cards" | "bar" | "desk" | "wide" {
  if (height < 768 || width < 1024) return "cards"
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

function iconStyle(status: string): CSSProperties {
  const name = `icon-${status}${INK_ICONS.has(status) ? "-ink" : ""}`
  const sprite = manifest.sprites[name as keyof typeof manifest.sprites]
  if (!sprite) return { display: "none" }
  return {
    width: 12,
    height: 12,
    backgroundImage: `url(${atlasUrl})`,
    backgroundRepeat: "no-repeat",
    backgroundPosition: `${-sprite.x}px ${-sprite.y}px`,
    backgroundSize: `${manifest.size.w}px ${manifest.size.h}px`,
    imageRendering: "pixelated",
  }
}

function pingpong(index: number, count: number): number {
  const cycle = Math.max(1, count * 2 - 2)
  const pos = index % cycle
  return pos < count ? pos : cycle - pos
}

function framesOf(look: string, pose: string): string[] {
  const book = manifest.character.animations[look as keyof typeof manifest.character.animations]
  return book[pose as PoseName] ?? book.breathe
}

function usePose(look: string, status: string, fresh: boolean, reduced: boolean, agentId: string): { pose: string; frame: number; sweat: number } {
  const base = manifest.character.statusPose[status as keyof typeof manifest.character.statusPose] ?? "breathe"
  const [pose, setPose] = useState(base)
  const [frame, setFrame] = useState(0)
  const [blink, setBlink] = useState(0)
  const [sweat, setSweat] = useState(0)
  useEffect(() => {
    setPose(base)
    setFrame(0)
    setBlink(0)
    if (reduced || status === "unknown" || status === "offline") return
    let stopped = false
    let current = base
    let cursor = 0
    let holdLeft = 0
    const idleStart = status === "idle" && fresh ? Date.now() : 0
    let nextEggAt = idleStart ? idleStart + 20_000 : 0
    let eggPlaying = false
    const timers: number[] = []
    const step = () => {
      if (stopped) return
      const now = Date.now()
      if (status === "idle" && fresh && !eggPlaying && nextEggAt > 0 && now >= nextEggAt) {
        const choice = hashId(`${agentId}${idleStart}`) % manifest.character.eggs.length
        current = manifest.character.eggs[choice] ?? "coffee"
        cursor = 0
        eggPlaying = true
      }
      const spec = manifest.character.poses[current as PoseName] as { fps: number; loop: string; then?: string; holdMs?: number }
      const count = framesOf(look, current).length
      if (holdLeft > 0) {
        holdLeft -= Math.round(1000 / spec.fps)
        setPose(current)
        setFrame(0)
      } else if (spec.loop === "once") {
        cursor = Math.min(count - 1, cursor + 1)
        setPose(current)
        setFrame(cursor)
        if (cursor >= count - 1) {
          if (eggPlaying) {
            eggPlaying = false
            current = "breathe"
            cursor = 0
            const gap = 45_000 + (hashId(`${agentId}${idleStart}next`) % 45_001)
            nextEggAt = Date.now() + gap
          } else if (spec.then) {
            current = spec.then
            cursor = 0
          }
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
    timers.push(window.setTimeout(step, Math.round(1000 / (manifest.character.poses[current as PoseName] as { fps: number }).fps)))
    const blinkLoop = () => {
      if (stopped) return
      const wait = 3000 + Math.floor(Math.random() * 3001)
      timers.push(window.setTimeout(() => {
        if (stopped) return
        setBlink(1)
        timers.push(window.setTimeout(() => {
          if (!stopped) setBlink(2)
        }, 120))
        timers.push(window.setTimeout(() => {
          if (!stopped) setBlink(0)
          blinkLoop()
        }, 240))
      }, wait))
    }
    blinkLoop()
    const sweatTimer = window.setInterval(() => setSweat((value) => (value + 1) % 2), 500)
    return () => {
      stopped = true
      window.clearInterval(sweatTimer)
      for (const timer of timers) window.clearTimeout(timer)
    }
  }, [agentId, base, fresh, look, reduced, status])
  const blinking = blink > 0 && (pose === "breathe" || pose === "type" || pose === "wait" || pose === "sit")
  return { pose: blinking ? "blink" : pose, frame: blinking ? blink - 1 : frame, sweat }
}

const PREVIOUS_WORD: Record<string, string> = {
  completed: "完成", failed: "失敗", blocked: "受阻", working: "工作中", waiting: "等待", idle: "閒置", offline: "離線",
}

function previousLine(agent: DeskAgent): string | null {
  if (agent.freshness !== "stale") return null
  const word = agent.lastKnownStatus ? PREVIOUS_WORD[agent.lastKnownStatus] : undefined
  return word ? `上次：${word}` : null
}

function staleMinutes(agent: DeskAgent, now: number): number | null {
  if (agent.freshness !== "stale" || agent.lastReportAt == null) return null
  const minutes = Math.floor((now - eventMillis(agent.lastReportAt, now)) / 60_000)
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

function clock(stamp: number): string {
  return new Intl.DateTimeFormat("zh-TW", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "Asia/Taipei" }).format(stamp)
}

function StatusIcon({ status }: { status: string }) {
  return <span className="pixel-icon" style={iconStyle(status)} aria-hidden="true" />
}

function useBubbleBox(anchorX: number) {
  const ref = useRef<HTMLButtonElement>(null)
  const [box, setBox] = useState({ width: 96, left: -48, height: 36, top: -112 })
  useLayoutEffect(() => {
    const node = ref.current
    if (!node) return
    const previous = node.style.width
    node.style.width = "max-content"
    const measured = node.getBoundingClientRect()
    node.style.width = previous
    const width = Math.min(176, Math.ceil(measured.width))
    const height = Math.round(measured.height)
    const raw = Math.round(-width / 2)
    const left = Math.round(Math.max(8 - anchorX, Math.min(SCENE_W - 8 - anchorX - width, raw)))
    const top = Math.round(-(height + 76))
    setBox((prev) => (prev.width === width && prev.left === left && prev.height === height && prev.top === top ? prev : { width, left, height, top }))
  })
  return { ref, box }
}

function DetailCard({ agent, stamp, demo, sourceLabel, left, top }: {
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

function SeatActor({ agent, anchor, reduced }: { agent: DeskAgent; anchor: readonly number[]; reduced: boolean }) {
  const look = resolveLook(agent.agentId, agent.name, manifest)
  const posed = usePose(look, agent.effectiveStatus, agent.freshness === "fresh", reduced, agent.agentId)
  const frames = framesOf(look, posed.pose)
  const sprite = frames[Math.min(posed.frame, frames.length - 1)] ?? frames[0]
  const origin = manifest.character.origin
  const muted = agent.effectiveStatus === "unknown" || agent.effectiveStatus === "offline" || agent.freshness === "stale"
  const sweat = !reduced && agent.effectiveStatus === "blocked" && agent.freshness === "fresh"
    ? manifest.character.sweat[posed.sweat]
    : null
  return (
    <>
      <div
        data-look={look}
        data-pose={reduced ? "still" : posed.pose}
        data-frame={reduced ? 0 : posed.frame}
        data-sweat={sweat ? posed.sweat : undefined}
        style={{
          ...spriteStyle(sprite ?? "coordinator-breathe-0", anchor[0] + origin.x, anchor[1] + origin.y),
          opacity: agent.effectiveStatus === "unknown" || agent.freshness === "stale" ? 0.5 : 1,
          filter: agent.effectiveStatus === "offline" ? "grayscale(1)" : undefined,
          zIndex: 6,
        }}
        className={muted ? "actor is-muted" : "actor"}
      />
      {sweat ? <div data-sweat-frame={posed.sweat} style={{ ...spriteStyle(sweat, anchor[0] + origin.x, anchor[1] + origin.y), zIndex: 6 }} /> : null}
    </>
  )
}

function seedDemoChanges(agents: readonly DeskAgent[], now: number): Change[] {
  return agents.slice(0, 4).map((agent, index) => ({
    id: `demo-seed-${agent.agentId}`,
    at: now - (index + 1) * 4 * 60_000,
    name: plateName(agent.name),
    status: agent.effectiveStatus,
  }))
}

function AttentionRows({ agents, now, onChoose }: { agents: readonly DeskAgent[]; now: number; onChoose: (id: string) => void }) {
  return (
    <>
      {agents.map((agent) => (
        <button key={agent.agentId} type="button" className={`ledger-row row-${agent.effectiveStatus}`} data-agent-id={agent.agentId} onClick={() => onChoose(agent.agentId)}>
          <span className={`chip chip-${agent.effectiveStatus}`}><StatusIcon status={agent.effectiveStatus} />{agent.effectiveStatus === "blocked" ? "受阻" : agent.effectiveStatus === "failed" ? "失敗" : "等待"}</span>
          <b>{plateName(agent.name)}</b>
          <span className="seat-code">{manifest.seats[agent.seat]?.id ?? ""}</span>
          <span className="ledger-task">{agent.taskTitle || "尚未回報"}</span>
          <em>{elapsedLabel(agent.lastReportAt, now)}</em>
        </button>
      ))}
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
  disconnected = false,
  menuOpen = false,
}: {
  agents: readonly DeskAgent[]
  selectedId?: string
  onSelect?: (id: string) => void
  demo?: boolean
  now?: number | null
  sourceLabel?: string
  disconnected?: boolean
  menuOpen?: boolean
}) {
  const viewport = useViewport()
  const tier = tierOf(viewport.width, viewport.height)
  const reduced = useReducedMotion()
  const [menu, setMenu] = useState(menuOpen)
  const [page, setPage] = useState(0)
  const [flashId, setFlashId] = useState("")
  const [changes, setChanges] = useState<Change[]>(() => (demo ? seedDemoChanges(agents, now ?? Date.now()) : []))
  const previous = useRef(new Map<string, string>())
  const stamp = now ?? Date.now()
  const queue = attentionQueue(agents)
  const totals = ledgerTotals(agents)
  const total = LEDGER_COUNTS.reduce((sum, cell) => sum + totals[cell.id], 0)
  const unclear = totals.unknown + totals.offline
  const bySeat = new Map(agents.filter((agent) => agent.seat >= 0 && agent.seat < SEAT_CAP).map((agent) => [agent.seat, agent]))
  const selected = agents.find((agent) => agent.agentId === selectedId) ?? null
  const showScene = tier !== "cards"
  const stageTop = tier === "wide" || tier === "desk" ? Math.max(0, Math.floor((viewport.height - 48 - SCENE_H) / 2)) : 0
  useEffect(() => {
    document.documentElement.dataset.tier = tier
    return () => { delete document.documentElement.dataset.tier }
  }, [tier])
  const lastReport = agents.reduce((latest, agent) => Math.max(latest, agent.lastReportAt ?? 0), 0)

  useEffect(() => {
    const seen = previous.current
    const next: Change[] = []
    for (const agent of agents) {
      const before = seen.get(agent.agentId)
      if (before && before !== agent.effectiveStatus && agent.reason !== "ttl") {
        next.push({ id: `${agent.agentId}-${agent.effectiveStatus}-${stamp}`, at: stamp, name: plateName(agent.name), status: agent.effectiveStatus })
      }
      seen.set(agent.agentId, agent.effectiveStatus)
    }
    if (next.length > 0) setChanges((current) => [...next, ...current].slice(0, 4))
  }, [agents, stamp])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onSelect?.("")
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onSelect])

  useEffect(() => {
    if (typeof window === "undefined" || !new URLSearchParams(window.location.search).has("measure")) return
    const frame = window.requestAnimationFrame(() => {
      const scene = document.querySelector<HTMLElement>(".scene")
      const panel = document.querySelector<HTMLElement>(".summary-dock, .ledger-strip")
      const seats = [...document.querySelectorAll<HTMLElement>(".seat-slot")].map((seat) => {
        const bubble = seat.querySelector<HTMLElement>(".bubble")
        const task = seat.querySelector<HTMLElement>(".task-pill")
        const tail = seat.querySelector<HTMLElement>(".bubble-tail")
        const tag = seat.querySelector<HTMLElement>(".stale-tag")
        const bubbleBox = bubble?.getBoundingClientRect()
        const taskBox = task?.getBoundingClientRect()
        const tailBox = tail?.getBoundingClientRect()
        const seatBox = seat.getBoundingClientRect()
        return {
          id: seat.dataset.seat,
          anchorX: Math.round(seatBox.left),
          bubbleWidth: bubbleBox ? Math.round(bubbleBox.width * 1000) / 1000 : null,
          bubbleLeft: bubbleBox ? Math.round(bubbleBox.left) : null,
          gap: bubbleBox && taskBox ? Math.round(bubbleBox.top - taskBox.bottom) : null,
          tailCenter: tailBox ? Math.round(tailBox.left + tailBox.width / 2) : null,
          tag: tag?.getBoundingClientRect().toJSON() ?? null,
          task: taskBox?.toJSON() ?? null,
        }
      })
      const card = document.querySelector<HTMLElement>(".detail-card")?.getBoundingClientRect()
      const host = document.getElementById("measure") ?? document.body.appendChild(document.createElement("pre"))
      host.id = "measure"
      host.style.position = "absolute"
      host.style.left = "0"
      host.style.top = "0"
      host.textContent = JSON.stringify({
        scroll: document.documentElement.scrollHeight,
        inner: { w: window.innerWidth, h: window.innerHeight },
        scene: scene ? { top: scene.getBoundingClientRect().top, left: scene.getBoundingClientRect().left, width: scene.getBoundingClientRect().width, height: scene.getBoundingClientRect().height } : null,
        panel: panel ? { top: panel.getBoundingClientRect().top, height: panel.getBoundingClientRect().height, width: panel.getBoundingClientRect().width } : null,
        card: card?.toJSON() ?? null,
        seats,
      })
    })
    return () => window.cancelAnimationFrame(frame)
  })

  function choose(id: string) {
    onSelect?.(id)
    setMenu(false)
    setFlashId(id)
    window.setTimeout(() => setFlashId((current) => (current === id ? "" : current)), reduced ? 0 : 1200)
    if (tier === "cards") document.querySelector(`[data-testid="agent-${CSS.escape(id)}"]`)?.scrollIntoView({ block: "nearest" })
  }

  const shownQueue = queue.length > 4 ? queue.slice(page * 3, page * 3 + 3) : queue.slice(0, 4)
  const hiddenCount = Math.max(0, queue.length - (page * 3 + shownQueue.length))
  const conclusion = disconnected
    ? `連線中斷，以下是 ${clock(lastReport || stamp)} 的資料`
    : queue.length > 0 ? `${queue.length} 人需要你處理` : "目前沒有受阻、失敗或等待"

  const counts = (
    <ul className="count-grid" aria-label="狀態人數">
      {LEDGER_COUNTS.map((cell) => {
        const value = totals[cell.id]
        return (
          <li key={cell.id} className={value === 0 ? "count-cell is-zero" : "count-cell"} data-count={cell.id}>
            <span className={`count-swatch swatch-${cell.id}`}><StatusIcon status={cell.id} /></span>
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
      {queue.length === 0 ? <p className="empty-attention">沒有受阻、失敗或等待中的工作</p> : (
        <div className="attention-list">
          <AttentionRows agents={shownQueue} now={stamp} onChoose={choose} />
          {queue.length > 4 ? (
            <button type="button" className="ledger-row more-row" data-testid="attention-more" onClick={() => setPage((value) => (hiddenCount > 0 ? value + 1 : 0))}>
              ＋{hiddenCount > 0 ? hiddenCount : queue.length} 項，點一下跳到下一個
            </button>
          ) : null}
        </div>
      )}
    </div>
  )

  const summary = tier === "bar" || tier === "cards" ? (
    <div className="ledger-strip" data-testid="summary-panel" aria-label="主管摘要">
      <p className="strip-conclusion">{conclusion}</p>
      <ul className="strip-counts">
        {LEDGER_COUNTS.map((cell) => <li key={cell.id} data-count={cell.id}><StatusIcon status={cell.id} />{totals[cell.id]}</li>)}
      </ul>
      <button type="button" className="more-btn" aria-expanded={menu} onClick={() => setMenu((value) => !value)}>需要注意 {queue.length} ▾</button>
      <p className="sr-only" data-testid="summary-total">共 {total} 人，分格加總 {total}</p>
    </div>
  ) : (
    <aside className={disconnected ? "summary-dock is-disconnected" : "summary-dock"} data-testid="summary-panel" aria-label="主管摘要">
      <div className="ledger">
        <header className="ledger-plaque">
          <h2>主管摘要</h2>
          <span className="readonly-chip">唯讀</span>
        </header>
        <p className="ledger-updated">更新 {clock(stamp)}（台北）</p>
        <p className="ledger-conclusion">{conclusion}</p>
        {unclear > 0 && !disconnected ? <p className="ledger-unclear">{unclear} 人狀態不明</p> : null}
        {attentionBlock}
        <h3 className="ledger-label">人數</h3>
        {counts}
        <p className="ledger-sum" data-testid="summary-total">共 {total} 人，分格加總 {total}</p>
        <h3 className="ledger-label">最近變化{demo ? "（示範）" : ""}</h3>
        <ul className="change-list">
          {changes.length === 0 ? <li className="change-empty">還沒有狀態轉換</li> : changes.map((change) => (
            <li key={change.id}><span>{clock(change.at)}</span><StatusIcon status={change.status} />{change.name} → {PREVIOUS_WORD[change.status] ?? change.status}</li>
          ))}
        </ul>
        <p className={disconnected ? "ledger-foot is-down" : "ledger-foot"}>
          {disconnected
            ? `連線中斷・最後收到 ${clock(lastReport || stamp)}`
            : `資料來源：Bot 自行回報（非平台原生）・已連線・最後收到 ${clock(lastReport || stamp)}`}
        </p>
      </div>
    </aside>
  )

  const selectedSeat = selected ? manifest.seats.find((seat) => seat.index === selected.seat) : undefined
  const cardLeft = selectedSeat
    ? (selectedSeat.column < 2 ? selectedSeat.anchor[0] * SCALE + 96 : selectedSeat.anchor[0] * SCALE - 96 - 280)
    : 0
  const cardTop = selectedSeat ? Math.max(8, selectedSeat.anchor[1] * SCALE - 156) : 0

  return (
    <div
      className={demo ? "office-v2 is-demo" : "office-v2"}
      data-view={demo ? "demo" : "real"}
      data-tier={tier}
      data-reduced={reduced ? "true" : "false"}
      data-scale={showScene ? SCALE : 1}
      data-link={disconnected ? "down" : "up"}
      style={{ marginTop: stageTop }}
    >
      {tier === "bar" ? summary : null}
      {showScene ? (
        <div className="scene-wrap">
          <div
            className="scene"
            data-testid="office-floor"
            data-scale={SCALE}
            style={{ width: SCENE_W, height: SCENE_H }}
            onMouseDown={(event) => {
              const target = event.target as HTMLElement
              if (!target.closest("[data-seat], .detail-card")) onSelect?.("")
            }}
          >
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
                    <div key={extra.sprite + extra.dx} style={{ ...spriteStyle(extra.sprite, seat.anchor[0] + extra.dx, seat.anchor[1] + extra.dy), zIndex: 8 }} />
                  ))}
                </div>
              )
            })}
            {manifest.layers.filter((layer) => layer.z >= 9).map((layer) => (
              <div key={`${layer.sprite}-${layer.x}-front`} style={{ ...spriteStyle(layer.sprite, layer.x, layer.y), zIndex: layer.z }} />
            ))}
            {manifest.seats.map((seat) => {
              const agent = bySeat.get(seat.index) ?? null
              const ax = seat.anchor[0] * SCALE
              const ay = seat.anchor[1] * SCALE
              return (
                <SeatChrome
                  key={seat.id}
                  seatId={seat.id}
                  agent={agent}
                  anchorX={ax}
                  anchorY={ay}
                  selected={agent?.agentId === selectedId}
                  flash={agent?.agentId === flashId}
                  stamp={stamp}
                  onChoose={choose}
                />
              )
            })}
            {selected && selectedSeat ? <DetailCard agent={selected} stamp={stamp} demo={demo} sourceLabel={sourceLabel} left={cardLeft} top={cardTop} /> : null}
            {tier === "bar" && menu ? (
              <div className="ledger-menu" data-testid="attention-menu">
                {queue.length === 0 ? <p className="empty-attention">沒有受阻、失敗或等待中的工作</p> : <AttentionRows agents={queue.slice(0, 4)} now={stamp} onChoose={choose} />}
              </div>
            ) : null}
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
                <button type="button" className={`seat-card bubble-${shown}`} data-testid={`agent-${agent.agentId}`} data-status={agent.effectiveStatus} data-freshness={agent.freshness} onClick={() => choose(agent.agentId)}>
                  <b>{plateName(agent.name)}</b>
                  <span>{bubbleCopy(agent, stamp)}{previousLine(agent) ? ` ${previousLine(agent)}` : ""}</span>
                  <span>{agent.taskTitle || "尚未回報"}</span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
      {tier === "bar" || tier === "cards" ? null : summary}
      <p className="sr-only">{ATTENTION_ORDER.join(" ")}</p>
    </div>
  )
}

function SeatChrome({
  seatId, agent, anchorX, anchorY, selected, flash, stamp, onChoose,
}: {
  seatId: string
  agent: DeskAgent | null
  anchorX: number
  anchorY: number
  selected: boolean
  flash: boolean
  stamp: number
  onChoose: (id: string) => void
}) {
  const { ref, box } = useBubbleBox(anchorX)
  const shown = agent && agent.freshness === "stale" ? "unknown" : agent?.effectiveStatus
  const minutes = agent ? staleMinutes(agent, stamp) : null
  const taskTop = box.top - 4 - 24
  return (
    <div
      className={selected ? `seat-slot is-selected${flash ? " is-flash" : ""}` : "seat-slot"}
      data-seat={seatId}
      data-testid={agent ? `agent-${agent.agentId}` : undefined}
      data-status={agent?.effectiveStatus}
      data-freshness={agent?.freshness}
      style={{ left: anchorX, top: anchorY }}
    >
      {agent ? (
        <>
          <button type="button" className="task-pill" style={{ top: taskTop, left: -88, width: 176 }} onClick={() => onChoose(agent.agentId)}>
            {agent.taskTitle || "尚未回報"}
          </button>
          <button
            ref={ref}
            type="button"
            className={`bubble bubble-${shown}${agent.freshness === "stale" ? " is-stale" : ""}`}
            data-bubble={shown}
            style={{ left: box.left, top: box.top, width: box.width }}
            onClick={() => onChoose(agent.agentId)}
          >
            <StatusIcon status={shown ?? "unknown"} />
            <span className="bubble-copy">
              <span>{bubbleCopy(agent, stamp)}</span>
              {previousLine(agent) ? <span className="bubble-sub">{previousLine(agent)}</span> : null}
            </span>
            <span className="bubble-tail" style={{ left: -box.left - 4 - (shown === "blocked" ? 3 : shown === "idle" ? 1 : 2) }} />
          </button>
          {minutes != null ? (
            <span className="stale-tag" style={{ left: box.left + box.width + 8, top: box.top + box.height - 16, width: 96 }}>⏱過期 {minutes}分</span>
          ) : null}
          <button type="button" className="desk-hit" data-agent-id={agent.agentId} aria-pressed={selected} title={agent.name} onClick={() => onChoose(agent.agentId)} />
          <span className="select-ring" />
          <span className="nameplate">{plateName(agent.name)}</span>
        </>
      ) : <span className="nameplate is-empty">空位</span>}
    </div>
  )
}
