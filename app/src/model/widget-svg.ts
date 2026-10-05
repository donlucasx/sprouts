import type { Scene } from "./garden";
import { CANVAS, FOOT_Y, LEND_SIGN, PLANT_SCALE, SIGN_TEXT, frameFor, stakeSides, signPlacement, windSpan } from "./layout";
import { stemPaths, spriteTransform } from "./paint";
import { COLORS, SOIL } from "./species";
import { GROUND, SOIL_CLIP_ID, frameGround, soilClipPath } from "./soil-clip";
import { plantLayouts } from "./scene-to-layout";
import { packScene, SPREAD } from "./spread";
import { SPRITE_META } from "@/garden/sprite-meta";
import { SPRITES_B64 } from "@/garden/sprites-b64";

const f = (n: number) => Number(n.toFixed(2));
/** API text goes into XML here (contracts 7.2's line two): escaped. */
const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
/** R252 (10-04, his photo: "is this what the widget is supposed to look like rn?"): the widget draws the app's own garden: the same
 * packing (R234), frame (RG30), deep ground spanning the frame (R231, R238), both rows, the stakes in front of their plants (R226), in
 * the app's canvas units at the 320 reference width, shown through an SVG viewBox. The view is the app's frame, widened or heightened
 * (sky above, the bed's bottom kept) to the widget's own shape. */
export const WIDGET_REF = SPREAD.ref;
/** Stakes are drawn only when they come out at least this many widget px per canvas px (a narrow widget's six boards would be specks). */
export const WIDGET_SIGN_MIN_PX = 0.75;
/** R252: a narrow widget (no stakes, no wind) draws its plants this much over the app's 1.25x, so a six-coin garden reads at that width. */
export const WIDGET_BOOST = 1.4;

export type WidgetView = { scene: Scene; x: number; y: number; w: number; h: number; zoom: number; px: number; signs: boolean };
/** The packed scene and the canvas box the widget shows, for a garden `width` by `height` widget px: `px` widget px per canvas px. */
export function widgetView(scene: Scene, width: number, height: number): WidgetView {
  const full = viewOf(scene, width, height, SPREAD.take);
  if (full.px >= WIDGET_SIGN_MIN_PX) return { ...full, signs: true };
  // too narrow for legible stakes: drawn without them, so the garden packs fully (R234's whole packing) around the plants alone
  const bare: Scene = { ...scene, parts: scene.parts.filter((q) => q.kind !== "sign") };
  return { ...tightView(bare, width, height), signs: false };
}
/** R253 (10-04, "make sure theres not a lot of negative space in the widget- zoom in the garden"): a narrow widget's view hugs its plants
 * (TIGHT_INSET of the view either side of their reach, the flat-topped mound full there, R243) and is as short as the plants and the bed
 * need, so on a tall widget the garden zooms in to fill the height and only what is left over is paper. */
const TIGHT_INSET = 0.06, TIGHT_TOP = 8;
function tightView(scene: Scene, width: number, height: number): Omit<WidgetView, "signs"> {
  const packed = packScene(scene, WIDGET_REF, 1), L = plantLayouts(packed), fr = frameFor(packed, L, WIDGET_REF);
  if (L.length === 0) return { ...viewOf(scene, width, height, 1) };
  const span = windSpan(L, WIDGET_REF), hNeed = needH(L, PLANT_SCALE * WIDGET_BOOST), minW = (span.hi - span.lo) / (1 - 2 * TIGHT_INSET);
  const w = Math.max(minW, hNeed * (width / Math.max(1, height))), h = Math.max(hNeed, w / (width / Math.max(1, height)));
  return { scene: packed, x: (span.lo + span.hi) / 2 - w / 2, y: CANVAS.height - h, w, h, zoom: fr.zoom, px: width / w };
}
function viewOf(scene: Scene, width: number, height: number, take: number): Omit<WidgetView, "signs"> {
  const packed = packScene(scene, WIDGET_REF, take), L = plantLayouts(packed), fr = frameFor(packed, L, WIDGET_REF);
  // R253: the widget has no room to grow into: the view is as tall as the plants and the bed, not the app's headroom
  const hNeed = needH(L, PLANT_SCALE), ar = width / Math.max(1, height);
  const w = Math.max(fr.w, hNeed * ar), h = Math.max(hNeed, w / ar);
  return { scene: packed, x: fr.x + fr.w / 2 - w / 2, y: CANVAS.height - h, w, h, zoom: fr.zoom, px: width / w };
}
/** The canvas height the plants (drawn at `k`) and the ground need, from the bed's bottom up, TIGHT_TOP above the tallest. */
function needH(L: ReturnType<typeof plantLayouts>, k: number): number {
  const ground = CANVAS.height - (SPRITE_META["ground"]?.h ?? 86) * GROUND.sy;
  const top = L.length ? Math.min(...L.map((p) => FOOT_Y(p.row) - p.layout.top * k)) - TIGHT_TOP : ground;
  return CANVAS.height - Math.min(top, ground);
}
/** The garden's height on a widget `width` wide with at most `maxH` for it: the view's own height at that width. */
export function widgetGardenHeight(scene: Scene, width: number, maxH: number): number {
  const v = widgetView(scene, width, maxH);
  return Math.min(maxH, Math.round(v.h * v.px));
}

/** The garden as one SVG string: the sprites the scene uses declared once in <defs> (1x PNGs) and placed with <use>; stems as paths. */
export function widgetGardenSvg(scene0: Scene, width: number, height: number): string {
  const v = widgetView(scene0, width, height), scene = v.scene, W = WIDGET_REF;
  const ground = frameGround(W, { x: v.x, w: v.w });
  const used = new Set<string>(); const body: string[] = [];
  const placeStr = (name: string, x: number, y: number, rot: number, scale: number, xScale = scale): string => {
    const m = SPRITE_META[name]; if (!m || !SPRITES_B64[name]) return "";
    used.add(name); return `<use xlink:href="#s-${name}" transform="${spriteTransform(m, x, y, rot, scale, xScale)}"/>`;
  };
  const place = (...a: Parameters<typeof placeStr>) => { body.push(placeStr(...a)); };
  const of = <K extends Scene["parts"][number]["kind"]>(kind: K) => scene.parts.filter((p): p is Extract<Scene["parts"][number], { kind: K }> => p.kind === kind);
  const plants = plantLayouts(scene);
  const footOf = (plant: string) => { const p = plants.find((q) => q.plant === plant) ?? of("sign").find((q) => q.plant === plant); return p ? { x: p.x * W, y: FOOT_Y(p.row) } : null; };
  place("ground", ground.x0, ground.y0, 0, ground.sy, ground.sx);
  // R176 (no soil, no water): the rings in a group clipped to the soil's outline, placed as the ground is
  const clip = `<clipPath id="${SOIL_CLIP_ID}"><path d="${soilClipPath(ground.x0, ground.y0, ground.sx, ground.sy)}"/></clipPath>`;
  let rings = false;
  for (const r of of("ring")) { const ft = footOf(r.plant); if (ft) { rings = true; body.push(`<g clip-path="url(#${SOIL_CLIP_ID})"><g opacity="${f(1 - r.age)}">${placeStr("ring", ft.x, ft.y + 2, 0, r.plant === "skr" || r.plant === "ore" ? CANVAS.frontScale : 2 / 3)}</g></g>`); } }
  for (const s of of("seed")) { const ft = footOf(s.plant); if (ft) place("seed", ft.x + (s.index % 2 ? 1 : -1) * (3 + 2.4 * Math.floor(s.index / 2)), ft.y + 1 - 1.2 * (s.index % 3), ((s.index * 37) % 60) - 30, 1); }
  const signs = v.signs, sides = stakeSides(scene, W, v.zoom);
  for (const row of ["back", "front"] as const) {
    for (const p of plants.filter((q) => q.row === row)) {
      const fx = p.x * W, fy = FOOT_Y(p.row), k = PLANT_SCALE * (v.signs ? 1 : WIDGET_BOOST);   // R187: the app's 1.25x about the foot; R252: a narrow widget more
      for (const q of [...p.layout.parts].sort((a, b) => a.z - b.z)) {
        if (q.kind === "stem") body.push(stemPaths(fx + q.x0 * k, fy + q.y0 * k, fx + q.x1 * k, fy + q.y1 * k, q.w0 * k, q.w1 * k, q.bend * k, q.color).map((s) => `<path d="${s.d}" fill="${s.fill}" opacity="${s.opacity}"/>`).join(""));
        else if (q.part === "swelling") body.push(`<circle cx="${f(fx + q.x * k)}" cy="${f(fy + q.y * k)}" r="${f(q.scale * k)}" fill="${COLORS[p.plant].light}" opacity="${f(0.4 + 0.35 * Math.min(1, (q.scale - 2.2) / 2.4))}"/>`);   // the app's formula
        else if (q.part === "dot") body.push(`<circle cx="${f(fx + q.x * k)}" cy="${f(fy + q.y * k)}" r="${f(q.scale * k)}" fill="${COLORS.ore.token}" opacity=".95"/>`);
        else place(q.name, fx + q.x * k, fy + q.y * k, q.rot, q.scale * k, (q.xScale ?? q.scale) * k);
      }
    }
    // R226: the row's stakes in front of its plants; R168: the one blank board and the word as vector text (AndroidSVG cannot load the
    // app's font: a plain sans-serif, same ink and place)
    if (signs) for (const s of of("sign").filter((q) => q.row === row)) {
      const at = signPlacement(s, W, v.zoom, ground, sides);
      place("sign", at.x, at.y, 0, at.scale, at.scale * at.boardX);
      const words: [number, number, string][] = s.lines.line2
        ? [[LEND_SIGN.y1, LEND_SIGN.size1, s.lines.line1], [LEND_SIGN.y2, LEND_SIGN.size2, s.lines.line2]]
        : [[SIGN_TEXT.y, SIGN_TEXT.size, s.lines.line1]];
      body.push(`<g transform="translate(${f(at.x)} ${f(at.y)}) scale(${f(at.scale)}) rotate(${SIGN_TEXT.rot})">${words.map(([y, size, t]) => `<text x="0" y="${y}" text-anchor="middle" font-family="sans-serif" font-size="${size}" font-weight="500" fill="${SOIL.ink}">${esc(t)}</text>`).join("")}</g>`);
    }
  }
  const defs = [...used].map((n) => `<image id="s-${n}" width="${SPRITE_META[n].w}" height="${SPRITE_META[n].h}" xlink:href="data:image/png;base64,${SPRITES_B64[n]}"/>`).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${width}" height="${height}" viewBox="${f(v.x)} ${f(v.y)} ${f(v.w)} ${f(v.h)}" preserveAspectRatio="xMidYMax meet"><defs>${defs}${rings ? clip : ""}</defs>${body.join("")}</svg>`;
}
