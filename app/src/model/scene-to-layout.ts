import type { Part, PlantId, Scene } from "./garden";
import { CANVAS } from "./layout";
import { layoutPlant } from "./plant-geometry";
import { COLORS, type PlantLayout, type ShootIn, type Species } from "./species";
export type PlantOnStage = { plant: PlantId; species: Species; row: "front" | "back"; x: number; k: number; layout: PlantLayout };
/** Every present plant's layout from the scene's parts: its shoots in slot order, its earned count and ripening, its pups, its swelling. */
export function plantLayouts(scene: Scene): PlantOnStage[] {
  const by = <K extends Part["kind"]>(kind: K, plant: PlantId) => scene.parts.filter((p): p is Extract<Part, { kind: K }> => p.kind === kind && (p as { plant?: PlantId }).plant === plant);
  return scene.parts.filter((p): p is Extract<Part, { kind: "plant" }> => p.kind === "plant").map((pl) => {
    const shoots: ShootIn[] = by("sprout", pl.plant).sort((a, b) => a.slot - b.slot).map((s) => ({ id: s.id, ageDays: s.ageDays, band: s.band, opened: !s.bud, branch: s.branch }));
    const k = pl.row === "back" ? CANVAS.backScale : CANVAS.frontScale;   // R231: the front row nearer, 1.3x
    const layout = layoutPlant(pl.species, shoots, { pending: by("swelling", pl.plant)[0]?.progress ?? 0, fruit: by("fruit", pl.plant).length, ripening: by("ripening", pl.plant)[0]?.progress ?? 0, blossom: false, pups: by("pup", pl.plant).length, head: false }, k);
    // R61: a transplanted position is the SKR plant's grown base: a 56 px trunk with four stage-3 blades, its own parts lifted above it
    if (pl.plant === "skr" && scene.parts.some((p) => p.kind === "transplant")) {
      const lifted = layout.parts.map((q) => (q.kind === "stem" ? { ...q, y0: q.y0 - 56, y1: q.y1 - 56 } : { ...q, y: q.y - 56 }));
      lifted.unshift({ kind: "stem", part: "trunk", x0: 0, y0: 0, x1: 0, y1: -56, w0: 5, w1: 3, bend: 0, color: COLORS.skr.deep, z: 0 });
      for (let i = 0; i < 4; i++) lifted.push({ kind: "sprite", part: "leaf", name: "leaf-mandarin-s3", x: (i % 2 ? 1 : -1) * 10, y: -14 * (i + 1), rot: (i % 2 ? 1 : -1) * 58, scale: 1, z: 2 });
      return { plant: pl.plant, species: pl.species, row: pl.row, x: pl.x, k, layout: { ...layout, parts: lifted, top: layout.top + 56, growthPoint: { x: layout.growthPoint.x, y: layout.growthPoint.y - 56 } } };
    }
    return { plant: pl.plant, species: pl.species, row: pl.row, x: pl.x, k, layout };
  });
}
/** The highest point any part reaches above the FRONT row's feet (the back row's feet stand 30 px higher). */
export const sceneTop = (scene: Scene) => Math.max(0, ...plantLayouts(scene).map((l) => l.layout.top + (l.row === "back" ? CANVAS.frontFeet - CANVAS.backFeet : 0)));
