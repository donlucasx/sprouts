import type { Scene } from "./garden";
import { soilSurface } from "./soil";

/** The widget's soil band: the app's mound at half scale (edges 20 below the soil line, crown 10), 30 high. */
export const WIDGET_SOIL_BAND = 30;

/**
 * The garden as an SVG string for the widget, filling `width` x `height`: soil, one stroke per sprout (buds as dots), a dot per seed,
 * one circle per fruit. Same scene as the app, fewer pixels; every ground part stands on the mound's surface.
 */
export function widgetGardenSvg(scene: Scene, width: number, height: number): string {
  const line = height - WIDGET_SOIL_BAND;
  const surface = (t: number) => line + soilSurface(t) / 2;
  const scale = Math.max(1, (height - WIDGET_SOIL_BAND) / 60);  // plants grow into a taller widget
  const f = (n: number) => Number(n.toFixed(1));

  const seeds = scene.parts.flatMap((p) => p.kind === "seed"
    ? [`<circle cx="${f(p.x * width)}" cy="${f(surface(p.x) + 2.5)}" r="2" fill="#2B2B2B" opacity="0.7"/>`] : []);
  const stems = scene.parts.flatMap((p) => {
    if (p.kind !== "sprout") return [];
    const x = f(p.x * width), base = f(surface(p.x));
    if (p.bud) return [`<circle cx="${x}" cy="${f(base - 3)}" r="3" fill="#3F7A4A" opacity="0.6"/>`];
    const h = f((10 + p.stage * 12) * scale);
    return [`<path d="M${x} ${base} q 2 ${f(-h / 2)} 0 ${-h}" stroke="#3F7A4A" stroke-width="2" fill="none"/>`];
  });
  // Fruit hang near the tip of the sprout the scene names (ORE pups have none and are left to the app's garden).
  const tips = new Map(scene.parts.flatMap((p) => p.kind === "sprout" && !p.bud ? [[p.id, { x: p.x * width, y: surface(p.x) - (10 + p.stage * 12) * scale }] as const] : []));
  const perHost = new Map<string, number>();
  const fruits = scene.parts.flatMap((p) => {
    if (p.kind !== "fruit" || p.on === null || !tips.has(p.on)) return [];
    const k = perHost.get(p.on) ?? 0;
    perHost.set(p.on, k + 1);
    const t = tips.get(p.on)!;
    return [`<circle cx="${f(t.x + ((k % 3) - 1) * 6)}" cy="${f(t.y + 6 + Math.floor(k / 3) * 7)}" r="3" fill="#C9553D"/>`];
  });

  const soil = `<path d="M0 ${line + 20} Q ${width / 2} ${line} ${width} ${line + 20} L ${width} ${height} L 0 ${height} Z" fill="#B08A4B" opacity="0.9"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${soil}${stems.join("")}${seeds.join("")}${fruits.join("")}</svg>`;
}
