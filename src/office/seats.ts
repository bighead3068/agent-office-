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

  for (const agent of agents) {
    if (seated.has(agent.id)) continue
    const open = SEAT_IDS.find((seat) => owners[seat] == null)
    if (!open) continue
    owners[open] = agent.id
    seated.add(agent.id)
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
