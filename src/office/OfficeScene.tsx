import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import './OfficeScene.css'
import { drawOffice, type DrawSeatModel } from './drawOffice'
import {
  createAgentEggState,
  resolveOfficeSceneConfig,
  stepAgentEgg,
  type AgentEggState,
} from './easterEggs'
import { iconRows, type PixelIconName } from './icons'
import { LAYOUT, LOGICAL_HEIGHT, LOGICAL_WIDTH, computeScale, type Box } from './layout'
import { STATUS_WORD, agentAriaLabel, formatUpdatedAt, presentSeat } from './presentation'
import { assignSeats, emptyOwners } from './seats'
import {
  AGENT_STATUSES,
  SEAT_IDS,
  type AgentStatus,
  type OfficeAgent,
  type OfficeSceneProps,
  type SeatId,
} from './types'

const STATUS_LABEL = STATUS_WORD

const LEGEND_ICON: Record<AgentStatus, PixelIconName> = {
  working: 'gear',
  waiting: 'ellipsis',
  blocked: 'block',
  completed: 'check',
  failed: 'bang',
  idle: 'sleep',
  unknown: 'question',
  offline: 'plug',
}

const SEAT_LAYOUT = LAYOUT.seats

function usePrefersReducedMotion(override: boolean | undefined): boolean {
  const [system, setSystem] = useState(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  })

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    const onChange = () => setSystem(query.matches)
    onChange()
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])

  return override ?? system
}

function useContainerWidth(ref: { current: HTMLElement | null }): number {
  const [width, setWidth] = useState(0)
  useEffect(() => {
    const element = ref.current
    if (!element) return
    const update = () => {
      const parent = element.parentElement?.clientWidth ?? element.clientWidth
      const own = element.clientWidth
      const next = parent > 0 ? Math.min(parent, own > 0 ? own : parent) : own
      setWidth(next)
    }
    update()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(update)
    observer.observe(element)
    if (element.parentElement) observer.observe(element.parentElement)
    return () => observer.disconnect()
  }, [ref])
  return width
}

function boxStyle(box: Box, scale: number): CSSProperties {
  return {
    left: box.x * scale,
    top: box.y * scale,
    width: box.w * scale,
    height: box.h * scale,
  }
}

function PixelIcon({ name, className }: { name: PixelIconName; className?: string }) {
  const rows = iconRows(name)
  const size = rows.length
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      shapeRendering="crispEdges"
      aria-hidden="true"
    >
      {rows.flatMap((row, y) =>
        [...row].map((bit, x) =>
          bit === '1' ? <rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} fill="currentColor" /> : null,
        ),
      )}
    </svg>
  )
}

/**
 * Pixel-art office floor. Seats S1–S5 stay bound to agent ids, and every
 * status is drawn from the props you pass — the scene does not infer idle.
 */
export function OfficeScene({
  agents,
  selectedId,
  onSelect,
  config,
  now,
  reducedMotion,
  className,
}: OfficeSceneProps) {
  const reduced = usePrefersReducedMotion(reducedMotion)
  const resolved = useMemo(
    () => resolveOfficeSceneConfig(config),
    [config?.easterEggIdleWaitMs, config?.easterEggFrequencyCapMs, config?.easterEggDurationMs],
  )
  const rootRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerWidth = useContainerWidth(rootRef)
  const scale = computeScale(containerWidth)
  const [internalNow, setInternalNow] = useState(() => Date.now())
  const clock = now ?? internalNow

  useEffect(() => {
    if (now != null || reduced) return
    const id = window.setInterval(() => setInternalNow(Date.now()), 120)
    return () => window.clearInterval(id)
  }, [now, reduced])

  const ownersRef = useRef(emptyOwners())
  const assignment = assignSeats(agents, ownersRef.current)
  ownersRef.current = assignment.nextOwners

  const eggRef = useRef<Record<string, AgentEggState>>({})
  const eggKeyRef = useRef('')
  const eggKey = [
    clock,
    reduced ? 1 : 0,
    resolved.easterEggIdleWaitMs,
    resolved.easterEggFrequencyCapMs,
    resolved.easterEggDurationMs,
    agents
      .map((agent) => `${agent.id}:${agent.status}:${agent.freshness}:${agent.connected ? 1 : 0}`)
      .join('|'),
  ].join('~')

  if (eggKeyRef.current !== eggKey) {
    const next: Record<string, AgentEggState> = {}
    for (const agent of agents) {
      next[agent.id] = stepAgentEgg(
        agent,
        eggRef.current[agent.id] ?? createAgentEggState(),
        clock,
        resolved,
        reduced,
      )
    }
    eggRef.current = next
    eggKeyRef.current = eggKey
  }

  const waitingRef = useRef<Record<string, number>>({})
  const frameRef = useRef<Record<string, 0 | 1>>({})
  const seenWaiting = new Set<string>()

  const seatModels: DrawSeatModel[] = []
  const seatViews: Array<{
    seatId: SeatId
    agent: OfficeAgent | null
    label: string
    presentation: ReturnType<typeof presentSeat> | null
    frame: 0 | 1
    egg: string
  }> = []

  for (const seatId of SEAT_IDS) {
    const agent = assignment.seats[seatId]
    if (!agent) {
      seatModels.push({
        seatId,
        box: SEAT_LAYOUT[seatId],
        occupied: false,
        lookIndex: SEAT_IDS.indexOf(seatId),
        presentation: null,
        frame: 0,
        selected: false,
      })
      seatViews.push({ seatId, agent: null, label: '', presentation: null, frame: 0, egg: '' })
      continue
    }

    const playRaise = agent.status === 'waiting' && agent.freshness === 'fresh' && !reduced
    let waitingSince: number | null = null
    if (playRaise) {
      seenWaiting.add(agent.id)
      if (waitingRef.current[agent.id] == null) waitingRef.current[agent.id] = clock
      waitingSince = waitingRef.current[agent.id] ?? clock
    }

    const egg = eggRef.current[agent.id]?.activeEgg ?? null
    const presentation = presentSeat(agent, { reducedMotion: reduced, now: clock, waitingSince, egg })
    let frame: 0 | 1
    if (presentation.animate) {
      frame = Math.floor(clock / 280) % 2 === 0 ? 0 : 1
      frameRef.current[agent.id] = frame
    } else {
      frame = frameRef.current[agent.id] ?? 0
    }

    seatModels.push({
      seatId,
      box: SEAT_LAYOUT[seatId],
      occupied: true,
      lookIndex: SEAT_IDS.indexOf(seatId),
      presentation,
      frame,
      selected: agent.id === selectedId,
    })
    seatViews.push({
      seatId,
      agent,
      label: agentAriaLabel(agent),
      presentation,
      frame,
      egg: egg ?? '',
    })
  }

  for (const id of Object.keys(waitingRef.current)) {
    if (!seenWaiting.has(id)) delete waitingRef.current[id]
  }

  const counts = Object.fromEntries(AGENT_STATUSES.map((status) => [status, 0])) as Record<AgentStatus, number>
  for (const seatId of SEAT_IDS) {
    const agent = assignment.seats[seatId]
    if (agent) counts[agent.status] += 1
  }

  const selected = agents.find((agent) => agent.id === selectedId) ?? null
  const stageW = Math.round(LOGICAL_WIDTH * scale)
  const stageH = Math.round(LOGICAL_HEIGHT * scale)
  const fontSize = Math.max(8, 11 * (scale >= 1 ? Math.min(scale, 3) : scale))

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const pixelScale = Number.isInteger(scale) && scale >= 1 ? scale : 1
    const bufferW = LOGICAL_WIDTH * pixelScale
    const bufferH = LOGICAL_HEIGHT * pixelScale
    if (canvas.width !== bufferW || canvas.height !== bufferH) {
      canvas.width = bufferW
      canvas.height = bufferH
    }
    const context = canvas.getContext('2d')
    if (!context) return
    context.setTransform(pixelScale, 0, 0, pixelScale, 0, 0)
    context.imageSmoothingEnabled = false
    drawOffice(context, { seats: seatModels, reducedMotion: reduced, tick: Math.floor(clock / 280) % 2 === 0 ? 0 : 1 })
  })

  const rootClass = className ? `ao-scene ${className}` : 'ao-scene'

  return (
    <div
      ref={rootRef}
      className={rootClass}
      role="group"
      aria-label="代理人辦公室"
      data-reduced-motion={reduced ? 'true' : 'false'}
    >
      <div className="ao-stage" style={{ width: stageW, height: stageH, fontSize }}>
        <canvas ref={canvasRef} className="ao-canvas" width={LOGICAL_WIDTH} height={LOGICAL_HEIGHT} aria-hidden="true" />

        <section className="ao-board" style={boxStyle(LAYOUT.manager, scale)} aria-label="座位概況">
          <h2 className="ao-board-title">座位</h2>
          <ul className="ao-counts">
            {AGENT_STATUSES.map((status) => (
              <li key={status} data-count={status}>
                <span>{STATUS_LABEL[status]}</span>
                <span>{counts[status]}</span>
              </li>
            ))}
          </ul>
          <p className="ao-board-selection">
            {selected ? (
              <>
                <span className="ao-kicker">選中</span>
                <strong>{selected.name}</strong>
                <span>{selected.task?.title ?? '沒有進行中的任務'}</span>
                {selected.task?.source ? <span className="ao-source">{selected.task.source}</span> : null}
                {selected.freshness === 'stale' ? <span className="ao-kicker">過期讀數</span> : null}
              </>
            ) : (
              <span>尚未選擇</span>
            )}
          </p>
          {assignment.overflow.length > 0 ? (
            <p className="ao-overflow">{assignment.overflow.length} 人沒有座位</p>
          ) : null}
        </section>

        <ul className="ao-legend" style={boxStyle(LAYOUT.legend, scale)} aria-label="狀態圖例">
          {AGENT_STATUSES.map((status) => (
            <li key={status}>
              <PixelIcon name={LEGEND_ICON[status]} className={`ao-legend-icon ao-legend-icon-${status}`} />
              <span>{STATUS_LABEL[status]}</span>
            </li>
          ))}
        </ul>

        {seatViews.map((view) => {
          const box = SEAT_LAYOUT[view.seatId]
          const style = boxStyle(box, scale)
          if (!view.agent || !view.presentation) {
            return (
              <div key={view.seatId} className="ao-seat ao-seat-empty" style={style} data-seat={view.seatId} aria-hidden="true">
                <span className="ao-nameplate">
                  <span className="ao-name">空位</span>
                  <span className="ao-role">{view.seatId}</span>
                </span>
              </div>
            )
          }

          const { agent, presentation } = view
          const taskTitle = agent.task
            ? `${agent.task.title}${agent.task.source ? ` · ${agent.task.source}` : ''}`
            : undefined

          return (
            <button
              key={view.seatId}
              type="button"
              className="ao-seat"
              style={style}
              data-seat={view.seatId}
              data-testid={`agent-${agent.id}`}
              data-agent-id={agent.id}
              data-status={agent.status}
              data-freshness={agent.freshness}
              data-connected={agent.connected ? 'true' : 'false'}
              data-selected={agent.id === selectedId ? 'true' : 'false'}
              data-monitor={presentation.monitor}
              data-bubble={presentation.bubble ?? ''}
              data-pose={presentation.pose}
              data-animate={presentation.animate ? 'true' : 'false'}
              data-frame={view.frame}
              data-desaturate={presentation.desaturate ? 'true' : 'false'}
              data-dim={presentation.dim ? 'true' : 'false'}
              data-opacity={presentation.opacity}
              data-document={presentation.deskDocument ? 'true' : 'false'}
              data-plug={presentation.plugIcon ? 'true' : 'false'}
              data-egg={view.egg}
              aria-label={view.label}
              aria-pressed={agent.id === selectedId}
              title={taskTitle}
              onClick={() => onSelect?.(agent.id)}
            >
              <span className="ao-nameplate">
                <span className="ao-name">{agent.name}</span>
                <span className="ao-role">{agent.role}</span>
                {presentation.offlineLabel ? <span className="ao-flag ao-offline">離線</span> : null}
                {!agent.connected && agent.status !== 'offline' ? (
                  <span className="ao-flag ao-disconnected">斷線</span>
                ) : null}
                {presentation.staleTag ? (
                  <span className="ao-flag ao-stale">過期・{formatUpdatedAt(agent.lastUpdatedAt)}</span>
                ) : null}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

export type { OfficeSceneProps } from './types'
