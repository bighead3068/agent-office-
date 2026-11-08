import type { PoseCue } from './presentation'

export interface Look {
  skin: string
  skinShade: string
  hair: string
  hairShade: string
  shirt: string
  shirtShade: string
  hat: string
  style: 'bob' | 'curls' | 'bun' | 'glasses' | 'beanie'
}

/** Five seat designs. Shirt and hair read differently even in greyscale. */
export const LOOKS: Look[] = [
  {
    style: 'bob',
    skin: '#f0c29a',
    skinShade: '#d9a27a',
    hair: '#2b221c',
    hairShade: '#140e0c',
    shirt: '#1f8f86',
    shirtShade: '#14665f',
    hat: '#2b221c',
  },
  {
    style: 'curls',
    skin: '#e0aa78',
    skinShade: '#c48b58',
    hair: '#a34924',
    hairShade: '#7a3016',
    shirt: '#e2a31a',
    shirtShade: '#b67c0d',
    hat: '#a34924',
  },
  {
    style: 'bun',
    skin: '#8d5524',
    skinShade: '#6e3e18',
    hair: '#1a1420',
    hairShade: '#0c0a10',
    shirt: '#3c4e9a',
    shirtShade: '#2a366e',
    hat: '#1a1420',
  },
  {
    style: 'glasses',
    skin: '#f6d2b4',
    skinShade: '#e2b48f',
    hair: '#e6c56a',
    hairShade: '#c4a24a',
    shirt: '#e36b5a',
    shirtShade: '#b84d40',
    hat: '#e6c56a',
  },
  {
    style: 'beanie',
    skin: '#c68642',
    skinShade: '#a56a30',
    hair: '#5c4033',
    hairShade: '#3d291f',
    shirt: '#8d4f86',
    shirtShade: '#693864',
    hat: '#7dcec4',
  },
]

export function greyLook(look: Look): Look {
  return {
    ...look,
    skin: '#cfcfcf',
    skinShade: '#b5b5b5',
    hair: '#8a8a8a',
    hairShade: '#6e6e6e',
    shirt: '#a3a3a3',
    shirtShade: '#8b8b8b',
    hat: '#9a9a9a',
  }
}

const INK = '#241c16'
const EYE = '#fffaf3'
const BLUSH = '#e7a090'
const CUP = '#f7f4ef'
const COFFEE = '#6b3a22'
const CAN = '#d5e4ef'
const CAN_SHADE = '#8eafc4'
const WATER = '#7ec8e0'

type Paint = (look: Look) => string | null

const PAINT: Record<string, Paint> = {
  h: (look) => look.hair,
  H: (look) => look.hairShade,
  s: (look) => look.skin,
  S: (look) => look.skinShade,
  c: (look) => look.shirt,
  C: (look) => look.shirtShade,
  n: (look) => look.hat,
  e: () => EYE,
  b: () => INK,
  m: () => '#a15a55',
  k: () => INK,
  p: () => BLUSH,
  g: () => INK,
  u: () => '#f2c14e',
  w: () => CUP,
  o: () => COFFEE,
  a: () => CAN,
  A: () => CAN_SHADE,
  q: () => WATER,
}

function sprite(rows: string[]): string[] {
  for (const row of rows) {
    if (row.length !== 14) {
      throw new Error(`Sprite row must be 14 wide, got ${row.length}: [${row}]`)
    }
  }
  return rows
}

/** Shared seated body. Poses layer gestures on top of this. Exported for width tests. */
export const SIT_SPRITE = sprite([
  '..hhhhhhhh....',
  '.hhhhhhhhhh...',
  '.hhsssssshh...',
  '.hssseessssh..',
  '.hsssbbebssh..',
  '.hsssssssssh..',
  '.hsssmmssssh..',
  '..sspsssspss..',
  '..cccccccccc..',
  '.cccccccccccc.',
  '.cccCSSSSCccc.',
  '.cccs....sccc.',
  '..cc......cc..',
])

const CLOSED_EYES = sprite([
  '..hhhhhhhh....',
  '.hhhhhhhhhh...',
  '.hhsssssshh...',
  '.hsssssssssh..',
  '.hssskkkkkssh.',
  '.hsssssssssh..',
  '.hssssmmsssh..',
  '..sspsssspss..',
  '..cccccccccc..',
  '.cccccccccccc.',
  '.cccCSSSSCccc.',
  '.cccs....sccc.',
  '..cc......cc..',
])

function drawGrid(
  ctx: CanvasRenderingContext2D,
  grid: string[],
  ox: number,
  oy: number,
  look: Look,
  pixel: number,
  outline: boolean,
) {
  const colored: Array<{ x: number; y: number; color: string }> = []
  for (let y = 0; y < grid.length; y += 1) {
    const row = grid[y] ?? ''
    for (let x = 0; x < row.length; x += 1) {
      const ch = row[x] ?? '.'
      const color = PAINT[ch]?.(look) ?? null
      if (color) colored.push({ x, y, color })
    }
  }
  if (outline && colored.length > 0) {
    const filled = new Set(colored.map((cell) => `${cell.x},${cell.y}`))
    ctx.fillStyle = INK
    for (const cell of colored) {
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const) {
        if (!filled.has(`${cell.x + dx},${cell.y + dy}`)) {
          ctx.fillRect(ox + (cell.x + dx) * pixel, oy + (cell.y + dy) * pixel, pixel, pixel)
        }
      }
    }
  }
  for (const cell of colored) {
    ctx.fillStyle = cell.color
    ctx.fillRect(ox + cell.x * pixel, oy + cell.y * pixel, pixel, pixel)
  }
}

function cell(
  ctx: CanvasRenderingContext2D,
  ox: number,
  oy: number,
  x: number,
  y: number,
  color: string,
  pixel: number,
) {
  ctx.fillStyle = color
  ctx.fillRect(ox + x * pixel, oy + y * pixel, pixel, pixel)
}

function drawHairStyle(ctx: CanvasRenderingContext2D, ox: number, oy: number, look: Look, pixel: number) {
  const hair = look.hair
  const shade = look.hairShade
  if (look.style === 'bob') {
    for (let y = 3; y <= 7; y += 1) {
      cell(ctx, ox, oy, 1, y, shade, pixel)
      cell(ctx, ox, oy, 12, y, shade, pixel)
    }
    cell(ctx, ox, oy, 2, 7, hair, pixel)
    cell(ctx, ox, oy, 11, 7, hair, pixel)
  } else if (look.style === 'curls') {
    cell(ctx, ox, oy, 0, 2, hair, pixel)
    cell(ctx, ox, oy, 0, 3, shade, pixel)
    cell(ctx, ox, oy, 1, 1, hair, pixel)
    cell(ctx, ox, oy, 12, 1, hair, pixel)
    cell(ctx, ox, oy, 13, 2, hair, pixel)
    cell(ctx, ox, oy, 13, 3, shade, pixel)
    cell(ctx, ox, oy, 0, 4, hair, pixel)
    cell(ctx, ox, oy, 13, 4, hair, pixel)
  } else if (look.style === 'bun') {
    cell(ctx, ox, oy, 5, -1, shade, pixel)
    cell(ctx, ox, oy, 6, -2, hair, pixel)
    cell(ctx, ox, oy, 7, -2, hair, pixel)
    cell(ctx, ox, oy, 8, -1, shade, pixel)
    cell(ctx, ox, oy, 6, -1, hair, pixel)
    cell(ctx, ox, oy, 7, -1, hair, pixel)
    cell(ctx, ox, oy, 8, 0, '#f2c14e', pixel)
  } else if (look.style === 'glasses') {
    cell(ctx, ox, oy, 4, 4, INK, pixel)
    cell(ctx, ox, oy, 5, 4, INK, pixel)
    cell(ctx, ox, oy, 7, 4, INK, pixel)
    cell(ctx, ox, oy, 8, 4, INK, pixel)
    cell(ctx, ox, oy, 6, 4, INK, pixel)
    cell(ctx, ox, oy, 3, 4, INK, pixel)
    cell(ctx, ox, oy, 9, 4, INK, pixel)
  } else if (look.style === 'beanie') {
    for (let x = 2; x <= 11; x += 1) {
      cell(ctx, ox, oy, x, 0, look.hat, pixel)
      cell(ctx, ox, oy, x, 1, x % 2 === 0 ? look.hat : '#f2f7f4', pixel)
    }
    cell(ctx, ox, oy, 6, -1, look.hat, pixel)
    cell(ctx, ox, oy, 7, -1, '#f2f7f4', pixel)
    cell(ctx, ox, oy, 2, 2, hair, pixel)
    cell(ctx, ox, oy, 11, 2, hair, pixel)
  }
}

function drawRaisedArm(
  ctx: CanvasRenderingContext2D,
  ox: number,
  oy: number,
  look: Look,
  level: 'mid' | 'high',
  pixel: number,
) {
  const top = level === 'high' ? 0 : 5
  ctx.fillStyle = look.skinShade
  ctx.fillRect(ox, oy + (top + 2) * pixel, pixel, (11 - top) * pixel)
  ctx.fillStyle = look.skin
  ctx.fillRect(ox + pixel, oy + (top + 2) * pixel, pixel, (11 - top) * pixel)
  ctx.fillStyle = look.skin
  ctx.fillRect(ox - pixel, oy + top * pixel, pixel * 4, pixel * 3)
  ctx.fillStyle = look.skinShade
  ctx.fillRect(ox - pixel, oy + (top + 2) * pixel, pixel * 4, pixel)
}

function drawTypingHands(
  ctx: CanvasRenderingContext2D,
  ox: number,
  oy: number,
  look: Look,
  frame: 0 | 1,
  pixel: number,
) {
  const y = 16 + frame
  for (let x = 3; x <= 10; x += 1) cell(ctx, ox, oy, x, 15, look.shirt, pixel)
  cell(ctx, ox, oy, 3, y, look.skinShade, pixel)
  cell(ctx, ox, oy, 4, y, look.skin, pixel)
  cell(ctx, ox, oy, 6, y, frame ? look.skinShade : look.skin, pixel)
  cell(ctx, ox, oy, 7, y, frame ? look.skin : look.skinShade, pixel)
  cell(ctx, ox, oy, 9, y, look.skin, pixel)
  cell(ctx, ox, oy, 10, y, look.skinShade, pixel)
}

function drawCoffee(
  ctx: CanvasRenderingContext2D,
  ox: number,
  oy: number,
  look: Look,
  frame: 0 | 1,
  pixel: number,
) {
  ctx.fillStyle = look.skinShade
  ctx.fillRect(ox + 11 * pixel, oy + 4 * pixel, pixel, 8 * pixel)
  ctx.fillStyle = look.skin
  ctx.fillRect(ox + 10 * pixel, oy + 4 * pixel, pixel, 8 * pixel)
  const cupX = ox + 6 * pixel
  const cupY = oy + 3 * pixel
  ctx.fillStyle = INK
  ctx.fillRect(cupX - pixel, cupY - pixel, 8 * pixel, 7 * pixel)
  ctx.fillStyle = CUP
  ctx.fillRect(cupX, cupY, 6 * pixel, 5 * pixel)
  ctx.fillStyle = COFFEE
  ctx.fillRect(cupX + pixel, cupY + pixel, 4 * pixel, 2 * pixel)
  ctx.fillStyle = CUP
  ctx.fillRect(cupX + 6 * pixel, cupY + pixel, 2 * pixel, 3 * pixel)
  ctx.fillStyle = '#fffaf3'
  const lift = frame === 1 ? pixel : 0
  ctx.fillRect(cupX + pixel, cupY - 3 * pixel - lift, pixel, 2 * pixel)
  ctx.fillRect(cupX + 3 * pixel, cupY - 4 * pixel - lift, pixel, 2 * pixel)
}

function drawWater(
  ctx: CanvasRenderingContext2D,
  ox: number,
  oy: number,
  look: Look,
  frame: 0 | 1,
  pixel: number,
) {
  ctx.fillStyle = look.skin
  ctx.fillRect(ox + 11 * pixel, oy + 8 * pixel, 4 * pixel, pixel * 2)
  const canX = ox + 14 * pixel
  const canY = oy + 6 * pixel
  ctx.fillStyle = INK
  ctx.fillRect(canX - pixel, canY - pixel, 8 * pixel, 7 * pixel)
  ctx.fillStyle = CAN
  ctx.fillRect(canX, canY, 6 * pixel, 5 * pixel)
  ctx.fillStyle = CAN_SHADE
  ctx.fillRect(canX + pixel, canY + pixel, 4 * pixel, 3 * pixel)
  ctx.fillStyle = CAN
  ctx.fillRect(canX + 5 * pixel, canY - 2 * pixel, 5 * pixel, 2 * pixel)
  ctx.fillStyle = WATER
  const drop = frame === 1 ? 2 * pixel : 0
  ctx.fillRect(canX + 9 * pixel, canY + drop, pixel, 2 * pixel)
  ctx.fillRect(canX + 11 * pixel, canY + 2 * pixel + drop, pixel, 2 * pixel)
  ctx.fillRect(canX + 8 * pixel, canY + 4 * pixel + drop, pixel, 2 * pixel)
}

function drawZzz(ctx: CanvasRenderingContext2D, ox: number, oy: number, frame: 0 | 1, pixel: number) {
  const lift = frame === 1 ? -pixel : 0
  ctx.fillStyle = '#7c5a32'
  const z = (zx: number, zy: number, size: number) => {
    ctx.fillRect(zx, zy + lift, size * 3, pixel)
    ctx.fillRect(zx + size * 2, zy + pixel + lift, pixel, pixel)
    ctx.fillRect(zx + size, zy + pixel * 2 + lift, pixel, pixel)
    ctx.fillRect(zx, zy + pixel * 3 + lift, size * 3, pixel)
  }
  z(ox, oy, pixel)
  z(ox + pixel * 5, oy - pixel * 4, Math.max(1, pixel - 0))
}

function drawNapArms(ctx: CanvasRenderingContext2D, ox: number, oy: number, look: Look, pixel: number) {
  for (let x = 2; x <= 11; x += 1) {
    cell(ctx, ox, oy, x, 10, look.shirt, pixel)
    cell(ctx, ox, oy, x, 11, x % 2 === 0 ? look.skin : look.skinShade, pixel)
  }
}

/**
 * Draw one original pixel person. `pixel` is the size of one art cell.
 * `back` is the body behind the desk. `front` is the gesture that sits on
 * the desk (hands, cup, watering can, nap). The character never leaves the seat.
 */
export function drawCharacter(
  ctx: CanvasRenderingContext2D,
  ox: number,
  oy: number,
  look: Look,
  pose: PoseCue,
  frame: 0 | 1,
  pixel = 2,
  layer: 'back' | 'front' = 'back',
) {
  const breathe = pose === 'breathe' && frame === 1 ? -pixel : 0
  const slump = pose === 'slump' ? pixel * 2 : 0
  const napShift = pose === 'nap' ? pixel * 6 : 0
  const headY = oy + breathe + slump + napShift
  const grid = pose === 'slump' || pose === 'nap' ? CLOSED_EYES : SIT_SPRITE

  if (layer === 'back' && pose !== 'nap') {
    drawGrid(ctx, grid, ox, headY, look, pixel, true)
    drawHairStyle(ctx, ox, headY, look, pixel)
    return
  }

  if (layer === 'front' && pose === 'nap') {
    drawGrid(ctx, grid, ox, headY, look, pixel, true)
    drawHairStyle(ctx, ox, headY, look, pixel)
    drawNapArms(ctx, ox, oy, look, pixel)
    drawZzz(ctx, ox + pixel * 12, headY - pixel * 3, frame, pixel)
    return
  }

  if (layer !== 'front') return
  if (pose === 'typing') drawTypingHands(ctx, ox, oy + breathe, look, frame, pixel)
  if (pose === 'hand-up') drawRaisedArm(ctx, ox, oy, look, 'high', pixel)
  if (pose === 'hand-raising') drawRaisedArm(ctx, ox, oy, look, 'mid', pixel)
  if (pose === 'coffee') drawCoffee(ctx, ox, headY, look, frame, pixel)
  if (pose === 'water') drawWater(ctx, ox, oy + breathe, look, frame, pixel)
}

export const CHARACTER_PIXEL = 3
export const CHARACTER_CELLS_WIDE = 14
