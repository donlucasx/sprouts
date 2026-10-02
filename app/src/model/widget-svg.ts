import type { Scene } from "./garden";
import { signX } from "./layout";
import { stemPaths, spriteTransform, soilPaths, leafPath } from "./paint";
import { COLORS } from "./species";
import { plantLayouts } from "./scene-to-layout";
import { SPRITE_META } from "@/garden/sprite-meta";
import { SPRITES_B64 } from "@/garden/sprites-b64";

export const WIDGET_SOIL_BAND = 30;
/** The soil band shrinks with a short garden (the small widget's is 60 px): a third of the height, at most 30. */
export const soilBand = (gardenH: number) => Math.min(WIDGET_SOIL_BAND, Math.round(gardenH / 3));
/** From the spike's ledger: `use` (defs plus use, the plan), `image` (a data image per placement), `path` (vector outlines, no sprites). */
export const WIDGET_MODE: "use" | "image" | "path" = "use";
const f = (n: number) => Number(n.toFixed(1));
/** The room left above the tallest drawn part. */
export const WIDGET_TOP_MARGIN = 6;
/** The front row's feet sit 0.73 of the band under the soil line, the back row's 0.23 (the app's 44 and 14 of a 60 band). */
const FOOT_IN_BAND = { front: 0.73, back: 0.23 } as const;
type Drawn = { top: number; step: number };
/** The plants this widget draws (the small one the front row only), each as its height above its foot (k = 1) and its foot's step above
 * the front row's feet. */
const drawnRows = (scene: Scene, band: number, wide: boolean): Drawn[] =>
  plantLayouts(scene).filter((p) => wide || p.row === "front").map((p) => ({ top: p.layout.top, step: (FOOT_IN_BAND.front - FOOT_IN_BAND[p.row]) * band }));
/** Room above the front row's feet in a garden `gardenH` tall, the margin kept. */
const roomAbove = (gardenH: number, band: number) => gardenH - band + FOOT_IN_BAND.front * band - WIDGET_TOP_MARGIN;
/** k: the largest scale, at most 1 (spec 5's cap), at which every drawn plant's top stays `WIDGET_TOP_MARGIN` under the garden's top
 * edge, measured from where the feet actually stand (R167, 10-02: the old rule measured from the soil line and floored the top at
 * 60 px, so a young garden drew small under a band of empty sky). */
export function widgetScale(scene: Scene, gardenH: number, wide: boolean): number {
  const band = soilBand(gardenH), room = roomAbove(gardenH, band);
  return Math.max(0, Math.min(1, ...drawnRows(scene, band, wide).filter((d) => d.top > 0).map((d) => (room - d.step) / d.top)));
}
/** R167: the garden's height on a widget whose host fixes `maxH`: the shortest height that draws the plants as large as `maxH` does
 * (so they are never smaller) with the signs inside it, never under the soil band plus 40; the rest goes back to the text lines. */
export function widgetGardenHeight(scene: Scene, maxH: number, wide: boolean): number {
  const best = widgetScale(scene, maxH, wide), floor = Math.min(maxH, WIDGET_SOIL_BAND + 40), signAy = SPRITE_META["sign"]?.ay ?? 14;
  for (let h = Math.ceil(floor); h < maxH; h++) {
    const band = soilBand(h), signRoom = !wide || roomAbove(h, band) >= (FOOT_IN_BAND.front - FOOT_IN_BAND.back) * band - 3 + 0.8 * signAy;
    if (signRoom && widgetScale(scene, h, wide) >= best - 1e-9) return h;
  }
  return maxH;
}
/** The garden as one SVG string for the widget: the sprites the scene uses declared once in <defs>, placed with <use>; stems as
 * paths; the wide widget shows both rows and the signs at a fixed 0.8; the small widget the front row only and no sign. */
export function widgetGardenSvg(scene: Scene, width: number, height: number, wide: boolean): string {
  const k = widgetScale(scene, height, wide), band = soilBand(height);
  const line = height - band, foot = (row: "front" | "back") => line + band * FOOT_IN_BAND[row];
  const used = new Set<string>(); const body: string[] = [];
  // one placement, three modes (the spike's ledger): a <use> of a sprite declared once; a data image per placement; a vector outline
  const placeStr = (name: string, x: number, y: number, rot: number, scale: number, xScale = scale): string => {
    const m = SPRITE_META[name]; if (!m || !SPRITES_B64[name]) return "";
    const t = spriteTransform(m, x, y, rot, scale, xScale);
    if (WIDGET_MODE === "use") { used.add(name); return `<use xlink:href="#s-${name}" transform="${t}"/>`; }
    if (WIDGET_MODE === "image") return `<image width="${m.w}" height="${m.h}" transform="${t}" xlink:href="data:image/png;base64,${SPRITES_B64[name]}"/>`;
    const L = m.h, W = m.w * 0.36; const plant = name.split("-")[1];   // path mode: the leaf outline in the part's green, every leaf-like the same shape
    const col = (COLORS as Record<string, { green: string }>)[plant]?.green ?? "#2E8B57";
    return `<g transform="translate(${f(x)} ${f(y)}) rotate(${f(rot)}) scale(${f(xScale)} ${f(scale)})"><path d="${leafPath(L, W, -1)}" fill="${col}" opacity=".52"/><path d="${leafPath(L, W, 1)}" fill="${col}" opacity=".52"/></g>`;
  };
  const place = (...a: Parameters<typeof placeStr>) => { body.push(placeStr(...a)); };
  if (WIDGET_MODE === "path") body.push(...soilPaths(width, line, band).map((q) => `<path d="${q.d}" fill="${q.fill}" opacity="${q.opacity}"${q.stroke ? ` stroke="${q.stroke}" stroke-width="${q.strokeWidth}"` : ""}/>`));
  else place("ground", 0, height - SPRITE_META["ground"].h * (band / 60), 0, band / 60, width / 320);   // RG28: the app's ground bake, its bottom on the widget's bottom, scaled from the app's 60 px band to this one
  const plants = plantLayouts(scene).filter((p) => wide || p.row === "front");
  const of = <K extends Scene["parts"][number]["kind"]>(kind: K) => scene.parts.filter((p): p is Extract<Scene["parts"][number], { kind: K }> => p.kind === kind);
  for (const r of of("ring")) { const pl = plants.find((p) => p.plant === r.plant); if (pl) body.push(`<g opacity="${f(1 - r.age)}">${placeStr("ring", pl.x * width, foot(pl.row) + 1, 0, k * (pl.row === "front" ? 1 : 2 / 3))}</g>`); }
  for (const s of of("seed")) { const sg = of("sign").find((q) => q.plant === s.plant); if (sg && (wide || sg.row === "front")) place("seed", sg.x * width + (s.index % 2 ? 1 : -1) * (3 + 2.4 * Math.floor(s.index / 2)) * k, foot(sg.row), ((s.index * 37) % 60) - 30, k); }   // on the small widget they sit at the plant's foot (no sign)
  for (const p of [...plants.filter((q) => q.row === "back"), ...plants.filter((q) => q.row === "front")]) {
    const fx = p.x * width, fy = foot(p.row);
    for (const q of [...p.layout.parts].sort((a, b) => a.z - b.z)) {
      if (q.kind === "stem") body.push(stemPaths(fx + q.x0 * k, fy + q.y0 * k, fx + q.x1 * k, fy + q.y1 * k, q.w0 * k, q.w1 * k, q.bend * k, q.color).map((s) => `<path d="${s.d}" fill="${s.fill}" opacity="${s.opacity}"/>`).join(""));
      else if (q.part === "swelling") body.push(`<circle cx="${f(fx + q.x * k)}" cy="${f(fy + q.y * k)}" r="${f(q.scale * k)}" fill="${COLORS[p.plant].light}" opacity="${f(0.4 + 0.35 * Math.min(1, (q.scale - 2.2) / 2.4))}"/>`);   // the app's formula
      else if (q.part === "dot") body.push(`<circle cx="${f(fx + q.x * k)}" cy="${f(fy + q.y * k)}" r="${f(q.scale * k)}" fill="${COLORS.ore.token}" opacity=".95"/>`);
      else place(q.name, fx + q.x * k, fy + q.y * k, q.rot, q.scale * k, (q.xScale ?? q.scale) * k);
    }
  }
  if (wide) for (const s of of("sign")) place(`sign-${s.plant}`, signX(s.x * width, s.side, width, 0.8), foot(s.row) + 3, 0, 0.8);
  const defs = [...used].map((n) => `<image id="s-${n}" width="${SPRITE_META[n].w}" height="${SPRITE_META[n].h}" xlink:href="data:image/png;base64,${SPRITES_B64[n]}"/>`).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><defs>${defs}</defs>${body.join("")}</svg>`;
}
