/**
 * Public types for the Agent Office scene.
 *
 * The component renders the agents it is given. It does not infer idle,
 * freshness, or connectivity from heartbeats, task events, or the clock.
 */

export const AGENT_STATUSES = [
  'working',
  'waiting',
  'blocked',
  'failed',
  'completed',
  'idle',
  'unknown',
  'offline',
] as const

export type AgentStatus = (typeof AGENT_STATUSES)[number]

export type Freshness = 'fresh' | 'stale'

export type DeskPresence = 'away' | 'unseated'

export interface OfficeTask {
  /** Short label shown on the summary board when this agent is selected. */
  title: string
  /** Optional origin note, such as a queue or board name. Display only. */
  source?: string
  /** Optional task timestamp. ISO-8601 or an already-formatted string. */
  updatedAt?: string
}

export interface OfficeAgent {
  id: string
  name: string
  role: string
  status: AgentStatus
  /** Last reported status when `status` is the effective unknown/offline view. */
  lastKnownStatus?: AgentStatus
  task?: OfficeTask
  /**
   * `stale` overlays whatever `status` is: keep the last known cues, freeze
   * motion on the last drawn frame, desaturate them, and show a stale tag.
   * The scene never treats stale data as live.
   */
  freshness: Freshness
  /** Shown on the stale tag and in the accessible name. */
  lastUpdatedAt?: string
  /** False means this agent is not eligible for easter eggs. */
  connected: boolean
  /** Show an empty chair for this agent while keeping its reported status. */
  deskPresence?: DeskPresence
}

export const SEAT_IDS = ['S1', 'S2', 'S3', 'S4', 'S5'] as const

export type SeatId = (typeof SEAT_IDS)[number]

/**
 * Timing for idle easter eggs. These are configuration values, not fixed rules.
 * `OFFICE_SCENE_TEST_DEFAULTS` is what the component uses when `config` is omitted.
 */
export interface OfficeSceneConfig {
  /** How long the agent must stay eligible before an easter egg may start. */
  easterEggIdleWaitMs: number
  /** Minimum time between easter-egg starts for the same agent. */
  easterEggFrequencyCapMs: number
  /** Playback length in ms. Values above {@link MAX_EASTER_EGG_DURATION_MS} are clamped. */
  easterEggDurationMs: number
}

/** Hard cap. Eggs are short beats, not long loops. */
export const MAX_EASTER_EGG_DURATION_MS = 8000

/**
 * Short timings so tests (and a local demo) can observe eggs without a long wait.
 * Override these when embedding the scene in a calmer product surface.
 */
export const OFFICE_SCENE_TEST_DEFAULTS: OfficeSceneConfig = {
  easterEggIdleWaitMs: 1000,
  easterEggFrequencyCapMs: 5000,
  easterEggDurationMs: 4000,
}

export interface OfficeSceneProps {
  agents: OfficeAgent[]
  /** List and label the statuses used by this view. Unlisted statuses keep their accessible names. */
  statusLabels?: Partial<Record<AgentStatus, string>>
  /** Id of the agent whose seat should show the selection highlight. */
  selectedId?: string
  /** Called with the agent id when a seat is clicked, tapped, or activated with Enter/Space. */
  onSelect?: (id: string) => void
  /** Partial timing overrides. Missing fields fall back to {@link OFFICE_SCENE_TEST_DEFAULTS}. */
  config?: Partial<OfficeSceneConfig>
  /** Enables the supervisor patrol and short, cosmetic breaks after completion. */
  playful?: boolean
  /** The localStorage key for this floor's seat assignments. */
  seatStorageKey?: string
  /** Allow incoming agents to take a vacated or finished owner's desk. */
  rotateSeats?: boolean
  /**
   * Optional clock in ms. When set, the scene does not run its own timer.
   * Tests use this to advance easter eggs and the one-shot waiting pose.
   * Omit it in production and the scene uses `Date.now()`.
   */
  now?: number
  /**
   * Overrides the `prefers-reduced-motion` media query when set.
   * `true` freezes looping motion and blocks easter eggs. Static status cues stay.
   */
  reducedMotion?: boolean
  /** Extra class on the root element for layout in a host app. */
  className?: string
}
