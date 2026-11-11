import { describe, expect, it } from "vitest"
import manifest from "../../public/art/office-atlas.json"
import { resolveLook } from "./look"

describe("character looks", () => {
  it("keeps a look when only the seat changes", () => {
    const first = resolveLook("bot-orbit", "軌道", manifest)
    const second = resolveLook("bot-orbit", "軌道", manifest)
    expect(first).toBe(second)
    expect(manifest.character.hashLooks).toContain(first)
  })

  it("maps the four known bots by agentId prefix, not by display name", () => {
    expect(resolveLook("5be5c071-any", "隨便", manifest)).toBe("coordinator")
    expect(resolveLook("7a961a88-any", "隨便", manifest)).toBe("developer")
    expect(resolveLook("892250dc-any", "隨便", manifest)).toBe("designer")
    expect(resolveLook("cf8d7f4a-any", "隨便", manifest)).toBe("tester")
    const named = resolveLook("other-bot", "協調助手", manifest)
    expect(named).not.toBe("coordinator")
    expect(manifest.character.hashLooks).toContain(named)
  })
})
