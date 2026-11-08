import {
  MAX_EASTER_EGG_DURATION_MS,
  OFFICE_SCENE_TEST_DEFAULTS,
  type OfficeAgent,
  type OfficeSceneConfig,
} from './types'

/**
 * Idle floor beats. They are not statuses. The scene plays one only when the
 * caller has already said the agent is idle, fresh, and connected.
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
 * Easter eggs are allowed only for an agent the caller marks as idle, fresh,
 * and connected. Completed, unknown (including a connected heartbeat with no
 * known status), stale, offline, disconnected, and every other status are
 * rejected. This function does not guess idle from timestamps or tasks.
 */
export function isEasterEggEligible(
  agent: Pick<OfficeAgent, 'status' | 'freshness' | 'connected'>,
): boolean {
  return agent.status === 'idle' && agent.freshness === 'fresh' && agent.connected === true
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
 * - Eligibility is sampled from the agent on every call. Leaving idle, fresh,
 *   or connected clears a playing egg in that same call.
 * - The idle wait is measured from when this state machine first observes the
 *   eligible condition. There is no hidden "idle since" input.
 * - After an egg ends, the idle wait starts over, and the frequency cap blocks
 *   a new start until `easterEggFrequencyCapMs` has passed since the last start.
 * - Reduced motion never starts an egg and clears one that is already playing.
 */
export function stepAgentEgg(
  agent: Pick<OfficeAgent, 'id' | 'status' | 'freshness' | 'connected'>,
  prev: AgentEggState,
  now: number,
  config: OfficeSceneConfig,
  reducedMotion: boolean,
): AgentEggState {
  const eligible = isEasterEggEligible(agent) && !reducedMotion

  if (!eligible) {
    return {
      eligibleSince: null,
      activeEgg: null,
      activeStartedAt: null,
      lastStartedAt: prev.lastStartedAt,
      occurrence: prev.occurrence,
    }
  }

  let eligibleSince = prev.eligibleSince ?? now
  let activeEgg = prev.activeEgg
  let activeStartedAt = prev.activeStartedAt
  let lastStartedAt = prev.lastStartedAt
  let occurrence = prev.occurrence

  if (activeEgg != null && activeStartedAt != null && now - activeStartedAt >= config.easterEggDurationMs) {
    activeEgg = null
    activeStartedAt = null
    eligibleSince = now
  }

  const waited = now - eligibleSince >= config.easterEggIdleWaitMs
  const capOk = lastStartedAt == null || now - lastStartedAt >= config.easterEggFrequencyCapMs

  if (activeEgg == null && waited && capOk) {
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
  }
}
