import type { OfficeAgent } from '../types'

export function makeAgent(overrides: Partial<OfficeAgent> & Pick<OfficeAgent, 'id'>): OfficeAgent {
  return {
    name: overrides.name ?? overrides.id,
    role: overrides.role ?? 'Agent',
    status: overrides.status ?? 'idle',
    freshness: overrides.freshness ?? 'fresh',
    connected: overrides.connected ?? true,
    lastUpdatedAt: overrides.lastUpdatedAt ?? 'yesterday morning',
    ...overrides,
  }
}
