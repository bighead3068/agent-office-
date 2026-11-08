import { describe, expect, it } from 'vitest'
import { LOGICAL_HEIGHT, LOGICAL_WIDTH, TILE_COLUMNS, TILE_ROWS, TILE_SIZE, computeScale } from './layout'
import { assignSeats, emptyOwners } from './seats'
import { makeAgent } from './testing/makeAgent'

describe('assignSeats', () => {
  it('fills S1–S5 in input order and keeps the seat when status or order changes', () => {
    const first = assignSeats(
      [
        makeAgent({ id: 'a', name: 'Nia', status: 'working' }),
        makeAgent({ id: 'b', name: 'Moss', status: 'waiting' }),
        makeAgent({ id: 'c', name: 'Sol', status: 'completed' }),
      ],
      emptyOwners(),
    )
    expect(first.seats.S1?.id).toBe('a')
    expect(first.seats.S2?.id).toBe('b')
    expect(first.seats.S3?.id).toBe('c')
    expect(first.seats.S4).toBeNull()
    expect(first.seats.S5).toBeNull()

    const next = assignSeats(
      [
        makeAgent({ id: 'c', status: 'failed' }),
        makeAgent({ id: 'a', status: 'idle' }),
        makeAgent({ id: 'b', status: 'waiting' }),
      ],
      first.nextOwners,
    )
    expect(next.seats.S1?.id).toBe('a')
    expect(next.seats.S1?.status).toBe('idle')
    expect(next.seats.S2?.id).toBe('b')
    expect(next.seats.S3?.id).toBe('c')
    expect(next.seats.S3?.status).toBe('failed')
  })

  it('gives a new agent the lowest free seat and reports overflow', () => {
    const ids = ['a', 'b', 'c', 'd', 'e', 'f']
    const full = assignSeats(
      ids.map((id) => makeAgent({ id })),
      emptyOwners(),
    )
    expect(full.overflow.map((agent) => agent.id)).toEqual(['f'])
    const freed = assignSeats(
      ['b', 'c', 'd', 'e', 'f'].map((id) => makeAgent({ id })),
      full.nextOwners,
    )
    expect(freed.seats.S1?.id).toBe('f')
    expect(freed.seats.S2?.id).toBe('b')
    expect(freed.overflow).toEqual([])
  })
})

describe('computeScale', () => {
  it('uses integer factors at or above the logical width and fits below it', () => {
    expect(TILE_COLUMNS).toBe(20)
    expect(TILE_ROWS).toBe(12)
    expect(TILE_SIZE).toBe(32)
    expect(LOGICAL_WIDTH).toBe(640)
    expect(LOGICAL_HEIGHT).toBe(384)
    expect(computeScale(0)).toBe(1)
    expect(computeScale(640)).toBe(1)
    expect(computeScale(1280)).toBe(2)
    expect(computeScale(400)).toBeCloseTo(400 / 640)
    expect(computeScale(1000)).toBeCloseTo(1000 / 640)
  })
})
