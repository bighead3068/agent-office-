import {
  MAX_EASTER_EGG_DURATION_MS,
  OFFICE_SCENE_TEST_DEFAULTS,
  type OfficeAgent,
  type OfficeSceneConfig,
} from './types'

/**
 * Cosmetic floor beats, separate from reported status.
 */
export const EASTER_EGGS = ['coffee', 'nap', 'water'] as const

export type EasterEggId = (typeof EASTER_EGGS)[number]

export interface AgentEggState {
  /** When the current uninterrupted eligible streak began. */
  eligibleSince: number | null
  activeEgg: EasterEggId | null
  activeStartedAt: number | null
  /** Start time of the latest egg, including ones cut short. Used for the frequency cap. */
  lastStartedAt: number | null
  /** How many eggs have started for this agent. Cycles coffee → nap → water. */
  occurrence: number
  /** The status and task that began the current playful break. */
  activityKey?: string
}

export function createAgentEggState(): AgentEggState {
  return {
    eligibleSince: null,
    activeEgg: null,
    activeStartedAt: null,
    lastStartedAt: null,
    occurrence: 0,
  }
}

/**
 * Breaks require a present, fresh, connected agent with an eligible status.
 * A playful floor also allows a brief break after completion.
 */
export function isEasterEggEligible(
  agent: Pick<OfficeAgent, 'status' | 'freshness' | 'connected' | 'deskPresence'>,
  playful = false,
): boolean {
  return (agent.status === 'idle' || (playful && agent.status === 'completed'))
    && agent.freshness === 'fresh' && agent.connected === true && !agent.deskPresence
}

function playfulDelay(id: string, occurrence: number): number {
  let hash = 0
  for (let index = 0; index < id.length; index += 1) {
    hash = (Math.imul(hash, 31) + id.charCodeAt(index)) >>> 0
  }
  return ((hash % 2500) + occurrence * 113) % 2500
}

function clampNumber(value: number | undefined, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, value))
}

/** Fills missing timing fields and clamps duration to 0…8000ms. */
export function resolveOfficeSceneConfig(partial?: Partial<OfficeSceneConfig>): OfficeSceneConfig {
  return {
    easterEggIdleWaitMs: clampNumber(
      partial?.easterEggIdleWaitMs,
      OFFICE_SCENE_TEST_DEFAULTS.easterEggIdleWaitMs,
      0,
      Number.POSITIVE_INFINITY,
    ),
    easterEggFrequencyCapMs: clampNumber(
      partial?.easterEggFrequencyCapMs,
      OFFICE_SCENE_TEST_DEFAULTS.easterEggFrequencyCapMs,
      0,
      Number.POSITIVE_INFINITY,
    ),
    easterEggDurationMs: clampNumber(
      partial?.easterEggDurationMs,
      OFFICE_SCENE_TEST_DEFAULTS.easterEggDurationMs,
      0,
      MAX_EASTER_EGG_DURATION_MS,
    ),
  }
}

/**
 * Stable cycle so a long-idle agent eventually shows every egg, and so two
 * agents with different ids do not always sip coffee together.
 */
export function pickEgg(agentId: string, occurrence: number): EasterEggId {
  let hash = 0
  for (let i = 0; i < agentId.length; i += 1) {
    hash = (hash + agentId.charCodeAt(i)) >>> 0
  }
  const index = (hash + occurrence) % EASTER_EGGS.length
  return EASTER_EGGS[index] ?? 'coffee'
}

/**
 * Advance one agent's egg clock.
 *
 * - An ineligible status or an absent, stale, or disconnected agent clears the
 *   break immediately. In playful mode a new task also starts a new streak.
 * - The wait is measured from when this state machine first observes the
 *   eligible condition. There is no hidden "idle since" input.
 * - After an egg ends, the idle wait starts over, and the frequency cap blocks
 *   a new start until `easterEggFrequencyCapMs` has passed since the last start.
 * - Reduced motion never starts an egg and clears one that is already playing.
 */
export function stepAgentEgg(
  agent: Pick<OfficeAgent, 'id' | 'status' | 'freshness' | 'connected' | 'deskPresence' | 'task'>,
  prev: AgentEggState,
  now: number,
  config: OfficeSceneConfig,
  reducedMotion: boolean,
  playful = false,
): AgentEggState {
  const eligible = isEasterEggEligible(agent, playful) && !reducedMotion

  if (!eligible) {
    return {
      eligibleSince: null,
      activeEgg: null,
      activeStartedAt: null,
      lastStartedAt: prev.lastStartedAt,
      occurrence: prev.occurrence,
    }
  }

  const activityKey = playful
    ? JSON.stringify([agent.status, agent.task?.title, agent.task?.source, agent.task?.updatedAt])
    : undefined
  const sameActivity = activityKey === prev.activityKey
  let eligibleSince = sameActivity ? (prev.eligibleSince ?? now) : now
  let activeEgg = sameActivity ? prev.activeEgg : null
  let activeStartedAt = sameActivity ? prev.activeStartedAt : null
  let lastStartedAt = prev.lastStartedAt
  let occurrence = prev.occurrence

  if (activeEgg != null && activeStartedAt != null && now - activeStartedAt >= config.easterEggDurationMs) {
    activeEgg = null
    activeStartedAt = null
    eligibleSince = now
  }

  const delay = playful ? playfulDelay(agent.id, occurrence) : 0
  const waited = now - eligibleSince >= config.easterEggIdleWaitMs + delay
  const capOk = lastStartedAt == null || now - lastStartedAt >= config.easterEggFrequencyCapMs

  if (activeEgg == null && waited && capOk && config.easterEggDurationMs > 0) {
    activeEgg = pickEgg(agent.id, occurrence)
    activeStartedAt = now
    lastStartedAt = now
    occurrence += 1
  }

  return {
    eligibleSince,
    activeEgg,
    activeStartedAt,
    lastStartedAt,
    occurrence,
    ...(activityKey ? { activityKey } : {}),
  }
}
