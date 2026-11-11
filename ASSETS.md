# Agent Office v0.2 assets

Scene pixels use only the 32-color style B palette. Status colors live in the UI stylesheet, not in the atlas. Replacing `public/art/office-atlas.png` and `public/art/office-atlas.json` together changes the art; the renderer looks sprites up by name.

CC0 legal text: [https://creativecommons.org/publicdomain/zero/1.0/legalcode](https://creativecommons.org/publicdomain/zero/1.0/legalcode)

These packs were reviewed and are **not** in the repo: semtex99 “indoor office appliances”, extradave “Crimelike - Furniture”. Kenney tiles that carry readable signs (including laboratory and treasure labels) were not copied. No paid, CC-BY, LPC, or Mana Seed assets are included.

## Images

| Asset | Author | Source URL | License | Files used in repo | Modified | Retrieved |
| --- | --- | --- | --- | --- | --- | --- |
| Style B office atlas (floor, walls, furniture, modular characters) | Agent Office contributors | `scripts/paint-office-atlas.py` in this repo | MIT, below | `public/art/office-atlas.png`, `public/art/office-atlas.json` | No | 2026-11-11 |
| Water bottle, 32×32 | Natural_Privateer | https://opengameart.org/content/2d-pixel-office-supplies-32x32 | CC0 1.0 | `third_party/cc0/natural-privateer/water_bottle_32bit_img.png`; recolored into `public/art/office-atlas.png` (`prop-bottle`) | Yes | 2026-11-11 |
| Tape roll, 32×32 | Natural_Privateer | https://opengameart.org/content/2d-pixel-office-supplies-32x32 | CC0 1.0 | `third_party/cc0/natural-privateer/tape_roll_32bit_img.png`; recolored into `public/art/office-atlas.png` (`prop-tape`) | Yes | 2026-11-11 |
| Cup of pens, 32×32 | Natural_Privateer | https://opengameart.org/content/2d-pixel-office-supplies-32x32 | CC0 1.0 | `third_party/cc0/natural-privateer/cup_of_pens_32bit_img.png`; recolored into `public/art/office-atlas.png` (`prop-pens`) | Yes | 2026-11-11 |
| Office paper, 32×32 | Natural_Privateer | https://opengameart.org/content/2d-pixel-office-supplies-32x32 | CC0 1.0 | `third_party/cc0/natural-privateer/office_paper_work_32bit_img.png`; recolored into `public/art/office-atlas.png` (`prop-paper`) | Yes | 2026-11-11 |
| Roguelike Indoors | Kenney (Kenney Vleugels) | https://kenney.nl/assets/roguelike-indoors | CC0 1.0 | None. Top-down 16px tiles do not match the side-view office, and some tiles contain signs. Not shipped. | n/a | 2026-11-11 |
| Simple 32×48 base sprite | BlazingMagpie | https://opengameart.org/content/simple-32x48-base-sprite | CC0 1.0 | None. Used only to check that a character frame is 32×48 with a large head. Pixels were not copied. | n/a | 2026-11-11 |
| Favicon | Agent Office contributors | `public/favicon.svg` | MIT, below | `public/favicon.svg` | No | 2026-11-11 |

The four Natural_Privateer files were checked on 2026-11-11. They show a bottle, a tape roll, pens, and a sheet of paper. None of them contains a brand logo, and no logo was copied into the atlas.

## Fonts

Fusion Pixel 12 is the face used in the UI (`font-family: "Fusion Pixel"`), only at 12px and 24px, weight 400. It includes Cubic 11 as an upstream source. A subset of that source must not be given the reserved names Cubic or 俐方體. This repo does not ship a font under either of those names.

| Asset | Author | Source URL | License | Files used in repo | Modified | Retrieved |
| --- | --- | --- | --- | --- | --- | --- |
| Fusion Pixel 12 proportional, Traditional Chinese and Latin | TakWolf and Fusion Pixel contributors | https://github.com/TakWolf/fusion-pixel-font | SIL Open Font License 1.1. Full text: `public/fonts/FusionPixel-OFL.txt` | `public/fonts/fusion-pixel-12px-proportional-zh_hant.otf.woff2`, `public/fonts/fusion-pixel-12px-proportional-latin.otf.woff2` | No | 2026-11-11 |
| Cubic 11 license text (upstream of Fusion Pixel; not a shipped font name) | ACh-K, packaged with Fusion Pixel | https://github.com/ACh-K/Cubic-11 | SIL Open Font License 1.1. Full text: `public/fonts/Cubic11-OFL.txt`. Reserved names Cubic and 俐方體 are not used as a font name here. | `public/fonts/Cubic11-OFL.txt` only | No | 2026-11-11 |
| Silkscreen | The Silkscreen Project Authors (Jason Kottke and contributors) | https://github.com/googlefonts/silkscreen | SIL Open Font License 1.1. Full text: `public/fonts/OFL.txt` | `public/fonts/Silkscreen-Regular.ttf` | No | 2026-11-11 |

Bubble text is 16px and task text is 14px in Noto Sans TC, then Noto Sans CJK TC or WenQuanYi Micro Hei when the system has them. The Noto Sans TC file is not vendored. It is the SIL Open Font License family from Google: https://fonts.google.com/noto/specimen/Noto+Sans+TC

## MIT license for the original art

Copyright 2026 Agent Office contributors

Permission is granted to use, copy, modify, and distribute the original pixel art and SVG marks in this repository, including for commercial use, provided this notice is kept with substantial portions of the art.
