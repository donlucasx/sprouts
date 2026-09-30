import type { Part, Scene } from "./garden";
import { MAX_RISE, TRANSPLANT_BASE, leafSize, nodeRise, side, stemRise } from "./plant-geometry";
import { soilSurface } from "./soil";

/** The widget's soil band: the app's mound at half scale (edges 20 below the soil line, crown 10), 30 high. */
export const WIDGET_SOIL_BAND = 30;

/**
 * The garden as an SVG string for the widget, filling `width` x `height`: soil, one stem per coin with a leaf (or closed bud) per
 * planting, the forming bud, seeds before the first planting, fruit beside their shoot. The app's plants (R89), fewer pixels.
 */
export function widgetGardenSvg(scene: Scene, width: number, height: number): string {
  const line = height - WIDGET_SOIL_BAND;
  const surface = (t: number) => line + soilSurface(t) / 2;
  const f = (n: number) => Number(n.toFixed(1));

  // R89: the same plants as the app (plant-geometry.ts), shrunk to fit the widget's height.
  const k = Math.min(1, (height - WIDGET_SOIL_BAND - 6) / MAX_RISE);
  const transplant = scene.parts.some((p) => p.kind === "transplant");
  const plants = scene.parts.filter((p): p is Extract<Part, { kind: "plant" }> => p.kind === "plant");
  const plantOf = (c: "skr" | "ore") => plants.find((p) => p.plant === c)!;
  const base = (c: "skr" | "ore") => (c === "skr" && transplant ? TRANSPLANT_BASE : 0);
  const node = (s: { plant: "skr" | "ore"; y: number }) => {
    const p = plantOf(s.plant);
    return { x: p.x * width, y: surface(p.x) - nodeRise(s.y, p.shoots, base(s.plant)) * k };
  };

  const seeds = scene.parts.flatMap((p) => p.kind === "seed"
    ? [`<circle cx="${f(p.x * width)}" cy="${f(surface(p.x) + 2.5)}" r="2" fill="#2B2B2B" opacity="0.7"/>`] : []);
  const stems = plants.map((p) => {
    const x = f(p.x * width), foot = f(surface(p.x)), rise = f(stemRise(p.shoots, base(p.plant)) * k);
    return `<path d="M${x} ${foot} q 1.5 ${f(-rise / 2)} 0 ${-rise}" stroke="#3F7A4A" stroke-width="${p.plant === "skr" ? 2 : 3}" fill="none"/>`;
  });
  const leaves = scene.parts.flatMap((p) => {
    if (p.kind !== "sprout") return [];
    const n = node(p), sd = side(p.y);
    if (p.bud) return [`<ellipse cx="${f(n.x + sd * 2)}" cy="${f(n.y)}" rx="2.5" ry="3.5" fill="#3F7A4A" opacity="0.75"/>`];
    const r = leafSize(p.stage) * Math.max(0.7, k);
    return [`<ellipse cx="${f(n.x + sd * r)}" cy="${f(n.y)}" rx="${f(r)}" ry="${f(r / 2.2)}" fill="#3F7A4A" transform="rotate(${sd * -25} ${f(n.x + sd * r)} ${f(n.y)})"/>`];
  });
  const formingPart = scene.parts.find((p): p is Extract<Part, { kind: "forming" }> => p.kind === "forming");
  const forming = formingPart ? (() => {
    const p = plantOf(formingPart.plant);
    return [`<circle cx="${f(p.x * width)}" cy="${f(surface(p.x) - stemRise(p.shoots, base(p.plant)) * k - 2)}" r="${f(1.5 + 2.5 * formingPart.progress)}" fill="#3F7A4A" opacity="${f(0.45 + 0.4 * formingPart.progress)}"/>`];
  })() : [];
  // Fruit hang beside the shoot the scene names (ORE pups sit on the soil in the app's garden only).
  const perHost = new Map<string, number>();
  const fruits = scene.parts.flatMap((p) => {
    if (p.kind !== "fruit" || p.on === null) return [];
    const host = scene.parts.find((q): q is Extract<Part, { kind: "sprout" }> => q.kind === "sprout" && q.id === p.on);
    if (!host) return [];
    const kk = perHost.get(p.on) ?? 0;
    perHost.set(p.on, kk + 1);
    const n = node(host);
    return [`<circle cx="${f(n.x - side(host.y) * (6 + kk * 5))}" cy="${f(n.y + 4 + kk * 3)}" r="3" fill="#C9553D"/>`];
  });

  const soil = `<path d="M0 ${line + 20} Q ${width / 2} ${line} ${width} ${line + 20} L ${width} ${height} L 0 ${height} Z" fill="#B08A4B" opacity="0.9"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${soil}${stems.join("")}${leaves.join("")}${forming.join("")}${seeds.join("")}${fruits.join("")}</svg>`;
}
