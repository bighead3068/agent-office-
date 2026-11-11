export interface LookManifest {
  character: {
    assignments: { id: string; look: string }[]
    rules: { includes: string[]; look: string }[]
    hashLooks: string[]
  }
}

/** Stable FNV-1a. The same agent id keeps the same look after a seat change. */
export function hashId(id: string): number {
  let hash = 2166136261
  for (const char of id) {
    hash ^= char.codePointAt(0) ?? 0
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

export function resolveLook(agentId: string, name: string, manifest: LookManifest): string {
  const assigned = manifest.character.assignments.find((item) => item.id === agentId)
  if (assigned) return assigned.look
  const haystack = `${agentId} ${name}`
  for (const rule of manifest.character.rules) {
    if (rule.includes.some((part) => haystack.includes(part))) return rule.look
  }
  const looks = manifest.character.hashLooks
  return looks[hashId(agentId) % looks.length] ?? looks[0] ?? "coordinator"
}
