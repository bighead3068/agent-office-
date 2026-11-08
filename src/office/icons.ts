import type { BubbleCue } from './presentation'

/** 7×7 glyphs. `1` is ink. Shared by canvas bubbles and the HTML legend. */
export const PIXEL_ICONS: Record<Exclude<BubbleCue, null> | 'plug' | 'sleep', string[]> = {
  gear: ['0100010', '1010101', '0111110', '1101011', '0111110', '1010101', '0100010'],
  ellipsis: ['0000000', '0000000', '0000000', '1001001', '1001001', '0000000', '0000000'],
  block: ['1100011', '1100011', '1100011', '1100011', '1100011', '1100011', '1100011'],
  check: ['0000001', '0000011', '0000110', '1101100', '0111000', '0010000', '0000000'],
  bang: ['0011100', '0011100', '0011100', '0001000', '0000000', '0011100', '0011100'],
  question: ['0111110', '1100011', '0000110', '0001100', '0001000', '0000000', '0001000'],
  plug: ['0110000', '1011000', '1011000', '0111110', '0011100', '0111110', '0011100'],
  sleep: ['0000000', '0011110', '0000000', '0000000', '0000000', '0000000', '0000000'],
}

export type PixelIconName = keyof typeof PIXEL_ICONS

export function iconRows(name: PixelIconName): string[] {
  return PIXEL_ICONS[name]
}
