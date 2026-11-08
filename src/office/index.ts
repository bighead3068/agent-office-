export { OfficeScene } from './OfficeScene'
export {
  EASTER_EGGS,
  createAgentEggState,
  isEasterEggEligible,
  pickEgg,
  resolveOfficeSceneConfig,
  stepAgentEgg,
} from './easterEggs'
export type { AgentEggState, EasterEggId } from './easterEggs'
export { agentAriaLabel, formatUpdatedAt, presentSeat } from './presentation'
export type { BubbleCue, MonitorCue, PoseCue, SeatPresentation } from './presentation'
export { assignSeats, emptyOwners } from './seats'
export {
  AGENT_STATUSES,
  MAX_EASTER_EGG_DURATION_MS,
  OFFICE_SCENE_TEST_DEFAULTS,
  SEAT_IDS,
} from './types'
export type {
  AgentStatus,
  Freshness,
  OfficeAgent,
  OfficeSceneConfig,
  OfficeSceneProps,
  OfficeTask,
  SeatId,
} from './types'
