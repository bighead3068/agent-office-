import type { EasterEggId } from './easterEggs'
import { isEasterEggEligible } from './easterEggs'
import type { AgentStatus, OfficeAgent } from './types'

/** How long the one-shot "hand raise" takes before it holds. */
export const WAIT_RAISE_MS = 700

export type MonitorCue = 'blue' | 'yellow' | 'amber' | 'green' | 'red' | 'dim' | 'off' | 'grey'

export type BubbleCue = 'gear' | 'ellipsis' | 'block' | 'check' | 'bang' | 'question' | null

export type PoseCue =
  | 'typing'
  | 'hand-raising'
  | 'hand-up'
  | 'sit'
  | 'slump'
  | 'breathe'
  | 'coffee'
  | 'nap'
  | 'water'

export interface SeatPresentation {
  monitor: MonitorCue
  bubble: BubbleCue
  pose: PoseCue
  /** False when motion must stop: reduced motion, stale, or a pose that is already still. */
  animate: boolean
  desaturate: boolean
  /** Offline characters are greyscale and dimmed. */
  dim: boolean
  /** Unknown characters are drawn at this opacity. Everyone else is 1. */
  opacity: number
  /** Unknown characters are also recolored grey. */
  grey: boolean
  deskDocument: boolean
  plugIcon: boolean
  offlineLabel: boolean
  staleTag: boolean
}

interface StatusBase {
  monitor: MonitorCue
  bubble: BubbleCue
  pose: PoseCue
  animate: boolean
}

const STATUS_BASE: Record<AgentStatus, StatusBase> = {
  working: { monitor: 'blue', bubble: 'gear', pose: 'typing', animate: true },
  waiting: { monitor: 'yellow', bubble: 'ellipsis', pose: 'hand-up', animate: true },
  blocked: { monitor: 'amber', bubble: 'block', pose: 'sit', animate: false },
  completed: { monitor: 'green', bubble: 'check', pose: 'sit', animate: false },
  failed: { monitor: 'red', bubble: 'bang', pose: 'slump', animate: false },
  idle: { monitor: 'dim', bubble: null, pose: 'breathe', animate: true },
  unknown: { monitor: 'grey', bubble: 'question', pose: 'sit', animate: false },
  offline: { monitor: 'off', bubble: null, pose: 'sit', animate: false },
}

export interface PresentSeatOptions {
  reducedMotion: boolean
  now: number
  /** When the current fresh waiting streak was first observed. Null if not playing the raise. */
  waitingSince: number | null
  /** Egg already vetted by the state machine. Ignored unless the agent is still eligible. */
  egg: EasterEggId | null
}

/**
 * Map an agent to draw cues. Every status has at least two non-color cues
 * (pose, bubble glyph, desk prop, or nameplate label) in addition to the monitor.
 * Stale keeps the status cues, forces `animate` off, and asks for desaturation.
 */
export function presentSeat(agent: OfficeAgent, options: PresentSeatOptions): SeatPresentation {
  const base = STATUS_BASE[agent.status] ?? STATUS_BASE.unknown
  const stale = agent.freshness === 'stale'
  let pose = base.pose
  let animate = base.animate
  let bubble = base.bubble

  if (agent.status === 'waiting') {
    const elapsed =
      options.waitingSince == null ? WAIT_RAISE_MS : Math.max(0, options.now - options.waitingSince)
    const held = options.reducedMotion || stale || elapsed >= WAIT_RAISE_MS
    pose = held ? 'hand-up' : 'hand-raising'
    animate = !held
  }

  const eggAllowed =
    options.egg != null &&
    !options.reducedMotion &&
    !stale &&
    isEasterEggEligible(agent)

  if (eggAllowed && options.egg) {
    pose = options.egg
    bubble = null
    animate = true
  }

  if (stale || options.reducedMotion) animate = false

  return {
    monitor: base.monitor,
    bubble,
    pose,
    animate,
    desaturate: stale,
    dim: agent.status === 'offline',
    opacity: agent.status === 'unknown' ? 0.55 : 1,
    grey: agent.status === 'unknown',
    deskDocument: agent.status === 'completed',
    plugIcon: agent.status === 'offline',
    offlineLabel: agent.status === 'offline',
    staleTag: stale,
  }
}

export const STATUS_WORD: Record<AgentStatus, string> = {
  working: "工作中",
  waiting: "等待中",
  blocked: "受阻",
  completed: "已完成",
  failed: "失敗",
  idle: "明確閒置",
  unknown: "未知",
  offline: "明確離線",
}

/** Format a timestamp for the stale tag and the accessible name. Unparseable strings pass through. */
export function formatUpdatedAt(value: string | undefined): string {
  if (!value) return "時間不明"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  const parts = new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date)
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? ""
  return `${part("month")}/${part("day")} ${part("hour")}:${part("minute")}`
}

/**
 * Accessible name in Traditional Chinese.
 * Stale and disconnected are spoken as well so they are not color-only.
 */
export function agentAriaLabel(agent: OfficeAgent): string {
  const updated = formatUpdatedAt(agent.lastUpdatedAt)
  const stale = agent.freshness === "stale" ? "，過期" : ""
  const disconnected = !agent.connected && agent.status !== "offline" ? "，斷線" : ""
  return `${agent.name}，${agent.role}，${STATUS_WORD[agent.status]}${stale}${disconnected}，上次更新 ${updated}`
}
