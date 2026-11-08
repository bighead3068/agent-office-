import { describe, expect, it } from 'vitest'
import { SIT_SPRITE } from './character'
import { agentAriaLabel, formatUpdatedAt, presentSeat } from './presentation'
import { makeAgent } from './testing/makeAgent'

const base = {
  reducedMotion: false,
  now: 0,
  waitingSince: 0,
  egg: null,
}

describe('presentSeat', () => {
  it('gives every live status more than a color', () => {
    const working = presentSeat(makeAgent({ id: 'a', status: 'working' }), base)
    expect(working).toMatchObject({ monitor: 'blue', bubble: 'gear', pose: 'typing', animate: true, deskDocument: false })

    const waiting = presentSeat(makeAgent({ id: 'a', status: 'waiting' }), { ...base, now: 0, waitingSince: 0 })
    expect(waiting.monitor).toBe('yellow')
    expect(waiting.bubble).toBe('ellipsis')
    expect(waiting.pose).toBe('hand-raising')

    const held = presentSeat(makeAgent({ id: 'a', status: 'waiting' }), { ...base, now: 700, waitingSince: 0 })
    expect(held.pose).toBe('hand-up')
    expect(held.animate).toBe(false)

    const completed = presentSeat(makeAgent({ id: 'a', status: 'completed' }), base)
    expect(completed).toMatchObject({
      monitor: 'green',
      bubble: 'check',
      pose: 'sit',
      animate: false,
      deskDocument: true,
    })
    expect(completed.pose).not.toBe('breathe')

    const failed = presentSeat(makeAgent({ id: 'a', status: 'failed' }), base)
    expect(failed).toMatchObject({ monitor: 'red', bubble: 'bang', pose: 'slump', animate: false })

    const idle = presentSeat(makeAgent({ id: 'a', status: 'idle' }), base)
    expect(idle).toMatchObject({ monitor: 'dim', bubble: null, pose: 'breathe', animate: true })

    const unknown = presentSeat(makeAgent({ id: 'a', status: 'unknown', connected: true }), base)
    expect(unknown).toMatchObject({
      monitor: 'grey',
      bubble: 'question',
      pose: 'sit',
      animate: false,
      opacity: 0.55,
      grey: true,
    })

    const offline = presentSeat(makeAgent({ id: 'a', status: 'offline' }), base)
    expect(offline).toMatchObject({
      monitor: 'off',
      bubble: null,
      pose: 'sit',
      animate: false,
      dim: true,
      plugIcon: true,
      offlineLabel: true,
    })
  })

  it('keeps the last status while freezing and desaturating stale data', () => {
    const stale = presentSeat(makeAgent({ id: 'a', status: 'working', freshness: 'stale' }), {
      ...base,
      egg: 'nap',
    })
    expect(stale).toMatchObject({
      monitor: 'blue',
      bubble: 'gear',
      pose: 'typing',
      animate: false,
      desaturate: true,
      staleTag: true,
    })
  })

  it('holds the waiting pose immediately when stale or reduced motion', () => {
    const stale = presentSeat(makeAgent({ id: 'a', status: 'waiting', freshness: 'stale' }), base)
    expect(stale.pose).toBe('hand-up')
    expect(stale.animate).toBe(false)
    const reduced = presentSeat(makeAgent({ id: 'a', status: 'waiting' }), { ...base, reducedMotion: true })
    expect(reduced.pose).toBe('hand-up')
    expect(reduced.animate).toBe(false)
    expect(reduced.bubble).toBe('ellipsis')
    expect(reduced.monitor).toBe('yellow')
  })

  it('plays an egg only for an eligible idle agent', () => {
    const egg = presentSeat(makeAgent({ id: 'a', status: 'idle' }), { ...base, egg: 'coffee' })
    expect(egg.pose).toBe('coffee')
    expect(egg.bubble).toBeNull()
    expect(egg.animate).toBe(true)

    const completed = presentSeat(makeAgent({ id: 'a', status: 'completed' }), { ...base, egg: 'nap' })
    expect(completed.pose).toBe('sit')
    const unknown = presentSeat(makeAgent({ id: 'a', status: 'unknown', connected: true }), { ...base, egg: 'water' })
    expect(unknown.pose).toBe('sit')
    const stale = presentSeat(makeAgent({ id: 'a', status: 'idle', freshness: 'stale' }), { ...base, egg: 'nap' })
    expect(stale.pose).toBe('breathe')
    expect(stale.animate).toBe(false)
  })

  it('drops looping motion under reduced motion and keeps the idle monitor', () => {
    const idle = presentSeat(makeAgent({ id: 'a', status: 'idle' }), { ...base, reducedMotion: true, egg: 'nap' })
    expect(idle.animate).toBe(false)
    expect(idle.pose).toBe('breathe')
    expect(idle.monitor).toBe('dim')
  })
})

describe('agentAriaLabel', () => {
  it('reads name, role, status, and last updated', () => {
    expect(
      agentAriaLabel(
        makeAgent({
          id: 'a',
          name: 'Nia',
          role: 'Implementer',
          status: 'working',
          lastUpdatedAt: 'yesterday morning',
        }),
      ),
    ).toBe('Nia，Implementer，工作中，上次更新 yesterday morning')
  })

  it('announces stale and disconnected without pretending the time is live', () => {
    expect(
      agentAriaLabel(
        makeAgent({
          id: 'a',
          name: 'Moss',
          role: 'Researcher',
          status: 'idle',
          freshness: 'stale',
          connected: false,
          lastUpdatedAt: '2026-11-07T18:42:00.000Z',
        }),
      ),
    ).toMatch(/^Moss，Researcher，明確閒置，過期，斷線，上次更新 11\/08 02:42$/)
    expect(formatUpdatedAt(undefined)).toBe('時間不明')
    expect(formatUpdatedAt('not a date')).toBe('not a date')
  })
})

describe('sprites', () => {
  it('keeps the seated sprite on a 14-wide grid', () => {
    expect(SIT_SPRITE.length).toBeGreaterThan(8)
    expect(SIT_SPRITE.every((row) => row.length === 14)).toBe(true)
  })
})
