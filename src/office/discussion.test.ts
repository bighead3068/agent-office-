import { describe, expect, it } from "vitest"
import { chooseScheme, discussionPath, type Talk } from "./discussion"

const talk: Talk = {
  id: "talk",
  hostId: "a",
  withId: "b",
  startedAt: 0,
  maxMs: 60_000,
  members: ["a", "b"],
}

describe("discussion routing", () => {
  it("uses an L path and falls back when the target is unseated or the group is a meeting", () => {
    expect(discussionPath([64, 128], [256, 288])).toEqual([[64, 128], [112, 128], [112, 208], [208, 208], [208, 288], [256, 288]])
    expect(chooseScheme(talk, 1_000, 1, true, true)).toBe(1)
    expect(chooseScheme({ ...talk, mode: "meeting" }, 1_000, 1, true, true)).toBe(2)
    expect(chooseScheme({ ...talk, members: ["a", "b", "c"] }, 1_000, 1, true, true)).toBe(2)
    expect(chooseScheme(talk, 1_000, 1, false, true)).toBe(3)
    expect(chooseScheme(talk, 1_000, 5, true, true)).toBe(3)
  })
})
