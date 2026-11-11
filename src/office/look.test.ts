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

  it("uses the four fixed looks for the named bots", () => {
    expect(resolveLook("lin", "林知夏", manifest)).toBe("coordinator")
    expect(resolveLook("chen", "陳墨白", manifest)).toBe("developer")
    expect(resolveLook("gao", "高小滿", manifest)).toBe("designer")
    expect(resolveLook("fang", "方寧遠", manifest)).toBe("tester")
    expect(resolveLook("other", "協調助手", manifest)).toBe("coordinator")
    expect(resolveLook("other", "開發助手", manifest)).toBe("developer")
  })
})
