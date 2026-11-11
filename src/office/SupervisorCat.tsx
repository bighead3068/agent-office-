import { useId, useRef, useState } from 'react'
import type { Box } from './layout'
import type { AgentStatus } from './types'

const HOME = { x: 406, y: 331 }
const ROUTE = [
  { at: 0, ...HOME },
  { at: 1900, ...HOME },
  { at: 3350, x: 303, y: 327 },
  { at: 4450, x: 304, y: 253 },
  { at: 6250, x: 430, y: 248 },
  { at: 8050, x: 420, y: 125 },
  { at: 12550, x: 72, y: 116 },
  { at: 13100, x: 72, y: 116 },
  { at: 17450, x: 420, y: 120 },
  { at: 19650, x: 434, y: 283 },
  { at: 20650, ...HOME },
]

type PatrolInteraction = 'hover' | 'focus' | 'report'

export function useSupervisorPatrol(clock: number, reducedMotion: boolean) {
  const initialClock = useRef(clock)
  const interactions = useRef(new Set<PatrolInteraction>())
  const [pause, setPause] = useState<{ at: number | null; duration: number }>({ at: null, duration: 0 })

  function setInteraction(reason: PatrolInteraction, active: boolean) {
    if (active) interactions.current.add(reason)
    else interactions.current.delete(reason)
    const paused = interactions.current.size > 0
    setPause((previous) => {
      if (paused && previous.at == null) return { ...previous, at: clock }
      if (!paused && previous.at != null) {
        return { at: null, duration: previous.duration + Math.max(0, clock - previous.at) }
      }
      return previous
    })
  }

  const delta = (pause.at ?? clock) - initialClock.current - pause.duration
  const elapsed = Number.isFinite(delta) ? Math.max(0, delta) : 0
  const progress = elapsed % ROUTE[ROUTE.length - 1].at
  const nextIndex = ROUTE.findIndex((point) => point.at > progress)
  const from = ROUTE[nextIndex - 1]
  const to = ROUTE[nextIndex]
  const fraction = (progress - from.at) / (to.at - from.at)
  const walking = !reducedMotion && (from.x !== to.x || from.y !== to.y)
  const x = reducedMotion ? HOME.x : Math.round(from.x + (to.x - from.x) * fraction)
  const y = reducedMotion ? HOME.y : Math.round(from.y + (to.y - from.y) * fraction)

  return {
    x,
    y,
    facingLeft: walking && to.x < from.x,
    stride: walking && Math.floor(elapsed / 240) % 2 === 1,
    setInteraction,
    inspects: (box: Box) => !reducedMotion && Math.abs(x - (box.x + box.w / 2)) < 57
      && y >= box.y - 20 && y <= box.y + box.h,
  }
}

type SupervisorPatrol = ReturnType<typeof useSupervisorPatrol>

interface SupervisorCatProps {
  patrol: SupervisorPatrol
  scale: number
  statusCounts: Array<{ status: AgentStatus; label: string; count: number }>
  occupied: number
  capacity: number
  overflow: number
}

export function SupervisorCat({ patrol, scale, statusCounts, occupied, capacity, overflow }: SupervisorCatProps) {
  const reportId = useId()
  const [expanded, setExpanded] = useState(false)

  function toggleReport(next: boolean) {
    setExpanded(next)
    patrol.setInteraction('report', next)
  }

  const needsAttention = statusCounts.some(({ status, count }) => count > 0 && (status === 'failed' || status === 'blocked'))
  const message = needsAttention
    ? '喵，有工位需要幫忙。'
    : occupied > 0 ? '巡完這一圈，就去曬太陽。' : '空椅子很適合打盹。'

  return (
    <>
      <button
        className="ao-cat"
        type="button"
        style={{
          left: (patrol.x - 18) * scale,
          top: (patrol.y - 15) * scale,
          width: 36 * scale,
          height: 30 * scale,
        }}
        aria-label="貓咪主管巡查報告"
        aria-controls={reportId}
        aria-expanded={expanded}
        onPointerEnter={() => patrol.setInteraction('hover', true)}
        onPointerLeave={() => patrol.setInteraction('hover', false)}
        onFocus={() => patrol.setInteraction('focus', true)}
        onBlur={() => patrol.setInteraction('focus', false)}
        onClick={() => toggleReport(!expanded)}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && expanded) toggleReport(false)
        }}
      >
        <svg
          className="ao-cat-sprite"
          viewBox="0 0 18 14"
          shapeRendering="crispEdges"
          aria-hidden="true"
          style={{ transform: patrol.facingLeft ? 'scaleX(-1)' : undefined }}
        >
          <path fill="#3b261d" d="M1 3h3v3h2V5h4V2h2v1h3V2h2v3h1v5h-2v3h-3v-1H8v1H5v-2H4V9H2V7H1z" />
          <path fill="#e5a553" d="M2 4h1v3h2v2h1V7h4V5h1V3h1v2h3V3h1v3h1v3h-2v2H7V9H6V8H4V7H2z" />
          <path fill="#ffe3b7" d="M11 8h6v1h-2v1h-4zM7 10h3v1H7z" />
          <path fill="#8f502e" d="M5 7h2v1H5zM8 7h1v2H8zM12 5h1v1h-1zM14 5h1v1h-1z" />
          <path fill="#3b261d" d="M12 7h1v1h-1zM15 7h1v1h-1z" />
          <path fill="#c35450" d="M14 8h1v1h-1zM10 10h4v1h-4z" />
          <path fill="#fff2b9" d="M12 10h1v1h-1z" />
          <path fill="#e5a553" d={patrol.stride ? 'M5 11h2v1H5zM14 12h2v1h-2z' : 'M6 12h2v1H6zM13 11h2v1h-2z'} />
        </svg>
        <span className="ao-cat-label" aria-hidden="true">貓咪主管</span>
      </button>

      <section className="ao-cat-report" id={reportId} hidden={!expanded} aria-label="貓咪主管巡查報告">
        <h2>貓咪主管巡查報告</h2>
        <p>{message}</p>
        <p>入座 {occupied}／{capacity}{overflow > 0 ? `・未分配座位 ${overflow}` : ''}</p>
        <ul className="ao-counts">
          {statusCounts.map(({ status, label, count }) => <li key={status}>{label} {count}</li>)}
        </ul>
      </section>
    </>
  )
}
