import type { PlantId, Scene } from "@/model/garden";
export type Diff = { seeds: string[]; buds: string[]; opened: string[]; branches: string[]; tokens: { plant: PlantId; index: number }[] };
export const NO_CHANGE: Diff = { seeds: [], buds: [], opened: [], branches: [], tokens: [] };
/** The moments of spec 6 are fired from what changed between the previous scene and this one (the watering tap only causes a read). */
export function diffScenes(prev: Scene | null, next: Scene): Diff {
  if (!prev) return NO_CHANGE;
  const sprouts = (s: Scene) => new Map(s.parts.flatMap((p) => (p.kind === "sprout" ? [[p.id, p] as const] : [])));
  const a = sprouts(prev), b = sprouts(next);
  const seeds = next.parts.flatMap((p) => (p.kind === "seed" && !prev.parts.some((q) => q.kind === "seed" && q.id === p.id) ? [p.id] : []));
  const buds = [...b.values()].flatMap((p) => (!a.has(p.id) && p.bud ? [p.id] : []));
  const opened = [...b.values()].flatMap((p) => (!p.bud && (a.get(p.id)?.bud ?? !a.has(p.id)) ? [p.id] : []));
  const branches = [...b.values()].flatMap((p) => (p.branch && !(a.get(p.id)?.branch ?? false) ? [p.id] : []));
  const tokens = next.parts.flatMap((p) => (p.kind === "fruit" && !prev.parts.some((q) => q.kind === "fruit" && q.plant === p.plant && q.index === p.index) ? [{ plant: p.plant, index: p.index }] : []));
  return { seeds, buds, opened, branches, tokens };
}
