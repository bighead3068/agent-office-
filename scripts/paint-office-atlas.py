#!/usr/bin/env python3
"""Paint the style-B office atlas from the 32-color palette.

Natural_Privateer CC0 props are cropped, nearest-scaled, and recolored into
the palette. Kenney Roguelike Indoors and the BlazingMagpie base sprite are
not copied: the first is top-down 16px (and some tiles carry signs), the
second is only a proportion reference. semtex99 and extradave packs are not
read.
"""

from __future__ import annotations

import json
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "public" / "art"
PROP_DIR = ROOT / "third_party" / "cc0" / "natural-privateer"

PALETTE = [
    (0x2B, 0x1D, 0x16), (0x4A, 0x32, 0x26), (0x6B, 0x46, 0x31),
    (0x8C, 0x5E, 0x3C), (0xB0, 0x7A, 0x4F), (0xD1, 0x9E, 0x6C), (0xEB, 0xC5, 0x8F),
    (0xF6, 0xE7, 0xC1), (0xFF, 0xF8, 0xE6),
    (0xE9, 0xD8, 0xB4), (0xCD, 0xB5, 0x8C), (0xA5, 0x8D, 0x6A),
    (0x2F, 0x4A, 0x2C), (0x47, 0x69, 0x3A), (0x6E, 0x8F, 0x4E), (0xA3, 0xB8, 0x6C),
    (0x7A, 0x34, 0x28), (0xB5, 0x57, 0x3E), (0xD9, 0x84, 0x66),
    (0x2E, 0x3B, 0x55), (0x4F, 0x6E, 0x8F), (0x8D, 0xB3, 0xC7), (0xCF, 0xE3, 0xE6),
    (0xF2, 0xC4, 0x6B), (0xFF, 0xE3, 0x9A),
    (0x5E, 0x4A, 0x6B),
    (0x3A, 0x38, 0x38), (0x6B, 0x67, 0x66), (0xA8, 0xA2, 0x9A),
    (0x8D, 0x5A, 0x3E), (0xC6, 0x88, 0x63), (0xF0, 0xC7, 0xA0),
]
assert len(PALETTE) == 32
INK = PALETTE[0]
WOOD_D, WOOD_M, WOOD_L, WOOD_H = PALETTE[3:7]
CREAM, PAPER = PALETTE[7], PALETTE[8]
WALL_H, WALL_M, WALL_D = PALETTE[9:12]
GREEN = PALETTE[12:16]
TERRA = PALETTE[16:19]
BLUE = PALETTE[19:23]
GOLD, GLOW = PALETTE[23], PALETTE[24]
PLUM = PALETTE[25]
METAL = PALETTE[26:29]
SKIN = PALETTE[29:32]


def rgba(color: tuple[int, int, int], alpha: int = 255) -> tuple[int, int, int, int]:
    return (color[0], color[1], color[2], alpha)


def nearest(color: tuple[int, int, int]) -> tuple[int, int, int]:
    return min(PALETTE, key=lambda item: sum((a - b) * (a - b) for a, b in zip(item, color)))


class Pix:
    def __init__(self, w: int, h: int) -> None:
        self.im = Image.new("RGBA", (w, h), (0, 0, 0, 0))
        self.px = self.im.load()
        self.w = w
        self.h = h

    def p(self, x: int, y: int, color: tuple[int, int, int], alpha: int = 255) -> None:
        if 0 <= x < self.w and 0 <= y < self.h and alpha > 0:
            self.px[x, y] = rgba(color, alpha)

    def rect(self, x: int, y: int, w: int, h: int, color: tuple[int, int, int], alpha: int = 255) -> None:
        for yy in range(y, y + h):
            for xx in range(x, x + w):
                self.p(xx, yy, color, alpha)

    def hline(self, x: int, y: int, w: int, color: tuple[int, int, int]) -> None:
        self.rect(x, y, w, 1, color)

    def outline(self) -> None:
        add: list[tuple[int, int]] = []
        for y in range(self.h):
            for x in range(self.w):
                if self.px[x, y][3] != 0:
                    continue
                for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    nx, ny = x + dx, y + dy
                    if 0 <= nx < self.w and 0 <= ny < self.h and self.px[nx, ny][3] > 200:
                        add.append((x, y))
                        break
        for x, y in add:
            self.px[x, y] = rgba(INK)


def wood_floor() -> Pix:
    img = Pix(480, 288)
    for y in range(288):
        for x in range(480):
            tile_x, tile_y = x // 32, (y + 64) // 32
            pantry = tile_x >= 12 and 2 <= tile_y <= 4
            if pantry:
                color = PAPER if (x // 8 + y // 8) % 2 == 0 else CREAM
                if x % 8 == 0 or y % 8 == 0:
                    color = WALL_D
                img.p(x, y, color)
                continue
            variant = (tile_x * 3 + tile_y) % 3
            seam = y % 8 == 0
            knot = ((x + variant * 11) % 32 in (6, 7)) and (y % 8 in (3, 4)) and (tile_x + tile_y) % 5 == 0
            scar = variant == 2 and 12 < (x % 32) < 18 and 2 < (y % 8) < 6 and tile_y % 3 == 1
            grain = (x + variant + (y // 8) * 4) % 6 == 0
            if seam:
                color = WOOD_D
            elif knot or scar:
                color = WOOD_M
            elif grain:
                color = WOOD_L
            else:
                color = WOOD_H if (x + y // 8) % 4 else WOOD_L
            img.p(x, y, color)
    # Cool contact shade along the wall. Opaque pixels only, so the atlas stays on-palette.
    for x in range(480):
        if x % 2 == 0:
            img.p(x, 0, BLUE[0])
        elif x % 4 == 1:
            img.p(x, 1, PLUM)
    return img


def wall_band() -> Pix:
    img = Pix(480, 64)
    for y in range(64):
        for x in range(480):
            if y >= 58:
                color = WALL_D if y < 62 else WOOD_D
            elif y < 8:
                color = WALL_M
            elif (x + y * 2) % 17 == 0:
                color = WALL_M
            else:
                color = WALL_H
            img.p(x, y, color)
    return img


def window() -> Pix:
    img = Pix(64, 48)
    img.rect(0, 0, 64, 48, WOOD_D)
    img.rect(3, 3, 58, 42, BLUE[2])
    for y in range(3, 45):
        for x in range(3, 61):
            if ((x // 2) + (y // 2)) % 2 == 0:
                img.p(x, y, BLUE[3])
            else:
                img.p(x, y, BLUE[2])
            if x < 18 and y < 16 and (x + y) % 2 == 0:
                img.p(x, y, GLOW)
    img.rect(30, 3, 3, 42, WOOD_M)
    img.rect(3, 22, 58, 3, WOOD_M)
    img.rect(0, 0, 64, 2, WOOD_D)
    return img


def window_light() -> Pix:
    """2x2 dither. Empty pixels stay transparent so the floor shows through."""
    img = Pix(64, 32)
    for y in range(32):
        for x in range(64):
            if (x // 2 + y // 2) % 2 == 0:
                img.p(x, y, GLOW if (x + y) % 4 == 0 else GOLD)
    return img


def clock() -> Pix:
    img = Pix(16, 16)
    img.rect(2, 2, 12, 12, WOOD_M)
    img.rect(4, 4, 8, 8, PAPER)
    img.p(8, 5, INK)
    img.hline(8, 8, 3, INK)
    img.p(8, 9, INK)
    img.outline()
    return img


def poster() -> Pix:
    img = Pix(24, 32)
    img.rect(1, 1, 22, 30, CREAM)
    img.rect(3, 4, 18, 10, BLUE[1])
    img.rect(4, 16, 8, 10, GREEN[2])
    img.rect(13, 16, 7, 10, TERRA[1])
    img.rect(6, 6, 6, 4, GLOW)
    img.outline()
    return img


def whiteboard() -> Pix:
    img = Pix(64, 40)
    img.rect(0, 0, 64, 40, WOOD_M)
    img.rect(3, 3, 58, 30, PAPER)
    for x, color in ((8, BLUE[1]), (14, TERRA[1]), (22, GREEN[2]), (30, PLUM)):
        img.hline(x, 10, 8, color)
        img.hline(x + 2, 16, 10, color)
        img.p(x + 3, 22, color)
    img.rect(6, 34, 52, 3, WALL_D)
    return img


def desk() -> Pix:
    img = Pix(64, 40)
    for y in range(16):
        for x in range(64):
            seam = y == 15 or x % 16 == 0
            grain = x % 7 == 0 or (x + 3) % 11 == 0
            img.p(x, y, WOOD_D if seam else WOOD_M if grain else WOOD_H)
    img.hline(0, 0, 64, CREAM)
    for y in range(16, 40):
        for x in range(64):
            color = WOOD_M if x % 21 else WOOD_D
            img.p(x, y, color)
    img.rect(8, 20, 20, 14, WOOD_M)
    img.rect(36, 20, 20, 14, WOOD_M)
    img.rect(16, 26, 4, 3, GOLD)
    img.rect(44, 26, 4, 3, GOLD)
    img.hline(0, 39, 64, INK)
    return img


def chair() -> Pix:
    img = Pix(32, 40)
    img.rect(2, 8, 3, 28, WOOD_D)
    img.rect(27, 8, 3, 28, WOOD_D)
    img.rect(2, 8, 28, 4, WOOD_D)
    img.rect(5, 12, 22, 10, TERRA[2])
    img.rect(8, 14, 6, 3, TERRA[1])
    img.rect(5, 28, 22, 5, WOOD_M)
    return img


def monitor(off: bool = False) -> Pix:
    img = Pix(24, 20)
    img.rect(1, 0, 20, 14, METAL[0])
    img.rect(3, 2, 16, 10, METAL[0] if off else CREAM)
    if not off:
        img.rect(4, 3, 6, 8, PAPER)
        img.hline(11, 5, 6, BLUE[2])
        img.hline(11, 8, 5, WALL_M)
    img.rect(9, 14, 4, 3, METAL[1])
    img.rect(6, 17, 10, 2, METAL[2])
    return img


def mug() -> Pix:
    img = Pix(8, 8)
    img.rect(1, 2, 5, 5, PAPER)
    img.p(6, 3, WOOD_M)
    img.p(6, 4, WOOD_M)
    img.hline(1, 2, 5, CREAM)
    img.outline()
    return img


def papers() -> Pix:
    img = Pix(12, 8)
    img.rect(0, 1, 8, 6, PAPER)
    img.rect(3, 0, 8, 6, CREAM)
    img.hline(4, 2, 5, BLUE[2])
    img.hline(4, 4, 4, WALL_D)
    return img


def plant_small() -> Pix:
    img = Pix(12, 16)
    img.rect(4, 11, 4, 4, TERRA[1])
    img.rect(3, 10, 6, 2, TERRA[0])
    for x, y, color in (
        (5, 2, GREEN[3]), (3, 4, GREEN[2]), (7, 4, GREEN[1]),
        (2, 7, GREEN[0]), (6, 6, GREEN[2]), (8, 8, GREEN[1]), (4, 8, GREEN[3]),
    ):
        img.p(x, y, color)
        img.p(x, y + 1, GREEN[0])
    img.outline()
    return img


def plant_big() -> Pix:
    img = Pix(32, 48)
    img.rect(10, 34, 12, 12, TERRA[1])
    img.rect(8, 32, 16, 4, TERRA[0])
    img.hline(14, 44, 4, TERRA[2])
    leaves = [
        (16, 8, GREEN[3]), (10, 12, GREEN[2]), (20, 12, GREEN[1]),
        (6, 18, GREEN[0]), (16, 16, GREEN[2]), (24, 18, GREEN[1]),
        (8, 24, GREEN[2]), (18, 22, GREEN[3]), (12, 28, GREEN[1]), (22, 26, GREEN[0]),
    ]
    for x, y, color in leaves:
        img.rect(x, y, 4, 3, color)
        img.p(x + 1, y, GLOW if color == GREEN[3] else GREEN[2])
    img.rect(15, 28, 2, 6, GREEN[0])
    img.outline()
    return img


def hanging() -> Pix:
    img = Pix(24, 32)
    img.rect(10, 0, 4, 6, WOOD_D)
    img.rect(6, 6, 12, 6, TERRA[0])
    for x, y in ((4, 12), (10, 14), (16, 12), (7, 18), (14, 20), (10, 24)):
        img.rect(x, y, 5, 4, GREEN[2] if x < 12 else GREEN[1])
        img.p(x + 1, y, GREEN[3])
    img.outline()
    return img


def rug() -> Pix:
    img = Pix(96, 64)
    img.rect(0, 0, 96, 64, TERRA[0])
    img.rect(4, 4, 88, 56, TERRA[1])
    for y in range(8, 56, 8):
        for x in range(8, 88, 8):
            color = CREAM if (x // 8 + y // 8) % 2 == 0 else GOLD
            img.rect(x, y, 4, 4, color)
    img.rect(0, 0, 96, 2, TERRA[2])
    return img


def bar() -> Pix:
    img = Pix(96, 48)
    img.rect(0, 16, 96, 32, WOOD_D)
    img.rect(0, 8, 96, 10, WOOD_L)
    img.hline(0, 8, 96, WOOD_H)
    img.hline(0, 17, 96, INK)
    for x in (10, 28, 46, 64):
        img.rect(x, 22, 14, 16, WOOD_M)
        img.rect(x + 5, 28, 3, 3, GOLD)
    img.rect(8, 2, 6, 6, PAPER)
    img.rect(18, 3, 5, 5, BLUE[3])
    img.rect(70, 1, 8, 7, GREEN[2])
    return img


def fridge() -> Pix:
    img = Pix(32, 64)
    img.rect(2, 2, 28, 60, BLUE[3])
    img.rect(4, 4, 24, 26, PAPER)
    img.rect(4, 32, 24, 26, CREAM)
    img.rect(24, 14, 2, 8, METAL[1])
    img.rect(24, 40, 2, 8, METAL[1])
    img.hline(2, 31, 28, BLUE[1])
    img.rect(0, 0, 3, 64, BLUE[2])
    return img


def cooler() -> Pix:
    img = Pix(16, 40)
    img.rect(3, 2, 10, 16, BLUE[3])
    img.rect(4, 4, 8, 6, CREAM)
    img.rect(2, 18, 12, 18, METAL[1])
    img.rect(6, 24, 4, 6, BLUE[1])
    img.p(11, 30, BLUE[2])
    return img


def bookshelf() -> Pix:
    img = Pix(64, 64)
    img.rect(0, 0, 64, 64, WOOD_D)
    spines = [BLUE[0], TERRA[1], GREEN[1], GOLD, PLUM, BLUE[1], TERRA[0], GREEN[2], CREAM, TERRA[2]]
    for shelf in range(3):
        y = 4 + shelf * 20
        img.rect(3, y, 58, 16, WOOD_M)
        x = 5
        for index, color in enumerate(spines):
            w = 5 if index % 3 else 4
            img.rect(x, y + 1, w - 1, 12, color)
            img.p(x + 1, y + 3, PAPER if index % 2 == 0 else GLOW)
            x += w
            if x > 56:
                break
        img.hline(2, y + 15, 60, WOOD_D)
    return img


def sofa() -> Pix:
    img = Pix(64, 40)
    img.rect(2, 8, 60, 24, TERRA[0])
    img.rect(4, 10, 26, 14, TERRA[1])
    img.rect(34, 10, 26, 14, TERRA[2])
    img.rect(0, 6, 6, 26, TERRA[0])
    img.rect(58, 6, 6, 26, TERRA[0])
    img.rect(4, 32, 6, 6, WOOD_D)
    img.rect(54, 32, 6, 6, WOOD_D)
    img.hline(8, 12, 10, TERRA[2])
    return img


def recolor_prop(path: Path, size: int) -> Pix:
    source = Image.open(path).convert("RGBA")
    bbox = source.getbbox()
    if bbox:
        source = source.crop(bbox)
    source = source.resize((size, size), Image.NEAREST)
    img = Pix(size, size)
    pixels = source.load()
    for y in range(size):
        for x in range(size):
            red, green, blue, alpha = pixels[x, y]
            if alpha < 40:
                continue
            img.p(x, y, nearest((red, green, blue)))
    return img


def draw_person(look: dict, pose: str, frame: int) -> Pix:
    img = Pix(32, 48)
    skin = look["skin"]
    skin_shade = SKIN[max(0, SKIN.index(skin) - 1)] if skin in SKIN else SKIN[0]
    top = look["top"]
    top_shade = METAL[0] if top == METAL[1] else BLUE[0] if top == BLUE[0] else TERRA[0] if top == TERRA[1] else GREEN[0] if top == GREEN[1] else WOOD_D
    bob = [0, -1, 0, 1][frame % 4] if pose in {"breathe", "idle"} else 0
    if pose == "wait":
        bob = [0, 0, 1, 1][frame % 4]
    if pose == "nap":
        bob = [1, 2, 3, 2][frame % 4]
    if pose == "fail":
        bob = [0, 3, 6][min(frame, 2)]
    if pose == "stretch":
        bob = [0, -1, -2, -2, -1, 0][min(frame, 5)]
    head_y = 6 + bob
    # Hair back.
    hair = look["hair"]
    hair_color = look["hairColor"]
    img.rect(9, head_y, 14, 12, hair_color)
    # Face.
    img.rect(10, head_y + 3, 12, 10, skin)
    img.rect(10, head_y + 11, 12, 2, skin_shade)
    img.p(9, head_y + 8, skin)
    img.p(22, head_y + 8, skin)
    img.hline(12, head_y + 5, 2, skin_shade)
    img.hline(18, head_y + 5, 2, skin_shade)
    eyes_closed = pose == "blink" or pose == "nap" or (pose == "fail" and frame == 2)
    if eyes_closed:
        img.hline(12, head_y + 7, 2, INK)
        img.hline(18, head_y + 7, 2, INK)
    else:
        img.p(12, head_y + 7, INK)
        img.p(13, head_y + 7, INK)
        img.p(18, head_y + 7, INK)
        img.p(19, head_y + 7, INK)
        img.p(12, head_y + 6, PAPER)
        img.p(18, head_y + 6, PAPER)
    img.p(15, head_y + 9, skin_shade)
    img.p(16, head_y + 9, skin_shade)
    # Hair styles.
    if hair == "short":
        img.rect(9, head_y, 14, 4, hair_color)
        img.p(10, head_y + 4, hair_color)
        img.p(21, head_y + 4, hair_color)
    elif hair == "side":
        img.rect(9, head_y, 14, 4, hair_color)
        img.rect(9, head_y + 4, 4, 5, hair_color)
    elif hair == "tie":
        img.rect(9, head_y, 14, 3, hair_color)
        img.rect(20, head_y + 3, 4, 8, hair_color)
        img.p(23, head_y + 8, TERRA[1])
    elif hair == "bob":
        img.rect(8, head_y + 2, 3, 8, hair_color)
        img.rect(21, head_y + 2, 3, 8, hair_color)
        img.rect(9, head_y, 14, 4, hair_color)
    elif hair == "curls":
        for x in (8, 12, 16, 20):
            img.rect(x, head_y, 3, 3, hair_color)
        img.rect(8, head_y + 3, 3, 4, hair_color)
        img.rect(21, head_y + 3, 3, 4, hair_color)
    elif hair == "buzz":
        img.rect(10, head_y, 12, 3, hair_color)
    elif hair == "bangs":
        img.rect(9, head_y, 14, 5, hair_color)
        img.p(12, head_y + 5, hair_color)
        img.p(16, head_y + 5, hair_color)
        img.p(19, head_y + 5, hair_color)
    else:  # puff
        img.rect(7, head_y + 1, 4, 6, hair_color)
        img.rect(21, head_y + 1, 4, 6, hair_color)
        img.rect(10, head_y - 1, 12, 4, hair_color)
    # Neck and torso.
    img.rect(14, head_y + 13, 4, 3, skin)
    torso_y = 22 + bob
    img.rect(8, torso_y, 16, 12, top)
    img.rect(8, torso_y, 3, 12, top_shade)
    img.hline(10, torso_y, 12, CREAM if top != CREAM else PAPER)
    if look["topKind"] == "hoodie":
        img.rect(11, torso_y, 10, 4, top_shade)
        img.p(13, torso_y + 4, METAL[2])
        img.p(18, torso_y + 4, METAL[2])
    # Arms.
    if pose == "type":
        hand_y = 32 + (frame % 2)
        other = 33 - (frame % 2)
        img.rect(5, torso_y + 4, 4, 6, top)
        img.rect(23, torso_y + 4, 4, 6, top)
        img.rect(6, hand_y, 3, 2, skin)
        img.rect(23, other, 3, 2, skin)
    elif pose == "wait":
        img.rect(5, torso_y + 2, 4, 8, top)
        img.rect(23, torso_y - 2, 4, 6, top)
        img.rect(24, torso_y - 4, 3, 3, skin)
        img.p(25, torso_y - 3, GOLD)
    elif pose == "blocked":
        lift = [0, -1, -2][min(frame, 2)]
        img.rect(7, head_y + 2 + lift, 4, 6, top)
        img.rect(20, head_y + 2 + lift, 4, 6, top)
        img.rect(8, head_y + lift, 4, 3, skin)
        img.rect(19, head_y + lift, 4, 3, skin)
    elif pose == "fail":
        img.rect(4, torso_y + 6, 8, 3, top)
        img.rect(20, torso_y + 6, 8, 3, top)
        img.rect(4, 34, 5, 3, skin)
        img.rect(23, 34, 5, 3, skin)
    elif pose == "stretch":
        rise = [0, -3, -6, -8, -6, -2][min(frame, 5)]
        img.rect(4, torso_y + rise, 4, 8, top)
        img.rect(24, torso_y + rise, 4, 8, top)
        img.rect(4, torso_y + rise - 2, 3, 3, skin)
        img.rect(25, torso_y + rise - 2, 3, 3, skin)
    elif pose == "coffee":
        lift = [0, -2, -4, -6, -6, -4, -2, 0][frame % 8]
        img.rect(5, torso_y + 4, 4, 7, top)
        img.rect(22, torso_y + 6 + lift, 4, 6, top)
        img.rect(22, torso_y + 4 + lift, 4, 3, PAPER)
        img.p(23, torso_y + 3 + lift, CREAM)
    elif pose == "tend":
        reach = [0, 1, 2, 3, 3, 2, 1, 0][frame % 8]
        img.rect(5, torso_y + 4, 4, 7, top)
        img.rect(22 + reach, torso_y + 6, 5, 3, top)
        img.rect(26 + reach, torso_y + 6, 3, 3, skin)
    elif pose == "pen":
        img.rect(5, torso_y + 4, 4, 7, top)
        img.rect(22, torso_y + 5, 4, 6, top)
        spin = frame % 6
        img.p(26, 30 + (spin % 3), BLUE[1] if spin < 3 else GOLD)
        img.p(27, 31 + (spin % 2), INK)
    else:
        img.rect(5, torso_y + 4, 4, 8, top)
        img.rect(23, torso_y + 4, 4, 8, top)
        img.rect(5, torso_y + 11, 4, 3, skin)
        img.rect(23, torso_y + 11, 4, 3, skin)
    # Legs, mostly hidden by the desk.
    img.rect(10, 36, 4, 8, BLUE[0])
    img.rect(18, 36, 4, 8, BLUE[0])
    img.rect(10, 43, 4, 3, INK)
    img.rect(18, 43, 4, 3, INK)
    # Accessory and prop.
    accessory = look["accessory"]
    if accessory == "headset":
        img.hline(9, head_y + 6, 14, METAL[1])
        img.rect(8, head_y + 6, 2, 4, METAL[2])
        img.rect(22, head_y + 6, 2, 3, METAL[0])
        img.p(23, head_y + 9, GOLD)
    elif accessory == "headphones":
        img.rect(8, head_y + 5, 3, 5, METAL[0])
        img.rect(21, head_y + 5, 3, 5, METAL[0])
        img.hline(10, head_y + 4, 12, METAL[1])
    elif accessory == "glasses":
        img.rect(11, head_y + 6, 4, 3, BLUE[2])
        img.rect(17, head_y + 6, 4, 3, BLUE[2])
        img.p(15, head_y + 7, METAL[2])
        img.p(16, head_y + 7, METAL[2])
    if look["prop"] == "clipboard":
        img.rect(3, torso_y + 6, 6, 8, CREAM)
        img.hline(4, torso_y + 8, 4, BLUE[1])
        img.hline(4, torso_y + 10, 3, WALL_D)
        img.p(5, torso_y + 6, METAL[2])
    elif look["prop"] == "tablet":
        img.rect(2, torso_y + 8, 7, 5, METAL[0])
        img.rect(3, torso_y + 9, 5, 3, CREAM)
    elif look["prop"] == "checklist":
        img.rect(22, torso_y + 8, 6, 7, PAPER)
        img.p(23, torso_y + 10, GREEN[2])
        img.p(23, torso_y + 12, GREEN[1])
        img.hline(24, torso_y + 10, 3, WALL_D)
    elif look["prop"] == "magnifier":
        img.rect(24, torso_y + 8, 5, 5, BLUE[3])
        img.rect(25, torso_y + 9, 3, 3, CREAM)
        img.rect(27, torso_y + 12, 2, 3, WOOD_D)
    elif look["prop"] == "swatch":
        img.rect(24, torso_y + 7, 6, 6, PAPER)
        img.p(25, torso_y + 8, TERRA[1])
        img.p(27, torso_y + 8, GREEN[2])
        img.p(25, torso_y + 10, GOLD)
        img.p(27, torso_y + 10, BLUE[1])
    if pose == "blocked":
        # Sweat is a separate overlay; keep the face clear.
        pass
    img.outline()
    return img


def sweat(frame: int) -> Pix:
    img = Pix(32, 48)
    drop = BLUE[3] if frame % 2 == 0 else BLUE[2]
    img.p(23, 16, drop)
    img.p(24, 17, drop)
    img.p(23, 18, BLUE[1])
    return img


LOOKS = {
    "coordinator": {
        "skin": SKIN[2], "hair": "short", "hairColor": INK, "top": BLUE[0], "topKind": "shirt",
        "accessory": "headset", "prop": "clipboard",
    },
    "developer": {
        "skin": SKIN[1], "hair": "side", "hairColor": WOOD_D, "top": METAL[1], "topKind": "hoodie",
        "accessory": "headphones", "prop": "none",
    },
    "designer": {
        "skin": SKIN[2], "hair": "tie", "hairColor": INK, "top": TERRA[1], "topKind": "shirt",
        "accessory": "none", "prop": "swatch",
    },
    "tester": {
        "skin": SKIN[1], "hair": "bangs", "hairColor": METAL[0], "top": GREEN[1], "topKind": "shirt",
        "accessory": "glasses", "prop": "checklist",
    },
}

HASH_PARTS = [
    ("deep", "bob", "shirt", "navy", "none", "magnifier"),
    ("mid", "curls", "hoodie", "metal", "headphones", "none"),
    ("lite", "puff", "shirt", "terra", "none", "tablet"),
    ("deep", "buzz", "shirt", "green", "glasses", "checklist"),
    ("mid", "short", "shirt", "navy", "headset", "clipboard"),
    ("lite", "side", "hoodie", "metal", "none", "swatch"),
    ("deep", "bangs", "shirt", "terra", "glasses", "none"),
    ("mid", "tie", "shirt", "green", "headset", "magnifier"),
]
TOPS = {"navy": BLUE[0], "metal": METAL[1], "terra": TERRA[1], "green": GREEN[1]}
SKINS = {"deep": SKIN[0], "mid": SKIN[1], "lite": SKIN[2]}
HAIR_COLORS = {"deep": INK, "mid": WOOD_D, "lite": WOOD_M}


def hash_look(index: int) -> dict:
    skin, hair, kind, top, accessory, prop = HASH_PARTS[index]
    return {
        "skin": SKINS[skin],
        "hair": hair,
        "hairColor": HAIR_COLORS[skin],
        "top": TOPS[top],
        "topKind": kind,
        "accessory": accessory,
        "prop": prop,
    }


POSES = {
    "breathe": 4,
    "blink": 2,
    "type": 4,
    "wait": 4,
    "blocked": 3,
    "fail": 3,
    "stretch": 6,
    "sit": 1,
    "coffee": 8,
    "tend": 8,
    "nap": 4,
    "pen": 6,
}


class Atlas:
    def __init__(self) -> None:
        self.width = 1024
        self.x = 0
        self.y = 0
        self.row_h = 0
        self.sprites: dict[str, dict[str, int]] = {}
        self.images: list[tuple[int, int, Image.Image]] = []

    def add(self, name: str, pix: Pix) -> None:
        image = pix.im
        if self.x + image.width + 1 > self.width:
            self.x = 0
            self.y += self.row_h + 1
            self.row_h = 0
        self.sprites[name] = {"x": self.x, "y": self.y, "w": image.width, "h": image.height}
        self.images.append((self.x, self.y, image))
        self.x += image.width + 1
        self.row_h = max(self.row_h, image.height)

    def bake(self) -> Image.Image:
        sheet = Image.new("RGBA", (self.width, self.y + self.row_h), (0, 0, 0, 0))
        for x, y, image in self.images:
            sheet.paste(image, (x, y), image)
        return sheet


def main() -> None:
    atlas = Atlas()
    atlas.add("floor", wood_floor())
    atlas.add("wall", wall_band())
    atlas.add("window", window())
    atlas.add("window-light", window_light())
    atlas.add("clock", clock())
    atlas.add("poster", poster())
    atlas.add("whiteboard", whiteboard())
    atlas.add("desk", desk())
    atlas.add("chair", chair())
    atlas.add("monitor", monitor(False))
    atlas.add("monitor-off", monitor(True))
    atlas.add("mug", mug())
    atlas.add("papers", papers())
    atlas.add("plant-small", plant_small())
    atlas.add("plant-big", plant_big())
    atlas.add("hanging", hanging())
    atlas.add("rug", rug())
    atlas.add("bar", bar())
    atlas.add("fridge", fridge())
    atlas.add("cooler", cooler())
    atlas.add("bookshelf", bookshelf())
    atlas.add("sofa", sofa())
    atlas.add("prop-bottle", recolor_prop(PROP_DIR / "water_bottle_32bit_img.png", 16))
    atlas.add("prop-tape", recolor_prop(PROP_DIR / "tape_roll_32bit_img.png", 16))
    atlas.add("prop-pens", recolor_prop(PROP_DIR / "cup_of_pens_32bit_img.png", 16))
    atlas.add("prop-paper", recolor_prop(PROP_DIR / "office_paper_work_32bit_img.png", 16))
    for frame in range(2):
        atlas.add(f"sweat-{frame}", sweat(frame))

    look_names = list(LOOKS)
    for index in range(8):
        look_names.append(f"hash-{index}")
        LOOKS[f"hash-{index}"] = hash_look(index)
    animations: dict[str, dict[str, list[str]]] = {name: {} for name in look_names}
    for name in look_names:
        for pose, count in POSES.items():
            frames = []
            for frame in range(count):
                sprite = f"{name}-{pose}-{frame}"
                atlas.add(sprite, draw_person(LOOKS[name], pose, frame))
                frames.append(sprite)
            animations[name][pose] = frames

    sheet = atlas.bake()
    offenders = set()
    pixels = sheet.load()
    for y in range(sheet.height):
        for x in range(sheet.width):
            red, green, blue, alpha = pixels[x, y]
            if alpha == 0:
                continue
            if (red, green, blue) not in PALETTE:
                offenders.add((red, green, blue))
    if offenders:
        raise SystemExit(f"atlas left the palette: {sorted(offenders)[:8]}")

    layers = [
        {"sprite": "floor", "x": 0, "y": 64, "z": 0},
        {"sprite": "rug", "x": 388, "y": 236, "z": 1},
        {"sprite": "window-light", "x": 64, "y": 150, "z": 1},
        {"sprite": "window-light", "x": 192, "y": 150, "z": 1},
        {"sprite": "window-light", "x": 320, "y": 150, "z": 1},
        {"sprite": "wall", "x": 0, "y": 0, "z": 2},
        {"sprite": "window", "x": 64, "y": 8, "z": 2},
        {"sprite": "window", "x": 192, "y": 8, "z": 2},
        {"sprite": "window", "x": 320, "y": 8, "z": 2},
        {"sprite": "whiteboard", "x": 8, "y": 12, "z": 3},
        {"sprite": "clock", "x": 280, "y": 14, "z": 3},
        {"sprite": "poster", "x": 360, "y": 10, "z": 3},
        {"sprite": "bar", "x": 384, "y": 80, "z": 4},
        {"sprite": "fridge", "x": 440, "y": 64, "z": 4},
        {"sprite": "cooler", "x": 424, "y": 88, "z": 4},
        {"sprite": "bookshelf", "x": 384, "y": 224, "z": 4},
        {"sprite": "sofa", "x": 400, "y": 300, "z": 4},
        {"sprite": "plant-big", "x": 448, "y": 270, "z": 4},
        {"sprite": "hanging", "x": 448, "y": 64, "z": 9},
        {"sprite": "plant-big", "x": 8, "y": 300, "z": 9},
    ]
    anchors = [(64, 128), (160, 128), (256, 128), (352, 128), (64, 288), (160, 288), (256, 288), (352, 288)]
    clutter = ["mug", "papers", "plant-small", "prop-bottle", "prop-tape", "prop-pens", "prop-paper", "mug"]
    seats = []
    for index, (ax, ay) in enumerate(anchors):
        seats.append({
            "id": f"{'A' if index < 4 else 'B'}{(index % 4) + 1}",
            "index": index,
            "column": index % 4,
            "anchor": [ax, ay],
            "chair": {"sprite": "chair", "x": ax - 16, "y": ay - 28},
            "desk": {"sprite": "desk", "x": ax - 32, "y": ay},
            "monitor": {"sprite": "monitor", "x": ax - 20, "y": ay - 16},
            "clutter": {"sprite": clutter[index], "x": ax + 8, "y": ay - 6},
        })
    manifest = {
        "image": "office-atlas.png",
        "size": {"w": sheet.width, "h": sheet.height},
        "tile": 32,
        "scene": {"cols": 15, "rows": 11, "scale": 2},
        "palette": [f"#{r:02X}{g:02X}{b:02X}" for r, g, b in PALETTE],
        "sprites": atlas.sprites,
        "layers": layers,
        "seats": seats,
        "character": {
            "frame": {"w": 32, "h": 48},
            "origin": {"x": -16, "y": -32},
            "assignments": [
                {"id": "lin", "look": "coordinator"},
                {"id": "chen", "look": "developer"},
                {"id": "gao", "look": "designer"},
                {"id": "fang", "look": "tester"},
            ],
            "rules": [
                {"includes": ["協調", "調度"], "look": "coordinator"},
                {"includes": ["開發", "程式"], "look": "developer"},
                {"includes": ["設計", "視覺"], "look": "designer"},
                {"includes": ["測試", "品質"], "look": "tester"},
            ],
            "hashLooks": [f"hash-{index}" for index in range(8)],
            "animations": animations,
            "poses": {
                "breathe": {"fps": 4, "loop": "pingpong"},
                "blink": {"fps": 8, "loop": "once"},
                "type": {"fps": 8, "loop": "loop"},
                "wait": {"fps": 3, "loop": "loop", "holdMs": 2000},
                "blocked": {"fps": 4, "loop": "once"},
                "fail": {"fps": 6, "loop": "once"},
                "stretch": {"fps": 8, "loop": "once", "then": "sit"},
                "sit": {"fps": 1, "loop": "once"},
                "coffee": {"fps": 6, "loop": "once", "maxMs": 8000},
                "tend": {"fps": 6, "loop": "once", "maxMs": 8000},
                "nap": {"fps": 2, "loop": "loop", "maxMs": 8000},
                "pen": {"fps": 8, "loop": "loop", "maxMs": 8000},
            },
            "statusPose": {
                "working": "type",
                "waiting": "wait",
                "blocked": "blocked",
                "failed": "fail",
                "completed": "stretch",
                "unknown": "breathe",
                "offline": "breathe",
                "idle": "breathe",
            },
            "eggs": ["coffee", "tend", "stretch", "nap", "pen"],
            "lookProps": {
                "developer": [{"sprite": "monitor", "dx": 14, "dy": -16}],
                "designer": [{"sprite": "prop-paper", "dx": -28, "dy": -4}],
                "coordinator": [{"sprite": "prop-pens", "dx": 22, "dy": -4}],
                "tester": [{"sprite": "prop-tape", "dx": 22, "dy": -4}],
            },
            "blinkEveryMs": [3000, 6000],
            "sweat": ["sweat-0", "sweat-1"],
        },
    }
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    sheet.save(OUT_DIR / "office-atlas.png")
    (OUT_DIR / "office-atlas.json").write_text(json.dumps(manifest, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"atlas {sheet.size} sprites {len(atlas.sprites)}")


if __name__ == "__main__":
    main()
