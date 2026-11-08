import type { SeatId } from './types'

/** Logical scene size: 20 × 12 tiles at 32px. */
export const TILE_SIZE = 32
export const TILE_COLUMNS = 20
export const TILE_ROWS = 12
export const LOGICAL_WIDTH = TILE_COLUMNS * TILE_SIZE
export const LOGICAL_HEIGHT = TILE_ROWS * TILE_SIZE

export interface Box {
  x: number
  y: number
  w: number
  h: number
}

export const LAYOUT = {
  manager: { x: 8, y: 8, w: 208, h: 104 },
  legend: { x: 424, y: 8, w: 208, h: 104 },
  seats: {
    S1: { x: 8, y: 124, w: 136, h: 128 },
    S2: { x: 148, y: 124, w: 136, h: 128 },
    S3: { x: 288, y: 124, w: 136, h: 128 },
    S4: { x: 8, y: 254, w: 136, h: 128 },
    S5: { x: 148, y: 254, w: 136, h: 128 },
  } satisfies Record<SeatId, Box>,
}

/**
 * Fit the 640×384 floor to the container width.
 * The canvas buffer is still painted on whole art pixels and displayed with
 * `image-rendering: pixelated`, so a 2× container is a crisp integer scale
 * and any other width stays chunky instead of blurring.
 */
export function computeScale(containerWidth: number): number {
  if (!Number.isFinite(containerWidth) || containerWidth <= 0) return 1
  return containerWidth / LOGICAL_WIDTH
}
