# The widget's Garden2 art: every layer the app composes (the plate, each plant's stage stills, the stand, the cords, the stake and the
# basket), shrunk by SCALE and inlined as base64 WebP in src/garden2/widget-b64.ts. The home-screen widget draws one SVG with no React
# and no asset loader, so its images ride in the string (as the old garden's sprites-b64.ts did). Fruit is left out (R584: none in v1).
# Run after export.py (it reads the app's own assets/garden2/): python3 -I app/scripts/garden2/widget.py
import base64, glob, io, json, os, re
from PIL import Image

APP = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
G2 = os.path.join(APP, "assets", "garden2")
OUT = os.path.join(APP, "src", "garden2", "widget-b64.ts")
SCALE = 0.4   # a 4x2 widget's garden is ~900 device px across the plants' ~1000 canvas px; 0.4 keeps the module near 900 KB
QUALITY = 78

# The widget draws the garden on the frame's raked sand (10-11): every layer's paper (#FFFCF6) turns transparent, the sand and the
# painting stay. Alpha eases in with each pixel's distance from paper (summed over R, G, B).
PAPER = (255, 252, 246)
CLEAR_BELOW, SOLID_FROM = 6, 34
# The plate's horizon (canvas y). Above it the plate is sky, plus the lantern and the stand: there anything near paper or light sand goes
# (a pale sand-coloured patch behind the stand drew a box on the widget's sand, 10-11), only the painted objects stay.
HORIZON_Y = 400
SKY_CLEAR_BELOW, SKY_SOLID_FROM = 40, 90
HORIZON_FADE = 70
# a pixel this close to paper (summed R, G, B) is sand; further off it is the painting (the lantern's stone, the bamboo)
SAND_MAX_D = 70

def unpaper(im, horizon=False):
    im = im.convert("RGBA")
    px = im.load()
    for y in range(im.height):
        lo, hi = (SKY_CLEAR_BELOW, SKY_SOLID_FROM) if horizon and y < HORIZON_Y else (CLEAR_BELOW, SOLID_FROM)
        for x in range(im.width):
            r, g, b, a = px[x, y]
            d = abs(r - PAPER[0]) + abs(g - PAPER[1]) + abs(b - PAPER[2])
            t = min(1, max(0, (d - lo) / (hi - lo)))
            px[x, y] = (r, g, b, round(a * t * t * (3 - 2 * t)))
    # the plate only: the horizon eases in over HORIZON_FADE px in every column (from the first opaque pixel at the horizon, whatever stands
    # above it), so the bed runs into the frame's sand behind it; only sand-coloured pixels fade, so the lantern and the stand that
    # cross the horizon keep their paint (a faded lantern read "airbrushed", 10-11)
    for x in range(im.width if horizon else 0):
        top = next((y for y in range(HORIZON_Y - 6, im.height) if px[x, y][3] > 128), None)
        if top is None: continue
        for y in range(max(0, top - 4), min(im.height, top + HORIZON_FADE)):
            r, g, b, a = px[x, y]
            if abs(r - PAPER[0]) + abs(g - PAPER[1]) + abs(b - PAPER[2]) > SAND_MAX_D: continue
            t = max(0, y - top + 4) / (HORIZON_FADE + 4)
            px[x, y] = (r, g, b, round(a * t * t * (3 - 2 * t)))
    return im

def clean(im):
    """Fully transparent pixels to transparent black: their stored white bled into the resize and, through WebP's lossy alpha, drew a
    pale box around a layer on the widget's sand (the hanging pot, 10-11)."""
    if im.mode != "RGBA": return im
    px = im.load()
    for y in range(im.height):
        for x in range(im.width):
            if px[x, y][3] == 0: px[x, y] = (0, 0, 0, 0)
    return im

def b64(path, clear_paper=False, horizon=False):
    im = Image.open(path)
    im = clean(unpaper(im, horizon) if clear_paper else im.convert("RGBA" if im.mode in ("RGBA", "LA", "P") or "A" in im.getbands() else "RGB"))
    im = im.resize((max(1, round(im.width * SCALE)), max(1, round(im.height * SCALE))), Image.LANCZOS)
    buf = io.BytesIO()
    im.save(buf, "WEBP", quality=QUALITY, alpha_quality=100, method=6)
    return base64.b64encode(buf.getvalue()).decode()

entries = {"plate": b64(os.path.join(G2, "plate.png"), clear_paper=True, horizon=True)}
# every layer's paper is cleared, not only the plate's: on the widget's sand a layer's paper fringe shows as a pale box (the cords, 10-11)
for key, name in (("stand", "stand.png"), ("cords", "cords.png"), ("stake", "decor-stake.png"), ("basket", "decor-basket.png")):
    entries[key] = b64(os.path.join(G2, name), clear_paper=True)
for path in sorted(glob.glob(os.path.join(G2, "*", "stage[0-9][0-9].webp"))):
    plant = os.path.basename(os.path.dirname(path))
    if plant in ("loops", "growth"): continue
    entries[f"{plant}-{int(re.search(r'stage(\d+)', path).group(1))}"] = b64(path, clear_paper=True)

# The widget's bamboo frame (his ask 10-10: "contained by a bamboo frame in the same style of the artwork"): Midjourney job d987af3c #2
# (--sref of the garden), white keyed out, cropped to the frame, cut into nine (the centre is empty): the corners (knot + crossed ends)
# keep their shape, the four straight runs stretch to the widget's size. Geometry in crop px, written beside the images.
FRAME_CROP = (100, 92, 928, 926)            # x0, y0, x1, y1 in the 1024 painting
FRAME_CUT = {"l": 170, "r": 168, "t": 178, "b": 166}     # corner sizes from each crop edge
FRAME_INNER = {"l": 126, "r": 127, "t": 143, "b": 130}   # each pole's inner edge from its crop edge
FRAME_MID = {"l": 103, "r": 106, "t": 123, "b": 109}     # each pole's centre line from its crop edge
FRAME_SCALE = 0.5
BG = (252, 253, 252)

def key_white(im):
    im = im.convert("RGBA"); px = im.load()
    for y in range(im.height):
        for x in range(im.width):
            r, g, b, a = px[x, y]
            d = abs(r - BG[0]) + abs(g - BG[1]) + abs(b - BG[2])
            t = min(1, max(0, (d - 14) / 40))
            px[x, y] = (r, g, b, round(255 * t * t * (3 - 2 * t)))
    return im

frame = clean(key_white(Image.open(os.path.join(G2, "widget", "bamboo-frame.png")).crop(FRAME_CROP)))
FW, FH = frame.size
xs = {"l": (0, FRAME_CUT["l"]), "c": (FRAME_CUT["l"], FW - FRAME_CUT["r"]), "r": (FW - FRAME_CUT["r"], FW)}
ys = {"t": (0, FRAME_CUT["t"]), "c": (FRAME_CUT["t"], FH - FRAME_CUT["b"]), "b": (FH - FRAME_CUT["b"], FH)}
def webp(im):
    im = im.resize((max(1, round(im.width * FRAME_SCALE)), max(1, round(im.height * FRAME_SCALE))), Image.LANCZOS)
    buf = io.BytesIO(); im.save(buf, "WEBP", quality=QUALITY, alpha_quality=100, method=6)
    return base64.b64encode(buf.getvalue()).decode()
for yk, (y0, y1) in ys.items():
    for xk, (x0, x1) in xs.items():
        if xk == "c" and yk == "c": continue
        entries[f"frame-{yk}{xk}"] = webp(frame.crop((x0, y0, x1, y1)))

# The frame's raked sand (his note 10-11: "fill the area with raked zen sand"): the plate's straight raking just under the horizon (no
# objects there), mirror-stacked four deep so its rows run on across the seams; the widget repeats it down the frame's opening.
SAND_BAND = (200, 412, 1250, 500)
band = Image.open(os.path.join(G2, "plate.png")).convert("RGB").crop(SAND_BAND)
# as wide as the canvas at the canvas' own scale (mirrored sideways, never stretched: stretched rows read as streaks, seen 10-11)
wide = Image.new("RGB", (band.width * 2, band.height)); wide.paste(band, (0, 0)); wide.paste(band.transpose(Image.FLIP_LEFT_RIGHT), (band.width, 0))
band = wide.crop((0, 0, 1518, band.height))
flip = band.transpose(Image.FLIP_TOP_BOTTOM)
sand = Image.new("RGB", (band.width, band.height * 4))
for i, b in enumerate((band, flip, band, flip)): sand.paste(b, (0, i * band.height))
buf = io.BytesIO(); sand.resize((round(sand.width * SCALE), round(sand.height * SCALE)), Image.LANCZOS).save(buf, "WEBP", quality=QUALITY, method=6)
entries["sand"] = base64.b64encode(buf.getvalue()).decode()

with open(OUT, "w") as f:
    f.write("// GENERATED by scripts/garden2/widget.py from assets/garden2 (each layer at SCALE, WebP). Do not edit by hand.\n\n")
    f.write(f"/** Widget px per canvas px the art was shrunk to: an image is declared at its canvas size and drawn there. */\nexport const WIDGET2_SCALE = {SCALE}\n\n")
    f.write("/** Keys: plate, stand, cords, stake, basket, and `<plant>-<stage>` for every stage still. */\n")
    f.write(f"/** The bamboo frame's nine-slice geometry, in crop px (scripts/garden2/widget.py): crop size, corner cuts, pole inner edges and centre lines. */\n")
    f.write(f"export const WIDGET2_FRAME = {{ w: {FW}, h: {FH}, cut: {json.dumps(FRAME_CUT)}, inner: {json.dumps(FRAME_INNER)}, mid: {json.dumps(FRAME_MID)} }} as const\n\n")
    f.write(f"/** The raked sand tile's size in canvas px (the plate's band, mirror-stacked; widget.py SAND_BAND). */\nexport const WIDGET2_SAND = {{ w: {sand.width}, h: {sand.height} }} as const\n\n")
    f.write("export const WIDGET2_B64: Record<string, string> = {\n")
    for k, v in entries.items(): f.write(f'  "{k}": "{v}",\n')
    f.write("}\n")
print(len(entries), "images,", round(os.path.getsize(OUT) / 1024), "KB ->", os.path.relpath(OUT, APP))
