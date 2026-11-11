import { describe, expect, it } from 'vitest'
import {
  createAgentEggState,
  isEasterEggEligible,
  pickEgg,
  resolveOfficeSceneConfig,
  stepAgentEgg,
  type AgentEggState,
} from './easterEggs'
import { MAX_EASTER_EGG_DURATION_MS, OFFICE_SCENE_TEST_DEFAULTS, type OfficeAgent, type OfficeSceneConfig } from './types'

const config: OfficeSceneConfig = {
  easterEggIdleWaitMs: 1000,
  easterEggFrequencyCapMs: 5000,
  easterEggDurationMs: 4000,
}

function agent(partial: Partial<OfficeAgent> & Pick<OfficeAgent, 'id' | 'status'>): OfficeAgent {
  return {
    name: partial.id,
    role: 'Agent',
    freshness: 'fresh',
    connected: true,
    ...partial,
  }
}

function run(
  person: OfficeAgent,
  times: number[],
  options?: { config?: OfficeSceneConfig; reduced?: boolean; start?: AgentEggState },
): AgentEggState[] {
  let state = options?.start ?? createAgentEggState()
  const trace: AgentEggState[] = []
  for (const time of times) {
    state = stepAgentEgg(person, state, time, options?.config ?? config, options?.reduced ?? false)
    trace.push(state)
  }
  return trace
}

describe('isEasterEggEligible', () => {
  it('allows only idle + fresh + connected', () => {
    expect(isEasterEggEligible(agent({ id: 'a', status: 'idle' }))).toBe(true)
  })

  it.each([
    ['working'],
    ['waiting'],
    ['blocked'],
    ['completed'],
    ['failed'],
    ['unknown'],
    ['offline'],
  ] as const)('rejects status %s even when fresh and connected', (status) => {
    expect(isEasterEggEligible(agent({ id: 'a', status }))).toBe(false)
  })

  it('rejects a connected heartbeat whose status is still unknown', () => {
    expect(
      isEasterEggEligible({ status: 'unknown', freshness: 'fresh', connected: true }),
    ).toBe(false)
  })

  it('rejects stale idle and disconnected idle', () => {
    expect(isEasterEggEligible(agent({ id: 'a', status: 'idle', freshness: 'stale' }))).toBe(false)
    expect(isEasterEggEligible(agent({ id: 'a', status: 'idle', connected: false }))).toBe(false)
  })

  it('does not treat completed as idle', () => {
    expect(isEasterEggEligible(agent({ id: 'a', status: 'completed', freshness: 'fresh', connected: true }))).toBe(
      false,
    )
    expect(isEasterEggEligible(agent({ id: 'a', status: 'completed', freshness: 'fresh', connected: true }), true)).toBe(
      false,
    )
  })
})

describe('resolveOfficeSceneConfig', () => {
  it('uses the test defaults and clamps duration to 8s', () => {
    expect(resolveOfficeSceneConfig()).toEqual(OFFICE_SCENE_TEST_DEFAULTS)
    expect(OFFICE_SCENE_TEST_DEFAULTS.easterEggDurationMs).toBeLessThanOrEqual(MAX_EASTER_EGG_DURATION_MS)
    expect(resolveOfficeSceneConfig({ easterEggDurationMs: 20_000 }).easterEggDurationMs).toBe(8000)
    expect(resolveOfficeSceneConfig({ easterEggDurationMs: -10 }).easterEggDurationMs).toBe(0)
    expect(resolveOfficeSceneConfig({ easterEggIdleWaitMs: Number.NaN }).easterEggIdleWaitMs).toBe(
      OFFICE_SCENE_TEST_DEFAULTS.easterEggIdleWaitMs,
    )
  })
})

describe('stepAgentEgg', () => {
  const idle = agent({ id: 'sol', status: 'idle' })

  it('waits out the idle period, plays one egg, then respects the cap', () => {
    const trace = run(idle, [0, 999, 1000, 4999, 5000, 6000])
    expect(trace[0]?.activeEgg).toBeNull()
    expect(trace[1]?.activeEgg).toBeNull()
    expect(trace[2]?.activeEgg).toBe('nap')
    expect(trace[3]?.activeEgg).toBe('nap')
    expect(trace[4]?.activeEgg).toBeNull()
    expect(trace[5]?.activeEgg).toBe('water')
  })

  it('stops the egg on the same step that eligibility ends', () => {
    const started = run(idle, [0, 1000]).at(-1) ?? createAgentEggState()
    expect(started.activeEgg).not.toBeNull()

    const cases = [
      agent({ id: 'sol', status: 'completed' }),
      agent({ id: 'sol', status: 'working' }),
      agent({ id: 'sol', status: 'unknown' }),
      agent({ id: 'sol', status: 'offline' }),
      agent({ id: 'sol', status: 'failed' }),
      agent({ id: 'sol', status: 'waiting' }),
      agent({ id: 'sol', status: 'idle', freshness: 'stale' }),
      agent({ id: 'sol', status: 'idle', connected: false }),
    ]
    for (const person of cases) {
      expect(stepAgentEgg(person, started, 1500, config, false).activeEgg).toBeNull()
    }
  })

  it('never starts for completed, unknown-but-connected, stale, or offline', () => {
    const people = [
      agent({ id: 'sol', status: 'completed' }),
      agent({ id: 'sol', status: 'unknown', connected: true }),
      agent({ id: 'sol', status: 'idle', freshness: 'stale' }),
      agent({ id: 'sol', status: 'offline', connected: true }),
      agent({ id: 'sol', status: 'idle', connected: false }),
    ]
    for (const person of people) {
      const last = run(person, [0, 1000, 10_000, 100_000]).at(-1)
      expect(last?.activeEgg).toBeNull()
    }
  })

  it('clears a playing egg and refuses to start when reduced motion is on', () => {
    const started = run(idle, [0, 1000]).at(-1) ?? createAgentEggState()
    expect(stepAgentEgg(idle, started, 1200, config, true).activeEgg).toBeNull()
    const last = run(idle, [0, 1000, 10_000], { reduced: true }).at(-1)
    expect(last?.activeEgg).toBeNull()
  })

  it('cycles coffee, nap, and water for one agent', () => {
    const seen = new Set<string>()
    for (let occurrence = 0; occurrence < 6; occurrence += 1) seen.add(pickEgg('nia', occurrence))
    expect(seen).toEqual(new Set(['coffee', 'nap', 'water']))
    expect(pickEgg('nia', 0)).toBe('coffee')
    expect(pickEgg('sol', 0)).toBe('nap')
    expect(pickEgg('bea', 0)).toBe('water')
  })
})
