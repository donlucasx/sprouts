# Garden2 (the painted garden, R508G): copies the approved composition export (brand/garden2/app-export/, mockup v8, R498G) into
# the app and writes the two generated TypeScript files the app reads:
#   src/garden2/layout.ts   pure data (canvas, draw order, coins, each plant's box and stage range, the two overlays' boxes, and a
#                           coarse alpha grid per plant per stage for tap hit tests). No requires, so Node and vitest can load it.
#   src/garden2/sources.ts  one static require per layer, so Metro bundles every layer.
# The two full-canvas overlays (stand-overlay.png, pothos-cords.png) are cropped to their opaque bounding box and placed by x/y;
# compositing them cropped at their box is pixel-identical to the full-canvas paste.
# Usage (from anywhere): python3 -I app/scripts/garden2/export.py [path/to/app-export]
import json, os, shutil, sys, base64
import numpy as np
from PIL import Image

APP = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
SRC = sys.argv[1] if len(sys.argv) > 1 else "/Users/lucasgarzoli/Documents/claude/seekerhackathon/brand/garden2/app-export"
OUT = os.path.join(APP, "assets", "garden2")
CELL = 16   # hit grid cell, canvas px
HIT_ALPHA = 128   # a pixel counts as plant at this alpha or more
HIT_SHARE = 0.2   # a cell is plant when this share of its pixels are

L = json.load(open(os.path.join(SRC, "layout.json")))
W, H = L["canvas"]["w"], L["canvas"]["h"]
if os.path.isdir(OUT): shutil.rmtree(OUT)
os.makedirs(OUT)
shutil.copyfile(os.path.join(SRC, "plate.png"), os.path.join(OUT, "plate.png"))
# R529: dark-mode variants, all optional: plate-dark.png, an overlay's "<stem>-dark<ext>", a stage layer's "<stem>-dark.webp".
HAS_DARK_PLATE = os.path.exists(os.path.join(SRC, "plate-dark.png"))
if HAS_DARK_PLATE: shutil.copyfile(os.path.join(SRC, "plate-dark.png"), os.path.join(OUT, "plate-dark.png"))
dark_variant = lambda rel: (lambda d: d if os.path.exists(os.path.join(SRC, d)) else None)(os.path.splitext(rel)[0] + "-dark" + os.path.splitext(rel)[1])
dark_overlays, dark_stages = {}, {}

overlays = {}
for name, rule in L["overlays"].items():
    im = Image.open(os.path.join(SRC, name)).convert("RGBA")
    assert im.size == (W, H), name
    x0, y0, x1, y1 = im.getchannel("A").getbbox()
    key = "stand" if name.startswith("stand") else "cords"
    im.crop((x0, y0, x1, y1)).save(os.path.join(OUT, f"{key}.png"), optimize=True)
    dv = dark_variant(name)
    if dv:  # cut at the light layer's box, so the dark one draws in exactly the same place
        dim = Image.open(os.path.join(SRC, dv)).convert("RGBA"); assert dim.size == (W, H), dv
        dim.crop((x0, y0, x1, y1)).save(os.path.join(OUT, f"{key}-dark.png"), optimize=True)
        dark_overlays[key] = f"{key}-dark.png"
    overlays[key] = {"file": f"{key}.png", "x": x0, "y": y0, "w": x1 - x0, "h": y1 - y0, **rule}

def mask(im, w, h):
    a = (np.asarray(im.getchannel("A")) >= HIT_ALPHA).astype(np.float32)
    cols, rows = -(-w // CELL), -(-h // CELL)
    pad = np.zeros((rows * CELL, cols * CELL), np.float32); pad[:h, :w] = a
    share = pad.reshape(rows, CELL, cols, CELL).mean((1, 3))
    bits = np.packbits((share >= HIT_SHARE).reshape(-1).astype(np.uint8))
    return {"cols": cols, "rows": rows, "bits": base64.b64encode(bits.tobytes()).decode()}

plants, masks = {}, {}
for p in L["draw_order"]:
    b = L["plants"][p]; os.makedirs(os.path.join(OUT, p))
    stages = sorted(int(s) for s in b["stages"])
    masks[p] = {}
    for s in stages:
        src = os.path.join(SRC, b["stages"][str(s)])
        im = Image.open(src).convert("RGBA")
        assert im.size == (b["w"], b["h"]), (p, s, im.size)
        shutil.copyfile(src, os.path.join(OUT, p, f"stage{s:02d}.webp"))
        dv = dark_variant(b["stages"][str(s)])
        if dv:
            assert Image.open(os.path.join(SRC, dv)).size == (b["w"], b["h"]), (p, s, "dark")
            shutil.copyfile(os.path.join(SRC, dv), os.path.join(OUT, p, f"stage{s:02d}-dark.webp"))
            dark_stages.setdefault(p, []).append(s)
        masks[p][s] = mask(im, b["w"], b["h"])
    plants[p] = {"x": b["x"], "y": b["y"], "w": b["w"], "h": b["h"], "first": stages[0], "last": stages[-1]}
    assert stages == list(range(stages[0], stages[-1] + 1)), (p, stages)

# R533/R547-R549: the two trees' fruit (SKR mandarins) and flowers (stORE ORE-gold), measured on these same stage layers by
# brand/garden2/spots14/place_spots.py: per stage, the spots (box px, sprite centres) and the radius (the sprite is drawn 2r square).
GARDEN2 = os.path.dirname(os.path.abspath(SRC))
TREE_SPOTS = json.load(open(os.path.join(GARDEN2, "spots14", "tree_spots.json")))
SPRITES = {"mandarin": "mandarin/fruit/mandarin-ripe.png", "store": "store/flower/store-flower-open.png"}
spots = {}
for tree, rel in SPRITES.items():
    shutil.copyfile(os.path.join(GARDEN2, "assets", rel), os.path.join(OUT, f"{tree}-fruit.png"))
    spots[tree] = {int(s): {"r": v["radius"], "at": v["spots"]} for s, v in TREE_SPOTS[tree].items()}
    for s, v in spots[tree].items():
        b = plants[tree]
        assert all(0 <= x < b["w"] and 0 <= y < b["h"] for x, y in v["at"]), (tree, s)

coins = L["coins"]
head = "// GENERATED by scripts/garden2/export.py from brand/garden2/app-export (mockup v8). Do not edit by hand.\n"
lay = head + f"""
export const CANVAS = {{ w: {W}, h: {H} }} as const
/** Back to front (R490G-R497G placement). */
export const DRAW_ORDER = {json.dumps(L["draw_order"])} as const
export type Plant2 = (typeof DRAW_ORDER)[number]
/** layout.json's coin names (USDC = USDC lending, SOL = SOL lending). */
export const COIN_PLANTS = {json.dumps(coins)} as const
/** Each plant's box on the canvas (its layers are cut to this size) and its stage range: companions 0..14 (0 = bare ground), trees 1..14. */
export const PLANTS: Record<Plant2, {{ x: number; y: number; w: number; h: number; first: number; last: number }}> = {json.dumps(plants)}
/** The bamboo stand drawn right after `store` (R497G: its pole in front of the stORE crown); the pothos cords right before `pothos`. */
export const OVERLAYS = {json.dumps(overlays)} as const
/** The hit grid: CELL canvas px per cell; per plant per stage, row-major bits (MSB first) over its box, set where the layer is opaque. */
export const HIT_CELL = {CELL}
/** R533: fruit (mandarin) and flower (store) spots per stage, in the tree's box px; r = the sprite's radius (drawn 2r square). */
export const SPOTS: Record<'mandarin' | 'store', Record<number, {{ r: number; at: [number, number][] }}>> = {json.dumps(spots)}
export const HIT: Record<Plant2, Record<number, {{ cols: number; rows: number; bits: string }}>> = {json.dumps(masks)}
"""
open(os.path.join(APP, "src", "garden2", "layout.ts"), "w").write(lay)

lines = [head, "import type { Plant2 } from './layout'", "",
         "export const PLATE = require('../../assets/garden2/plate.png')",
         "export const OVERLAY_SRC = {",
         *[f"  {k}: require('../../assets/garden2/{v['file']}')," for k, v in overlays.items()], "} as const", "",
         "/** Every stage layer, indexed by plant then stage. */",
         "export const STAGE_SRC: Record<Plant2, Record<number, number>> = {"]
for p in L["draw_order"]:
    lines.append(f"  {p}: {{")
    for s in range(plants[p]["first"], plants[p]["last"] + 1):
        lines.append(f"    {s}: require('../../assets/garden2/{p}/stage{s:02d}.webp'),")
    lines.append("  },")
lines.append("}")
lines += ["", "/** R533: the trees' earnings sprites, one per tree (the ripe mandarin, the open ORE-gold flower). */",
          "export const FRUIT_SRC = {", *[f"  {t}: require('../../assets/garden2/{t}-fruit.png')," for t in SPRITES], "} as const"]
lines += ["", "/** R529 dark mode: the dark plate (null until one is exported) and any dark variants of overlays and stage layers. */",
          "export const PLATE_DARK: number | null = " + ("require('../../assets/garden2/plate-dark.png')" if HAS_DARK_PLATE else "null"),
          "export const OVERLAY_SRC_DARK: Partial<Record<'stand' | 'cords', number>> = {",
          *[f"  {k}: require('../../assets/garden2/{v}')," for k, v in dark_overlays.items()], "}",
          "export const STAGE_SRC_DARK: Partial<Record<Plant2, Record<number, number>>> = {"]
for p, ss in dark_stages.items():
    lines.append(f"  {p}: {{")
    for s in ss: lines.append(f"    {s}: require('../../assets/garden2/{p}/stage{s:02d}-dark.webp'),")
    lines.append("  },")
lines.append("}")
open(os.path.join(APP, "src", "garden2", "sources.ts"), "w").write("\n".join(lines) + "\n")
print("wrote", OUT, "and src/garden2/{layout,sources}.ts;", sum(len(m) for m in masks.values()), "stage layers")
