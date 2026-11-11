export interface LookManifest {
  character: {
    idPrefixes: { prefix: string; look: string }[]
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

/** Known looks come from an agentId prefix map. Anything else is a stable hash. */
export function resolveLook(agentId: string, _name: string, manifest: LookManifest): string {
  const assigned = manifest.character.idPrefixes.find((item) => agentId.startsWith(item.prefix))
  if (assigned) return assigned.look
  const looks = manifest.character.hashLooks
  return looks[hashId(agentId) % looks.length] ?? looks[0] ?? "coordinator"
}
