import { CANVAS } from "@/garden2/layout";
import { WIDGET2_B64 } from "@/garden2/widget-b64";
import { GARDEN_INK } from "@/theme/tokens";
import { composeLayers, paintedBox, STAKE, type Extras, type Layer, type Stages } from "./garden2";

/** Canvas px of plate kept around the plants and stakes the widget shows. */
export const VIEW_PAD = 40;
/** The view is never narrower than this many canvas px (a lone seedling stays a seedling in its bed, not a close-up). */
export const MIN_VIEW_W = 560;
/** Stakes draw only where their name comes out at least this many widget px tall (a 2x2's six boards would be specks). */
export const STAKE_MIN_FONT = 6;

const f = (n: number) => Number(n.toFixed(2));
const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
type Rect = { x0: number; x1: number; y0: number; y1: number };
const keyOf = (l: Layer): string | null =>
  l.kind === "plant" ? `${l.key}-${l.stage}` : l.kind === "plate" ? "plate" : l.kind === "overlay" ? l.key : l.kind === "stake" ? "stake" : l.kind === "decor" ? l.key : null;

/**
 * The canvas box the widget shows: Garden2's own composition (model/garden2.ts composeLayers, the app's layers in the app's order),
 * cropped to what is planted (each plant's painted box, its stake and the basket) with VIEW_PAD of plate around it, at least
 * MIN_VIEW_W wide. Nothing planted: the whole plate's bed, as Home's frame shows it.
 */
export function widget2Need(stages: Stages, extras: Extras): Rect {
  const layers = composeLayers(stages, extras);
  let r: Rect | null = null;
  const add = (b: Rect) => (r = r ? { x0: Math.min(r.x0, b.x0), x1: Math.max(r.x1, b.x1), y0: Math.min(r.y0, b.y0), y1: Math.max(r.y1, b.y1) } : b);
  for (const l of layers) {
    if (l.kind === "plant" && l.stage >= 1) { const b = paintedBox(l.key, l.stage); if (b) add(b); }
    else if (l.kind === "stake" || l.kind === "decor") add({ x0: l.x, x1: l.x + l.w, y0: l.y, y1: l.y + l.h });
  }
  if (!r) return { x0: 0, x1: CANVAS.w, y0: CANVAS.h * 0.45, y1: CANVAS.h };
  const p: Rect = r;
  const out = { x0: Math.max(0, p.x0 - VIEW_PAD), x1: Math.min(CANVAS.w, p.x1 + VIEW_PAD), y0: Math.max(0, p.y0 - VIEW_PAD), y1: Math.min(CANVAS.h, p.y1 + VIEW_PAD) };
  const short = MIN_VIEW_W - (out.x1 - out.x0);
  if (short > 0) {
    const x0 = Math.max(0, Math.min(CANVAS.w - MIN_VIEW_W, out.x0 - short / 2));
    out.x0 = x0; out.x1 = x0 + MIN_VIEW_W;
  }
  return out;
}

/** A tall box zooms in, never narrower than the two trees with VIEW_PAD either side (they stay whole), nor this many canvas px. */
export const MIN_FILL_W = 320;
/** What the zoom centres on and keeps whole: the two trees (the garden's centre) where planted, else everything planted. */
function focus(stages: Stages, n: Rect): { cx: number; w: number } {
  const trees = (["mandarin", "store"] as const).map((t) => (stages[t] >= 1 ? paintedBox(t, stages[t]) : null)).filter((b): b is Rect => b !== null);
  if (!trees.length) return { cx: (n.x0 + n.x1) / 2, w: MIN_FILL_W };
  const x0 = Math.min(...trees.map((b) => b.x0)), x1 = Math.max(...trees.map((b) => b.x1));
  return { cx: (x0 + x1) / 2, w: Math.max(MIN_FILL_W, x1 - x0 + 2 * VIEW_PAD) };
}
type View = { x: number; y: number; w: number; h: number; px: number };
/**
 * The view and the garden's height (widget px) for a box `width` by `maxH`. His note 10-10 (both phones' widgets stand taller than
 * square: "the garden centered vertically leaves too much negative space above and underneath... zoom in and center on the trees"):
 * a box taller than the garden zooms in to fill its height, the view narrowed about the trees (kept whole); a box wider
 * than the garden widens the view across the plate. Either way the garden fills the box where the plate allows.
 */
export function widget2View(stages: Stages, extras: Extras, width: number, maxH: number): View {
  const n = widget2Need(stages, extras), vh = n.y1 - n.y0;
  let vw = n.x1 - n.x0, vx = n.x0;
  const fit = (vh * width) / Math.max(1, maxH);   // the view width at which the garden exactly fills the box
  const centre = (cx: number) => { vx = Math.max(0, Math.min(CANVAS.w - vw, cx - vw / 2)); };
  if (fit < vw) { const fo = focus(stages, n); vw = Math.min(vw, Math.max(fo.w, fit)); centre(fo.cx); }
  else if (fit > vw) { vw = Math.min(CANVAS.w, fit); centre((n.x0 + n.x1) / 2); }
  // still short of the box (the trees kept whole, or a young garden's low bed): more of the plate above, up to its top
  const tall = Math.min(n.y1, (vw * maxH) / width), y = Math.min(n.y0, n.y1 - tall);
  const h = Math.max(1, Math.min(maxH, Math.round((width * (n.y1 - y)) / vw)));
  return { x: vx, y, w: vw, h, px: width / vw };
}
/** The garden's height on a widget `width` wide with at most `maxH`. */
export const widget2Height = (stages: Stages, extras: Extras, width: number, maxH: number): number => widget2View(stages, extras, width, maxH).h;

/** Widget px over which the garden's own edges fade out onto the wallpaper (at most GARDEN_FEATHER_MAX of its smaller side). */
export const GARDEN_FEATHER = 30;
const GARDEN_FEATHER_MAX = 0.22;
/** Stops per faded edge: the opacity eases in (smoothstep), so the rim dissolves rather than ending in a grey band (a linear ramp did, on device). */
const FADE_STEPS = 6;
const fadeStops = (edge: number) => {
  const ease = (t: number) => t * t * (3 - 2 * t);
  const stop = (o: number, a: number) => `<stop offset="${f(o)}" stop-color="#fff"${a < 1 ? ` stop-opacity="${f(a)}"` : ""}/>`;
  const ramp = Array.from({ length: FADE_STEPS + 1 }, (_, i) => i / FADE_STEPS);
  return ramp.map((t) => stop(t * edge, ease(t))).join("") + ramp.reverse().map((t) => stop(1 - t * edge, ease(t))).join("");
};
/**
 * `inner` (drawn in the box x,y,w,h) faded to transparent over fx at its left and right and fy at its top and bottom: two masks, one per
 * axis, so the edges and corners fall off smoothly with no seams (each mask a single gradient-filled rect).
 */
function feathered(id: string, x: number, y: number, w: number, h: number, fx: number, fy: number, inner: string): string {
  const box = `x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${f(h)}"`;
  const defs = `<linearGradient id="${id}-gh" gradientUnits="userSpaceOnUse" x1="${f(x)}" y1="0" x2="${f(x + w)}" y2="0">${fadeStops(fx / w)}</linearGradient>`
    + `<linearGradient id="${id}-gv" gradientUnits="userSpaceOnUse" x1="0" y1="${f(y)}" x2="0" y2="${f(y + h)}">${fadeStops(fy / h)}</linearGradient>`
    + `<mask id="${id}-mh" maskUnits="userSpaceOnUse" ${box}><rect ${box} fill="url(#${id}-gh)"/></mask>`
    + `<mask id="${id}-mv" maskUnits="userSpaceOnUse" ${box}><rect ${box} fill="url(#${id}-gv)"/></mask>`;
  return `<defs>${defs}</defs><g mask="url(#${id}-mv)"><g mask="url(#${id}-mh)">${inner}</g></g>`;
}

/**
 * The widget's painted garden (R591+, his ask 10-10: "update the widget to show the new garden"): one SVG string, `width` wide and as
 * tall as it draws (at most `maxH`), of the app's layers as stills (the widget cannot play the sway loops), each image the app's own
 * art shrunk by WIDGET2_SCALE (widget-b64.ts) and declared once. A height-bound view widens across the plate to the widget's shape.
 */
export function widgetGarden2(stages: Stages, extras: Extras, width: number, maxH: number): { svg: string; h: number } {
  const v = widget2View(stages, extras, width, maxH), h = v.h, vx = v.x, vw = v.w, vh = (h * vw) / width;
  const signs = STAKE.font * (width / vw) >= STAKE_MIN_FONT;
  const layers = composeLayers(stages, extras).filter((l) => signs || l.kind !== "stake");
  const used = new Map<string, Layer>(), body: string[] = [];
  for (const l of layers) {
    const k = keyOf(l);
    if (!k || !WIDGET2_B64[k]) continue;
    if (!used.has(k)) used.set(k, l);
    body.push(`<use xlink:href="#w-${k}" x="${f(l.x)}" y="${f(l.y)}"/>`);
    if (l.kind === "stake") {
      const b = STAKE.board, cx = l.x + b.x + b.w / 2, cy = l.y + b.y + b.h * STAKE.drop + b.h / 2 + STAKE.font * 0.35;
      body.push(`<text x="${f(cx)}" y="${f(cy)}" text-anchor="middle" font-family="sans-serif" font-size="${STAKE.font}" font-weight="700" fill="${GARDEN_INK.sign}" opacity="${GARDEN_INK.signOpacity}">${esc(l.label)}</text>`);
    }
  }
  const defs = [...used].map(([k, l]) => `<image id="w-${k}" width="${l.w}" height="${l.h}" preserveAspectRatio="none" xlink:href="data:image/webp;base64,${WIDGET2_B64[k]}"/>`).join("");
  // the crop's hard edge (the plate cut mid-sand) fades out onto the wallpaper (10-10, the floating garden)
  const fe = Math.min(GARDEN_FEATHER, GARDEN_FEATHER_MAX * Math.min(width, h)) / v.px;
  const garden = feathered("g", vx, v.y, vw, vh, fe, fe, body.join(""));
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${width}" height="${h}" viewBox="${f(vx)} ${f(v.y)} ${f(vw)} ${f(vh)}" preserveAspectRatio="xMidYMax meet"><defs>${defs}</defs>${garden}</svg>`;
  return { svg, h };
}
