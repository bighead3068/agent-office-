/** Walk grid for style B. 0 is open, 1 is blocked. Rows are y tiles. */
const DESK = [1, 1, 0, 1, 1, 0, 1, 1, 0, 1, 1, 0, 1, 1, 1]
export const WALKABLE: readonly (readonly number[])[] = [
  [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  DESK,
  DESK,
  DESK,
  [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  DESK,
  DESK,
  DESK,
  [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1],
]

export const AISLE_X = [16, 112, 208, 304, 400]
export const MEET = [[400, 208], [432, 208], [464, 208], [432, 176]] as const

export type Scheme = 1 | 2 | 3

export interface Talk {
  id: string
  hostId: string
  withId: string
  topic?: string
  mode?: string
  startedAt: number
  maxMs: number
  members: string[]
}

export function chooseScheme(talk: Talk, now: number, walkers: number, targetSeated: boolean, spotsFree: boolean): Scheme {
  if (!targetSeated || walkers > 4 || !spotsFree) return 3
  if (talk.mode === "meeting" || talk.members.length >= 3) return 2
  if (talk.members.length < 2 && now - talk.startedAt > 30_000) return 3
  return 1
}

/** Fixed L + L path in native pixels. No search. */
export function discussionPath(from: readonly [number, number], to: readonly [number, number]): [number, number][] {
  const nearer = (origin: number, goal: number) => AISLE_X.reduce((best, x) => {
    const distance = Math.abs(x - origin)
    const bestDistance = Math.abs(best - origin)
    if (distance < bestDistance) return x
    if (distance === bestDistance && Math.sign(goal - origin) === Math.sign(x - best)) return x
    return best
  }, AISLE_X[0])
  const startAisle = nearer(from[0], to[0])
  const endAisle = nearer(to[0], from[0])
  const points: [number, number][] = [[from[0], from[1]], [startAisle, from[1]], [startAisle, 208], [endAisle, 208], [endAisle, to[1]], [to[0], to[1]]]
  return points.filter((point, index) => index === 0 || point[0] !== points[index - 1][0] || point[1] !== points[index - 1][1])
}

export function pointAlong(path: readonly (readonly [number, number])[], progress: number): [number, number] {
  const safe = Math.min(1, Math.max(0, progress))
  let length = 0
  const legs: { from: readonly [number, number]; to: readonly [number, number]; length: number }[] = []
  for (let index = 1; index < path.length; index += 1) {
    const from = path[index - 1]
    const to = path[index]
    const leg = Math.hypot(to[0] - from[0], to[1] - from[1])
    legs.push({ from, to, length: leg })
    length += leg
  }
  let remain = length * safe
  for (const leg of legs) {
    if (remain <= leg.length || leg === legs[legs.length - 1]) {
      const ratio = leg.length === 0 ? 1 : remain / leg.length
      return [Math.round(leg.from[0] + (leg.to[0] - leg.from[0]) * ratio), Math.round(leg.from[1] + (leg.to[1] - leg.from[1]) * ratio)]
    }
    remain -= leg.length
  }
  const last = path[path.length - 1]
  return [last[0], last[1]]
}
