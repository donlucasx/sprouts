import { CANVAS } from "@/garden2/layout";
import { WIDGET2_B64, WIDGET2_FRAME } from "@/garden2/widget-b64";
import { GARDEN_INK } from "@/theme/tokens";
import { composeLayers, FRAME_PAD, frameTop, paintedBox, paintedTop, STAKE, type Extras, type Layer, type Stages } from "./garden2";

/** Stakes draw only where their name comes out at least this many widget px tall (a 2x2's six boards would be specks). */
export const STAKE_MIN_FONT = 5;

/** The paper inside the bamboo frame: the plate's own paper, so the painting's sky runs on into it. */
export const WIDGET2_PAPER = "#FFFCF6";
const f = (n: number) => Number(n.toFixed(2));
const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const keyOf = (l: Layer): string | null =>
  l.kind === "plant" ? `${l.key}-${l.stage}` : l.kind === "plate" ? "plate" : l.kind === "overlay" ? l.key : l.kind === "stake" ? "stake" : l.kind === "decor" ? l.key : null;

/** The plate's foot (canvas y): clean raked sand down to here, its painted bottom edge below (measured on plate.png, 10-11). */
export const PLATE_FOOT = 832;
/** Canvas px kept either side of what is planted when the view crops in. */
export const SPAN_PAD = 40;
export type Box = { x: number; y: number; w: number; h: number };
type View = { x: number; y: number; w: number; h: number; s: number };

/** The view never crops in narrower than this many canvas px: a lone seedling stays a seedling in its bed, not a close-up. */
export const MIN_SPAN = 760;
/** The canvas x-range of what is planted (each plant's painted box, stage 1 up), SPAN_PAD either side, at least MIN_SPAN wide (widened
 *  about its centre, inside the plate); nothing planted, the whole plate. */
export function plantedSpan(stages: Stages): { x0: number; x1: number } {
  const boxes = (Object.keys(stages) as (keyof Stages)[]).flatMap((p) => (stages[p] >= 1 ? [paintedBox(p, stages[p])] : [])).filter((b) => b !== null);
  if (!boxes.length) return { x0: 0, x1: CANVAS.w };
  let x0 = Math.max(0, Math.min(...boxes.map((b) => b!.x0)) - SPAN_PAD), x1 = Math.min(CANVAS.w, Math.max(...boxes.map((b) => b!.x1)) + SPAN_PAD);
  if (x1 - x0 < MIN_SPAN) { const c = (x0 + x1) / 2; x0 = Math.max(0, Math.min(CANVAS.w - MIN_SPAN, c - MIN_SPAN / 2)); x1 = x0 + MIN_SPAN; }
  return { x0, x1 };
}

/** The view always holds the horizon and the stone lantern standing on it (its top, canvas y on plate.png), so a young garden's
 *  headline sits on sky, never on sand (his note 10-11: "we should have a horizon"). */
export const HORIZON_TOP = 345;
/** The canvas y the view's plants start from: the tallest planted plant's painted top (or the lantern's, if higher), less Home's FRAME_PAD; nothing planted, Home's
 *  frameTop. Not the bamboo stand, which frameTop also counts: the crop leaves it out (a young garden showed a band of sky, 10-11). */
export function plantedTop(stages: Stages): number {
  const tops = (Object.keys(stages) as (keyof Stages)[]).filter((p) => stages[p] >= 1).map((p) => paintedTop(p, stages[p]));
  return tops.length ? Math.max(0, Math.min(HORIZON_TOP, ...tops) - FRAME_PAD) : frameTop(stages);
}

/**
 * The view for a `width` by `height` opening whose garden box is `gb` (the room between the headline and the bottom line). His notes
 * 10-11: "a lot of sand under and above... we should have a horizon... should the garden be cropped in a bit to fill the space more?":
 * the painting fills the whole opening (its paper sky behind the headline, the plate's foot fading out behind the bottom line, as on
 * Home), scaled so what is planted, from its tallest plant down to the plate's foot (the stakes and the rocks there), fills the garden
 * box, never so large that what is planted is cropped across (the decor at the plate's sides may be). Across, what is planted is centred
 * in the box; an opening wider than the plate at that scale shows the frame's paper beside it (rather than a larger painting that would
 * reach the headline). Down, what is planted starts at the box's top, centred in it when the width is what binds.
 */
export function widget2View(stages: Stages, width: number, height: number, gb: Box): View {
  // 10-27 (his notes: the 2x1 "art too small, should be cropped in on the tree"; tall sizes "need garden art adjusted to fill the
  // widget"): the planted garden always fills the box's HEIGHT, cropped across about the SKR tree when the box is narrower than it (a
  // wide box is as before); a short box (under SHORT_BOX dp) frames the SKR tree alone, crown to mound
  const tree = stages.mandarin >= 1 ? paintedBox("mandarin", stages.mandarin) : null;
  if (tree && gb.h < SHORT_BOX) {
    const th = tree.y1 - tree.y0, s = gb.h / Math.max(1, th * (1 + 2 * ENSO_PAD));
    const w = width / s, h = height / s, cxT = (tree.x0 + tree.x1) / 2;
    return { x: Math.max(0, Math.min(CANVAS.w - w, cxT - (gb.x + gb.w / 2) / s)), y: tree.y0 - th * ENSO_PAD - gb.y / s, w, h, s };
  }
  const top = plantedTop(stages), span = plantedSpan(stages);
  // the garden ends at the box's foot: filling the width instead ran the art under the bottom line (10-27: "round-ups plant at..."
  // over the hSOL stake), so the height is what binds and a plate narrower than the opening is centred in it (below)
  const s = gb.h / Math.max(1, PLATE_FOOT - top);
  const w = width / s, h = height / s;
  const y = top - (gb.y + Math.max(0, (gb.h - (PLATE_FOOT - top) * s) / 2)) / s;
  // across: centred on what is planted when it all fits, else on the SKR tree (the crop keeps the tree in view)
  const fits = (span.x1 - span.x0) * s <= gb.w;
  const centred = (fits || !tree ? (span.x0 + span.x1) / 2 : (tree.x0 + tree.x1) / 2) - (gb.x + gb.w / 2) / s;
  // inside the plate; or, wider than it, the whole plate in view (paper beside it), as near centred as that allows
  // 10-27 (his note: the 3x2 "left uncentered w empty space to its right"): a stacked opening (the box across it) wider than the plate
  // centres the plate; the wide layout keeps it beside the words' column, as near centred in its box as that allows
  const stacked = gb.x < width * 0.15;
  const x = w <= CANVAS.w ? Math.max(0, Math.min(CANVAS.w - w, centred)) : stacked ? (CANVAS.w - w) / 2 : Math.max(CANVAS.w - w, Math.min(0, centred));
  return { x, y, w, h, s };
}

/**
 * The widget's painted garden (R591+, his ask 10-10: "update the widget to show the new garden"): one SVG string, `width` by `height` (the
 * frame's whole opening), of the app's layers as stills (the widget cannot play the sway loops), each image the app's own art shrunk by
 * WIDGET2_SCALE (widget-b64.ts) and declared once, in widget2View. Above the plate's top it is clear: the frame's paper, the plate's own sky.
 */
export function widgetGarden2(stages: Stages, extras: Extras, width: number, height: number, gb: Box): { svg: string; w: number; h: number } {
  return gardenSvg(stages, extras, width, height, widget2View(stages, width, height, gb));
}

/** Ensō (10-26 draft): the canvas px kept round the SKR tree in the ring's window, as a share of the tree's painted height. */
export const ENSO_PAD = 0.08;
/** A bamboo garden box shorter than this (dp) frames the SKR tree alone (the 2x1, 10-27). */
export const SHORT_BOX = 70;
/**
 * The ensō widget's window (his note 10-26: "lowered and centered so the circle crop is more focused around the growth of the SKR
 * tree"): a `size` square of the garden centred on the SKR tree's painted box (crown to mound), the paper sky behind it. No SKR tree
 * yet: the planted span, else the whole plate, centred the same way.
 */
export function ensoGarden(stages: Stages, extras: Extras, size: number, paper: string, whole = false): string {
  const span = plantedSpan(stages), top = plantedTop(stages);
  if (whole) {
    // the full ensō (mock F-E-full): the whole garden across the ring, sky above for the total and the plate low for the state line
    const side = span.x1 - span.x0, cx = (span.x0 + span.x1) / 2, cy = PLATE_FOOT - side * 0.29;
    return gardenSvg(stages, extras, size, size, { x: cx - side / 2, y: cy - side / 2, w: side, h: side, s: size / side }, paper, true).svg;
  }
  const tree = stages.mandarin >= 1 ? paintedBox("mandarin", stages.mandarin) : null;
  const box = tree ?? { x0: span.x0, x1: span.x1, y0: top, y1: PLATE_FOOT };
  const side = Math.max(box.x1 - box.x0, box.y1 - box.y0) * (1 + 2 * ENSO_PAD);
  const cx = (box.x0 + box.x1) / 2, cy = (box.y0 + box.y1) / 2;
  const v = { x: cx - side / 2, y: cy - side / 2, w: side, h: side, s: size / side };
  return gardenSvg(stages, extras, size, size, v, paper, true).svg;
}

/** `round`: the ensō's window clipped to its circle (10-27, his note: the pill showed "a square edge underneath the left end": the
 *  window's square corners reached past the pill's round end, where the sand card is transparent). */
function gardenSvg(stages: Stages, extras: Extras, width: number, height: number, v: View, paper: string | null = null, round = false): { svg: string; w: number; h: number } {
  const signs = STAKE.font * v.s >= STAKE_MIN_FONT;
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
  const ground = paper ? `<rect x="${f(v.x)}" y="${f(v.y)}" width="${f(v.w)}" height="${f(v.h)}" fill="${paper}"/>` : "";
  const clip = round ? `<clipPath id="r"><circle cx="${f(v.x + v.w / 2)}" cy="${f(v.y + v.h / 2)}" r="${f(Math.min(v.w, v.h) / 2)}"/></clipPath>` : "";
  const paint = round ? `<g clip-path="url(#r)">${ground}${body.join("")}</g>` : `${ground}${body.join("")}`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${width}" height="${height}" viewBox="${f(v.x)} ${f(v.y)} ${f(v.w)} ${f(v.h)}" preserveAspectRatio="none"><defs>${defs}${clip}</defs>${paint}</svg>`;
  return { svg, w: width, h: height };
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
 * knots and the crossed ends) at FRAME_K and its four runs stretched between them, over paper that fills the frame to its poles' centre
 * lines. Outside the poles the widget is clear: the crossed ends overhang onto the wallpaper.
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
  // paper to the poles' centre lines: the garden (widgetGarden2) is drawn over it, and its sky is this same paper
  const m = F.mid, x0 = m.l * k, y0 = m.t * k;
  const paper = `<rect x="${f(x0)}" y="${f(y0)}" width="${f(width - x0 - m.r * k)}" height="${f(height - y0 - m.b * k)}" fill="${WIDGET2_PAPER}"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${paper}${parts.join("")}</svg>`;
}
