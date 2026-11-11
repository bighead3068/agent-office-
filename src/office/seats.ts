import { SEAT_IDS, type OfficeAgent, type SeatId } from './types'

export interface SeatAssignment {
  seats: Record<SeatId, OfficeAgent | null>
  /** Agents past the five desks, in input order, after duplicates are skipped. */
  overflow: OfficeAgent[]
  nextOwners: Record<SeatId, string | null>
}

export function emptyOwners(): Record<SeatId, string | null> {
  return { S1: null, S2: null, S3: null, S4: null, S5: null }
}

export function readSeatOwners(key: string | undefined): SeatAssignment['nextOwners'] {
  const owners = emptyOwners()
  if (!key) return owners
  try {
    const stored: unknown = JSON.parse(window.localStorage.getItem(key) ?? 'null')
    if (!stored || typeof stored !== 'object') return owners
    const seen = new Set<string>()
    for (const seat of SEAT_IDS) {
      const id = (stored as Record<string, unknown>)[seat]
      if (typeof id !== 'string' || !id || seen.has(id)) continue
      owners[seat] = id
      seen.add(id)
    }
  } catch {
    // Unavailable storage and malformed saves both start with empty desks.
  }
  return owners
}

export function saveSeatOwners(key: string, serializedOwners: string) {
  try {
    window.localStorage.setItem(key, serializedOwners)
  } catch {
    // Seating can continue in memory when browser storage is unavailable.
  }
}

const TERMINAL_DESK_RANK = 2
const ACTIVE_DESK_RANK = 3

function replacementRank(agent: OfficeAgent): number {
  if (agent.deskPresence === 'away') return 0
  if (agent.deskPresence === 'unseated') return 1
  if (agent.status === 'completed' || agent.status === 'failed') return TERMINAL_DESK_RANK
  return ACTIVE_DESK_RANK
}

function updateTime(agent: OfficeAgent): number {
  const timestamp = Date.parse(agent.lastUpdatedAt ?? '')
  return Number.isFinite(timestamp) ? timestamp : Number.NEGATIVE_INFINITY
}

/**
 * Bind agents to S1–S5.
 *
 * Existing ids keep their seat when status, order, or freshness changes.
 * New ids fill the lowest free seat in input order. Empty seats stay empty.
 * More than five agents leave the extras in `overflow` (they are counted, not drawn).
 */
export function assignSeats(
  agents: readonly OfficeAgent[],
  previousOwners: Readonly<Record<SeatId, string | null>>,
  rotateSeats = false,
): SeatAssignment {
  const byId = new Map<string, OfficeAgent>()
  for (const agent of agents) {
    if (!byId.has(agent.id)) byId.set(agent.id, agent)
  }

  const owners: Record<SeatId, string | null> = { ...previousOwners }
  const seated = new Set<string>()

  for (const seat of SEAT_IDS) {
    const id = owners[seat]
    if (id && byId.has(id)) seated.add(id)
    else owners[seat] = null
  }

  const active = rotateSeats ? [...byId.values()].filter((agent) => replacementRank(agent) === ACTIVE_DESK_RANK) : agents
  const recentFinishes = rotateSeats
    ? [...byId.values()].filter((agent) => !seated.has(agent.id) && replacementRank(agent) === TERMINAL_DESK_RANK
        && agent.connected && agent.freshness === 'fresh')
      .sort((a, b) => updateTime(b) - updateTime(a))
    : []
  const replaceable = rotateSeats
    ? SEAT_IDS.flatMap((seat) => {
        const owner = byId.get(owners[seat] ?? '')
        return owner && replacementRank(owner) < ACTIVE_DESK_RANK ? [{ seat, owner }] : []
      }).sort((a, b) => replacementRank(a.owner) - replacementRank(b.owner) || updateTime(a.owner) - updateTime(b.owner))
    : []

  function claim(agent: OfficeAgent, seat: SeatId) {
    const former = owners[seat]
    if (former) seated.delete(former)
    owners[seat] = agent.id
    seated.add(agent.id)
  }

  for (const agent of active) {
    if (seated.has(agent.id)) continue
    const open = SEAT_IDS.find((seat) => owners[seat] == null) ?? replaceable.shift()?.seat
    if (open) claim(agent, open)
  }

  // A job may finish between two snapshots. Let recent finishes use any
  // vacancy or replace an older inactive owner. Strict time ordering prevents
  // those two finished agents from swapping seats back on the next snapshot.
  for (const agent of recentFinishes) {
    const open = SEAT_IDS.find((seat) => owners[seat] == null)
    if (open) {
      claim(agent, open)
      continue
    }
    const older = replaceable.findIndex(({ owner }) => updateTime(owner) < updateTime(agent))
    if (older >= 0) claim(agent, replaceable.splice(older, 1)[0].seat)
  }

  // On a fresh floor, show recent/away owners in otherwise empty desks. On
  // later updates, away owners keep their current desk until they are replaced.
  if (rotateSeats && SEAT_IDS.every((seat) => previousOwners[seat] == null)) {
    for (const agent of byId.values()) {
      if (seated.has(agent.id)) continue
      const open = SEAT_IDS.find((seat) => owners[seat] == null)
      if (!open) break
      claim(agent, open)
    }
  }

  const seats = {} as Record<SeatId, OfficeAgent | null>
  for (const seat of SEAT_IDS) {
    const id = owners[seat]
    seats[seat] = id ? (byId.get(id) ?? null) : null
  }

  const overflow = agents.filter((agent, index) => {
    if (seated.has(agent.id) && agents.findIndex((item) => item.id === agent.id) !== index) {
      return true
    }
    return !seated.has(agent.id)
  })

  return { seats, overflow, nextOwners: owners }
}
