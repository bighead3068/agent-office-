import { CHARACTER_PIXEL, LOOKS, drawCharacter, greyLook } from './character'
import { iconRows } from './icons'
import { LAYOUT, LOGICAL_HEIGHT, LOGICAL_WIDTH, type Box } from './layout'
import type { BubbleCue, SeatPresentation } from './presentation'
import type { SeatId } from './types'

export interface DrawSeatModel {
  seatId: SeatId
  box: Box
  occupied: boolean
  lookIndex: number
  presentation: SeatPresentation | null
  frame: 0 | 1
  selected: boolean
}

export interface DrawModel {
  seats: DrawSeatModel[]
  reducedMotion: boolean
  /** 0 or 1, already frozen when a seat should not loop. Ambient bits use this. */
  tick: 0 | 1
}

const INK = '#2b211c'
const PIXEL = CHARACTER_PIXEL

function rect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: string) {
  ctx.fillStyle = color
  ctx.fillRect(x, y, w, h)
}

function drawIcon(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  rows: string[],
  pixel: number,
  color: string,
) {
  ctx.fillStyle = color
  for (let row = 0; row < rows.length; row += 1) {
    const line = rows[row] ?? ''
    for (let col = 0; col < line.length; col += 1) {
      if (line[col] === '1') ctx.fillRect(x + col * pixel, y + row * pixel, pixel, pixel)
    }
  }
}

function drawRoom(ctx: CanvasRenderingContext2D, tick: 0 | 1, reducedMotion: boolean) {
  rect(ctx, 0, 0, LOGICAL_WIDTH, LOGICAL_HEIGHT, '#f6e4c8')

  for (let row = 0; row < 4; row += 1) {
    for (let col = 0; col < 20; col += 1) {
      const shade = (col + row) % 2 === 0 ? '#f7e7cc' : '#f3ddbc'
      rect(ctx, col * 32, row * 32, 32, 32, shade)
    }
  }
  rect(ctx, 0, 0, LOGICAL_WIDTH, 8, '#6b3a24')
  rect(ctx, 0, 8, LOGICAL_WIDTH, 4, '#8d5134')
  rect(ctx, 0, 116, LOGICAL_WIDTH, 8, '#e7c79a')
  rect(ctx, 0, 124, LOGICAL_WIDTH, 4, '#6b3a24')

  for (let row = 4; row < 12; row += 1) {
    for (let col = 0; col < 20; col += 1) {
      const vary = (col * 3 + row) % 4
      const color = ['#e4b87e', '#d9aa6c', '#e8c08a', '#d0a062'][vary] ?? '#e4b87e'
      rect(ctx, col * 32, row * 32, 32, 32, color)
      rect(ctx, col * 32, row * 32, 32, 1, 'rgba(120, 72, 32, 0.28)')
      rect(ctx, col * 32, row * 32, 1, 32, 'rgba(120, 72, 32, 0.18)')
    }
  }

  drawRug(ctx, 4, 156, 416, 222)
  drawWindows(ctx)
  drawSconce(ctx, 392, 28)
  drawBookshelf(ctx, 432, 120)
  drawPantry(ctx, tick, reducedMotion)
  drawNook(ctx, tick, reducedMotion)
}

function drawRug(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  rect(ctx, x, y, w, h, '#b94a3c')
  rect(ctx, x + 4, y + 4, w - 8, h - 8, '#f3d7a4')
  rect(ctx, x + 8, y + 8, w - 16, h - 16, '#c85a48')
  ctx.fillStyle = '#f3d7a4'
  for (let iy = y + 20; iy < y + h - 14; iy += 24) {
    for (let ix = x + 20; ix < x + w - 14; ix += 24) {
      rect(ctx, ix, iy, 2, 2, '#f3d7a4')
      rect(ctx, ix + 4, iy + 2, 2, 2, '#f3d7a4')
      rect(ctx, ix - 2, iy + 2, 2, 2, '#f3d7a4')
      rect(ctx, ix + 2, iy - 2, 2, 2, '#f3d7a4')
      rect(ctx, ix + 2, iy + 4, 2, 2, '#f3d7a4')
    }
  }
}

function drawWindow(ctx: CanvasRenderingContext2D, x: number, y: number) {
  rect(ctx, x, y, 56, 52, '#5c3a24')
  rect(ctx, x + 4, y + 4, 48, 32, '#8ecae6')
  rect(ctx, x + 6, y + 6, 14, 8, '#e8f7ff')
  rect(ctx, x + 28, y + 18, 16, 6, '#f7fbff')
  rect(ctx, x + 36, y + 8, 8, 8, '#f6d56b')
  rect(ctx, x + 26, y + 4, 3, 32, '#5c3a24')
  rect(ctx, x + 4, y + 18, 48, 3, '#5c3a24')
  rect(ctx, x - 2, y + 46, 60, 5, '#8d5134')
  rect(ctx, x + 4, y + 40, 10, 8, '#2f7d45')
  rect(ctx, x + 8, y + 44, 8, 6, '#c45c3e')
}

function drawWindows(ctx: CanvasRenderingContext2D) {
  drawWindow(ctx, 228, 18)
  drawWindow(ctx, 300, 18)
  rect(ctx, 224, 70, 8, 28, '#d96b5d')
  rect(ctx, 352, 70, 8, 28, '#d96b5d')
}

function drawSconce(ctx: CanvasRenderingContext2D, x: number, y: number) {
  rect(ctx, x, y + 10, 10, 4, '#6b3a24')
  rect(ctx, x + 2, y, 6, 12, '#f2c14e')
  rect(ctx, x - 2, y + 4, 14, 6, 'rgba(255, 214, 120, 0.55)')
}

function drawBookshelf(ctx: CanvasRenderingContext2D, x: number, y: number) {
  rect(ctx, x, y, 192, 72, '#6b3a24')
  rect(ctx, x + 4, y + 4, 184, 28, '#f3e2c4')
  rect(ctx, x + 4, y + 36, 184, 28, '#f3e2c4')
  const spines = ['#c45c48', '#3d6ea8', '#e2a31a', '#1f8f86', '#8d4f86', '#f4f1ea', '#2f7d45']
  spines.forEach((color, index) => {
    rect(ctx, x + 8 + index * 14, y + 8, 10, 20, color)
    rect(ctx, x + 8 + index * 14, y + 42, 10, 18, spines[(index + 3) % spines.length] ?? color)
  })
  rect(ctx, x + 150, y + 10, 28, 16, '#f7f4ef')
  rect(ctx, x + 154, y + 14, 20, 2, '#6b3a24')
  rect(ctx, x + 154, y + 18, 14, 2, '#6b3a24')
}

function drawPantry(ctx: CanvasRenderingContext2D, tick: 0 | 1, reducedMotion: boolean) {
  rect(ctx, 424, 196, 208, 180, '#f0d2b4')
  for (let y = 200; y < 268; y += 12) {
    for (let x = 428; x < 624; x += 12) {
      rect(ctx, x, y, 10, 10, (x + y) % 24 === 0 ? '#f7e0cc' : '#e7c2a4')
    }
  }
  rect(ctx, 428, 268, 196, 8, '#8d5134')
  rect(ctx, 428, 276, 196, 28, '#a56b3c')
  rect(ctx, 428, 304, 196, 8, '#6b3a24')
  rect(ctx, 436, 312, 6, 52, '#5c3a24')
  rect(ctx, 610, 312, 6, 52, '#5c3a24')

  rect(ctx, 448, 228, 36, 40, '#4a3428')
  rect(ctx, 452, 232, 28, 10, '#6b4a38')
  rect(ctx, 456, 248, 12, 8, '#d7d2cc')
  rect(ctx, 470, 246, 10, 12, '#f7f4ef')
  rect(ctx, 472, 250, 6, 4, '#6b3a22')
  const steam = reducedMotion ? 0 : tick === 1 ? 2 : 0
  rect(ctx, 472, 238 - steam, 2, 4, '#fffaf3')
  rect(ctx, 476, 234 - steam, 2, 4, '#fffaf3')

  rect(ctx, 500, 250, 16, 14, '#f7f4ef')
  rect(ctx, 502, 254, 12, 4, '#6b3a22')
  rect(ctx, 516, 246, 4, 8, '#f7f4ef')
  rect(ctx, 534, 252, 18, 10, '#e2a31a')
  rect(ctx, 536, 248, 8, 6, '#f2c14e')
  rect(ctx, 560, 236, 14, 18, '#c45c48')
  rect(ctx, 576, 240, 14, 14, '#3d6ea8')
  rect(ctx, 592, 244, 12, 18, '#1f8f86')

  rect(ctx, 448, 214, 10, 4, '#6b3a24')
  rect(ctx, 446, 218, 8, 6, '#f7f4ef')
  rect(ctx, 470, 214, 10, 4, '#6b3a24')
  rect(ctx, 468, 218, 8, 6, '#e36b5a')
}

function drawNook(ctx: CanvasRenderingContext2D, tick: 0 | 1, reducedMotion: boolean) {
  drawPlant(ctx, 360, 300, 1)
  rect(ctx, 392, 332, 28, 16, '#e7d3b0')
  rect(ctx, 396, 328, 8, 6, '#e7d3b0')
  rect(ctx, 408, 328, 8, 6, '#d9c09a')
  rect(ctx, 400, 334, 2, 2, INK)
  rect(ctx, 410, 334, 2, 2, INK)
  rect(ctx, 404, 338, 4, 2, '#c48b7a')
  const tail = reducedMotion ? 0 : tick
  rect(ctx, 418, 336 - tail, 8, 3, '#e7d3b0')
  rect(ctx, 300, 348, 18, 22, '#6b3a24')
  rect(ctx, 304, 336, 10, 14, '#f7f4ef')
  rect(ctx, 306, 330, 6, 8, '#e7e2da')
}

function drawPlant(ctx: CanvasRenderingContext2D, x: number, y: number, scale = 1) {
  const s = scale
  rect(ctx, x + 4 * s, y + 12 * s, 10 * s, 8 * s, '#c45c3e')
  rect(ctx, x + 6 * s, y + 10 * s, 6 * s, 4 * s, '#a84832')
  rect(ctx, x + 8 * s, y + 4 * s, 2 * s, 8 * s, '#2a6b3c')
  rect(ctx, x + 2 * s, y + 2 * s, 6 * s, 6 * s, '#2f8f4e')
  rect(ctx, x + 8 * s, y, 6 * s, 6 * s, '#3fa85a')
  rect(ctx, x + 12 * s, y + 4 * s, 5 * s, 5 * s, '#217a3d')
}

function drawDesk(ctx: CanvasRenderingContext2D, x: number, y: number, w: number) {
  rect(ctx, x + 6, y + 18, 6, 16, '#5c3a24')
  rect(ctx, x + w - 12, y + 18, 6, 16, '#5c3a24')
  rect(ctx, x, y + 8, w, 14, '#8d5a34')
  rect(ctx, x, y, w, 10, '#c48a52')
  rect(ctx, x, y, w, 2, '#e2b27a')
  rect(ctx, x + 4, y + 10, w - 8, 2, '#6b3a24')
}

function drawKeyboard(ctx: CanvasRenderingContext2D, x: number, y: number, active: boolean, frame: 0 | 1) {
  rect(ctx, x, y, 28, 8, '#3a342c')
  for (let col = 0; col < 6; col += 1) {
    const hot = active && ((col + frame) % 3 === 0)
    rect(ctx, x + 2 + col * 4, y + 2, 3, 2, hot ? '#f2c14e' : '#d9d3c8')
  }
}

function drawMonitor(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  presentation: SeatPresentation | null,
  frame: 0 | 1,
) {
  rect(ctx, x + 12, y + 28, 12, 4, '#3a342c')
  rect(ctx, x + 6, y + 32, 24, 3, '#3a342c')
  rect(ctx, x, y, 36, 30, '#2c2824')
  const screen = { x: x + 3, y: y + 3, w: 30, h: 20 }
  const monitor = presentation?.monitor ?? 'off'
  const colors: Record<SeatPresentation['monitor'], string> = {
    blue: '#2f78d0',
    yellow: '#f0c14a',
    amber: '#c46a1a',
    green: '#2f9a62',
    red: '#d24b4b',
    dim: '#2c333b',
    off: '#121316',
    grey: '#8d8d8d',
  }
  rect(ctx, screen.x, screen.y, screen.w, screen.h, colors[monitor])
  if (monitor === 'blue') {
    rect(ctx, screen.x + 3, screen.y + 3 + frame, 16, 2, '#f7fbff')
    rect(ctx, screen.x + 3, screen.y + 8, 22, 2, '#d5e6ff')
    rect(ctx, screen.x + 3, screen.y + 13 - frame, 12, 2, '#f7fbff')
  } else if (monitor === 'yellow') {
    drawIcon(ctx, screen.x + 6, screen.y + 6, iconRows('ellipsis'), 2, INK)
  } else if (monitor === 'amber') {
    drawIcon(ctx, screen.x + 6, screen.y + 4, iconRows('block'), 2, '#fff6ea')
  } else if (monitor === 'green') {
    drawIcon(ctx, screen.x + 8, screen.y + 4, iconRows('check'), 2, '#f4fff6')
  } else if (monitor === 'red') {
    drawIcon(ctx, screen.x + 8, screen.y + 3, iconRows('bang'), 2, '#fff6f4')
  } else if (monitor === 'dim') {
    rect(ctx, screen.x + 4, screen.y + 14, 22, 2, '#1b2026')
  } else if (monitor === 'grey') {
    drawIcon(ctx, screen.x + 8, screen.y + 4, iconRows('question'), 2, INK)
  }
  const ledOn = monitor !== 'off' && monitor !== 'dim'
  rect(ctx, x + 16, y + 24, 4, 2, ledOn ? '#b6f2c4' : '#3a342c')
}

function drawDocument(ctx: CanvasRenderingContext2D, x: number, y: number) {
  rect(ctx, x + 1, y + 1, 16, 18, INK)
  rect(ctx, x, y, 16, 18, '#fffaf3')
  rect(ctx, x + 3, y + 3, 10, 2, '#d9d0c4')
  rect(ctx, x + 3, y + 7, 8, 2, '#d9d0c4')
  drawIcon(ctx, x + 3, y + 10, iconRows('check'), 1, '#1f8f4e')
}

function drawPlug(ctx: CanvasRenderingContext2D, x: number, y: number) {
  rect(ctx, x, y, 18, 16, '#fffaf3')
  rect(ctx, x, y, 18, 16, 'transparent')
  drawIcon(ctx, x, y, iconRows('plug'), 2, INK)
}

function drawBubble(ctx: CanvasRenderingContext2D, x: number, y: number, bubble: Exclude<BubbleCue, null>) {
  rect(ctx, x + 1, y + 1, 22, 16, INK)
  rect(ctx, x, y, 22, 16, '#fffaf3')
  rect(ctx, x, y, 22, 2, INK)
  rect(ctx, x, y + 14, 22, 2, INK)
  rect(ctx, x, y, 2, 16, INK)
  rect(ctx, x + 20, y, 2, 16, INK)
  rect(ctx, x + 8, y + 16, 4, 4, INK)
  rect(ctx, x + 9, y + 16, 2, 3, '#fffaf3')
  const ink = bubble === 'check' ? '#1f8f4e' : bubble === 'bang' ? '#a32020' : INK
  drawIcon(ctx, x + 4, y + 4, iconRows(bubble), 2, ink)
}

function withFilter(
  ctx: CanvasRenderingContext2D,
  presentation: SeatPresentation | null,
  opacity: number,
  draw: () => void,
) {
  ctx.save()
  if (presentation?.dim) ctx.filter = 'grayscale(1) brightness(0.72)'
  else if (presentation?.desaturate) ctx.filter = 'saturate(0.12) brightness(0.94)'
  if (opacity < 1) ctx.globalAlpha = opacity
  draw()
  ctx.restore()
}

function drawSelection(ctx: CanvasRenderingContext2D, box: Box) {
  const { x, y, w, h } = box
  ctx.fillStyle = 'rgba(227, 155, 18, 0.16)'
  ctx.fillRect(x, y, w, h)
  ctx.fillStyle = '#e39b12'
  const t = 4
  const len = 14
  rect(ctx, x, y, len, t, '#e39b12')
  rect(ctx, x, y, t, len, '#e39b12')
  rect(ctx, x + w - len, y, len, t, '#e39b12')
  rect(ctx, x + w - t, y, t, len, '#e39b12')
  rect(ctx, x, y + h - t, len, t, '#e39b12')
  rect(ctx, x, y + h - len, t, len, '#e39b12')
  rect(ctx, x + w - len, y + h - t, len, t, '#e39b12')
  rect(ctx, x + w - t, y + h - len, t, len, '#e39b12')
}

function drawSeat(ctx: CanvasRenderingContext2D, model: DrawSeatModel) {
  const { box, presentation, frame } = model
  const center = box.x + box.w / 2
  const deskW = 112
  const deskX = center - deskW / 2
  const deskY = box.y + 70
  const charX = center - (14 * PIXEL) / 2
  const charY = box.y + 18

  rect(ctx, center - 18, charY + 36, 36, 30, '#6b3a24')
  rect(ctx, center - 14, charY + 40, 28, 22, '#a56b3c')

  const look = presentation?.grey
    ? greyLook(LOOKS[model.lookIndex] ?? LOOKS[0])
    : (LOOKS[model.lookIndex] ?? LOOKS[0])

  if (model.occupied && presentation) {
    withFilter(ctx, presentation, presentation.opacity, () => {
      drawCharacter(ctx, charX, charY, look, presentation.pose, frame, PIXEL, 'back')
    })
  }

  drawDesk(ctx, deskX, deskY, deskW)
  const typing = presentation?.pose === 'typing'
  drawKeyboard(ctx, center - 14, deskY + 2, Boolean(typing && presentation?.animate), frame)

  if (presentation?.deskDocument) {
    withFilter(ctx, presentation, 1, () => drawDocument(ctx, deskX + 6, deskY - 8))
  } else {
    rect(ctx, deskX + 8, deskY + 1, 10, 6, '#f7f4ef')
  }

  drawPlant(ctx, deskX + deskW - 28, deskY - 16, 1)

  const monitorX = center - 18
  const monitorY = deskY - 30
  drawMonitor(ctx, monitorX, monitorY, presentation, frame)
  if (presentation) {
    withFilter(ctx, presentation, presentation.opacity, () => {
      drawCharacter(ctx, charX, charY, look, presentation.pose, frame, PIXEL, 'front')
    })
  }

  if (presentation?.plugIcon) drawPlug(ctx, monitorX - 20, monitorY + 8)

  if (presentation?.bubble) {
    const lift = presentation.pose === 'slump' ? 8 : presentation.pose === 'nap' ? 2 : 0
    withFilter(ctx, presentation, 1, () => {
      drawBubble(ctx, center - 11, box.y + 2 + lift, presentation.bubble as Exclude<BubbleCue, null>)
    })
  }

  if (model.selected) drawSelection(ctx, box)
}

/** Paint the whole floor into a 640×384 buffer. The caller sets the transform. */
export function drawOffice(ctx: CanvasRenderingContext2D, model: DrawModel) {
  ctx.clearRect(0, 0, LOGICAL_WIDTH, LOGICAL_HEIGHT)
  drawRoom(ctx, model.tick, model.reducedMotion)
  for (const seat of model.seats) drawSeat(ctx, seat)
  rect(ctx, 0, 0, LOGICAL_WIDTH, 2, '#4e2c1b')
  rect(ctx, 0, LOGICAL_HEIGHT - 2, LOGICAL_WIDTH, 2, '#4e2c1b')
  rect(ctx, 0, 0, 2, LOGICAL_HEIGHT, '#4e2c1b')
  rect(ctx, LOGICAL_WIDTH - 2, 0, 2, LOGICAL_HEIGHT, '#4e2c1b')
}

export const SEAT_LAYOUT = LAYOUT.seats
export const BOARD_LAYOUT = LAYOUT.manager
export const LEGEND_LAYOUT = LAYOUT.legend
