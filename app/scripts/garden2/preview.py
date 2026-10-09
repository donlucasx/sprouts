# Garden2 preview, step 2: composites the layer plans from plan.mjs (model/garden2.ts composeLayers + scaleRect, the same math
# Garden2.tsx draws with) out of the app's own bundled layers (assets/garden2/), no device needed. Per stage set: the light theme
# (full bleed on the page's paper, a 360 dp phone at 3x = 1080 px) and the dark theme (the paper card inside the 20 dp gutters, radius
# 16 dp), plus one contact sheet. Also checks the plan's boxes against the approved export's layout.json.
# Usage: python3 -I app/scripts/garden2/preview.py [out_dir]
import json, os, subprocess, sys
from PIL import Image, ImageDraw, ImageFont

APP = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
OUT = sys.argv[1] if len(sys.argv) > 1 else "/Users/lucasgarzoli/Documents/claude/seekerhackathon/previews/garden-app"
EXPORT = "/Users/lucasgarzoli/Documents/claude/seekerhackathon/brand/garden2/app-export/layout.json"
A = os.path.join(APP, "assets", "garden2")
DPR, PHONE, GUTTER, RADIUS = 3, 360, 20, 16
LIGHT_BG, DARK_BG = (255, 252, 246), (14, 26, 20)   # theme/tokens.ts background, light and dark
LW, DW = PHONE * DPR, (PHONE - 2 * GUTTER) * DPR
plan = json.loads(subprocess.run(["node", os.path.join(APP, "scripts/garden2/plan.mjs"), str(LW), str(DW)], capture_output=True, text=True, check=True).stdout)

if os.path.exists(EXPORT):   # the plan's boxes are the approved export's
    E = json.load(open(EXPORT))
    for l in plan["mature"]["layers"]:
        if l["kind"] == "plant":
            b = E["plants"][l["key"]]; assert (l["x"], l["y"], l["w"], l["h"]) == (b["x"], b["y"], b["w"], b["h"]), l
    print("plan boxes match", EXPORT)

def src(l):
    if l["kind"] == "plate": return os.path.join(A, "plate.png")
    if l["kind"] == "overlay": return os.path.join(A, f"{l['key']}.png")
    if l["kind"] == "fruit": return os.path.join(A, f"{l['key']}-fruit.png")
    return os.path.join(A, l["key"], f"stage{l['stage']:02d}.webp")

def render(scaled):
    W, H = round(scaled["layers"][0]["w"]), round(scaled["h"])   # layer 0 is the plate: the whole view
    c = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    for l in scaled["layers"]:
        x, y, w, h = l["x"], l["y"], l["w"], l["h"]
        im = Image.open(src(l)).convert("RGBA").resize((max(1, round(x + w) - round(x)), max(1, round(y + h) - round(y))), Image.LANCZOS)
        layer = Image.new("RGBA", c.size, (0, 0, 0, 0)); layer.paste(im, (round(x), round(y))); c = Image.alpha_composite(c, layer)   # clipped to the view, as overflow hidden
    return c

os.makedirs(OUT, exist_ok=True)
sheet = []
for name, d in plan.items():
    light = Image.new("RGBA", (LW, round(d["scaled"][str(LW)]["h"]) + 2 * 40 * DPR), LIGHT_BG + (255,))
    light.alpha_composite(render(d["scaled"][str(LW)]), (0, 40 * DPR))
    dark = Image.new("RGBA", light.size, DARK_BG + (255,))
    card = render(d["scaled"][str(DW)]); m = Image.new("L", card.size, 0)
    ImageDraw.Draw(m).rounded_rectangle([0, 0, card.width - 1, card.height - 1], radius=RADIUS * DPR, fill=255)
    dark.paste(card, (GUTTER * DPR, 40 * DPR), m)
    for theme, im in (("light", light), ("dark", dark)):
        f = os.path.join(OUT, f"garden2-{name}-{theme}.png"); im.convert("RGB").save(f); print(f)
    sheet.append((name, d["stages"], light, dark))

f = ImageFont.load_default(size=40)
pad, lab = 30, 70
SW, SH = 2 * LW + 3 * pad, len(sheet) * (sheet[0][2].height + lab) + pad
S = Image.new("RGB", (SW, SH), (240, 238, 232)); D = ImageDraw.Draw(S)
for i, (name, st, light, dark) in enumerate(sheet):
    y = pad + i * (light.height + lab)
    D.text((pad, y), f"{name}: " + "  ".join(f"{k} {v}" for k, v in st.items()), fill=(40, 40, 40), font=f)
    S.paste(light.convert("RGB"), (pad, y + lab - 10)); S.paste(dark.convert("RGB"), (2 * pad + LW, y + lab - 10))
f = os.path.join(OUT, "garden2-contact-sheet.jpg"); S.save(f, quality=88); print(f)
