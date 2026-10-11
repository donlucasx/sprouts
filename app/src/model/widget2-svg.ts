import { CANVAS } from "@/garden2/layout";
import { WIDGET2_B64, WIDGET2_FRAME, WIDGET2_SAND } from "@/garden2/widget-b64";
import { GARDEN_INK } from "@/theme/tokens";
import { composeLayers, frameTop, STAKE, type Extras, type Layer, type Stages } from "./garden2";

/** Stakes draw only where their name comes out at least this many widget px tall (a 2x2's six boards would be specks). */
export const STAKE_MIN_FONT = 6;

const f = (n: number) => Number(n.toFixed(2));
const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const keyOf = (l: Layer): string | null =>
  l.kind === "plant" ? `${l.key}-${l.stage}` : l.kind === "plate" ? "plate" : l.kind === "overlay" ? l.key : l.kind === "stake" ? "stake" : l.kind === "decor" ? l.key : null;

/**
 * The canvas box the widget shows: Home's own view (Garden2.tsx), the plate's full width (the lantern, the stand, the basin and the rake
 * all in) from just above the tallest thing drawn (frameTop) to the plate's foot. His note 10-11: "Match the garden art and all the
 * decor so it looks the same on the widget and the app" (it replaced 10-10's zoom on the trees).
 */
export function widget2Box(stages: Stages): { x: number; y: number; w: number; h: number } {
  const y = frameTop(stages);
  return { x: 0, y, w: CANVAS.w, h: CANVAS.h - y };
}

/**
 * The widget's painted garden (R591+, his ask 10-10: "update the widget to show the new garden"): one SVG string of the app's layers as
 * stills (the widget cannot play the sway loops), each image the app's own art shrunk by WIDGET2_SCALE (widget-b64.ts) and declared once,
 * Home's view (widget2Box) fitted inside `width` by `maxH`. The plate's paper is cleared (widget.py), so its sky and foot show the frame's
 * raked sand (widgetFrame) behind: the garden sits in sand, edge to edge, with no fade on anything drawn (10-11: the fades read
 * "airbrushed").
 */
export function widgetGarden2(stages: Stages, extras: Extras, width: number, maxH: number): { svg: string; w: number; h: number } {
  const v = widget2Box(stages), s = Math.min(width / v.w, maxH / v.h);
  const w = Math.max(1, Math.round(v.w * s)), h = Math.max(1, Math.round(v.h * s));
  const signs = STAKE.font * s >= STAKE_MIN_FONT;
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
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${w}" height="${h}" viewBox="${v.x} ${f(v.y)} ${v.w} ${f(v.h)}" preserveAspectRatio="xMidYMax meet"><defs>${defs}</defs>${body.join("")}</svg>`;
  return { svg, w, h };
}

/** The bamboo frame's size: widget dp per px of the painting (its poles about 40 px thick, so about 5 dp), thinner on a small widget so
 *  a 110 dp one keeps room for its garden: min side / FRAME_DIV, between FRAME_K_MIN and FRAME_K. */
export const FRAME_K = 0.125;
const FRAME_K_MIN = 0.05, FRAME_DIV = 1800;
export const frameK = (width: number, height: number) => Math.max(FRAME_K_MIN, Math.min(FRAME_K, Math.min(width, height) / FRAME_DIV));
/** dp between the poles and the widget's text and garden (half on a widget under 140 dp, as widget-layout's padFor). */
export const FRAME_GAP = 4;
export const frameGap = (width: number) => (width < 140 ? FRAME_GAP / 2 : FRAME_GAP);
export type FrameInner = { l: number; t: number; r: number; b: number; w: number; h: number };
/** The frame's opening on a `width` by `height` widget: each pole's inner edge in from the widget's edge, and the box between them. */
export function frameInner(width: number, height: number): FrameInner {
  const i = WIDGET2_FRAME.inner, k = frameK(width, height);
  const l = Math.round(i.l * k), t = Math.round(i.t * k), r = Math.round(i.r * k), b = Math.round(i.b * k);
  return { l, t, r, b, w: Math.max(1, width - l - r), h: Math.max(1, height - t - b) };
}
/**
 * The widget's bamboo frame (his ask 10-10: "the widget itself has transparent edges, its a bit smaller than the widget area, and its
 * contained by a bamboo frame in the same style of the artwork"): the painting cut in nine (scripts/garden2/widget.py), its corners (the
 * knots and the crossed ends) at FRAME_K and its four runs stretched between them, over raked sand that fills the frame to its poles'
 * centre lines. Outside the poles the widget is clear: the crossed ends overhang onto the wallpaper.
 */
export function widgetFrame(width: number, height: number): string {
  const F = WIDGET2_FRAME, k = frameK(width, height);
  const xs = { l: [0, F.cut.l * k], c: [F.cut.l * k, width - F.cut.r * k], r: [width - F.cut.r * k, width] } as const;
  const ys = { t: [0, F.cut.t * k], c: [F.cut.t * k, height - F.cut.b * k], b: [height - F.cut.b * k, height] } as const;
  const parts: string[] = [];
  for (const [yk, [y0, y1]] of Object.entries(ys)) for (const [xk, [x0, x1]] of Object.entries(xs)) {
    const key = `frame-${yk}${xk}`;
    if (!WIDGET2_B64[key]) continue;
    parts.push(`<image x="${f(x0)}" y="${f(y0)}" width="${f(x1 - x0)}" height="${f(y1 - y0)}" preserveAspectRatio="none" xlink:href="data:image/webp;base64,${WIDGET2_B64[key]}"/>`);
  }
  // 10-11 (his note: "lets fill the area with raked zen sand"): the frame holds raked sand to its poles' centre lines, the plate's own
  // straight raking (WIDGET2_SAND, a band mirror-stacked so rows run on), as wide as the opening and at the garden's scale, row on row
  const m = F.mid, x0 = m.l * k, y0 = m.t * k, sw = width - x0 - m.r * k, sh = height - y0 - m.b * k;
  const th = (WIDGET2_SAND.h * sw) / CANVAS.w, rows: string[] = [];
  for (let y = y0; y < y0 + sh; y += th) rows.push(`<use xlink:href="#sand" x="${f(x0)}" y="${f(y)}"/>`);
  const sand = `<defs><clipPath id="in"><rect x="${f(x0)}" y="${f(y0)}" width="${f(sw)}" height="${f(sh)}"/></clipPath>`
    + `<image id="sand" width="${f(sw)}" height="${f(th)}" preserveAspectRatio="none" xlink:href="data:image/webp;base64,${WIDGET2_B64.sand}"/></defs>`
    + `<g clip-path="url(#in)">${rows.join("")}</g>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${sand}${parts.join("")}</svg>`;
}
