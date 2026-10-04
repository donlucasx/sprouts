import { store } from "./store";
import type { PlantId } from "@/model/garden";

/** R249: which plants the last watering made on this phone opened (the plants with a bud when it began), kept with the API's answer's
 * time, so the water rings go under those alone. Another phone's watering, or none recorded, falls back to the model's rule. */
const KEY = "garden.lastWatering";
export function recordWatering(at: string, plants: PlantId[]) {
  store.set(KEY, JSON.stringify({ at, plants }));
}
export function wateredPlantsFor(wateredAt: string | null | undefined): PlantId[] | null {
  if (!wateredAt) return null;
  try {
    const raw = store.getString(KEY);
    const r = raw ? (JSON.parse(raw) as { at: string; plants: PlantId[] }) : null;
    return r && new Date(r.at).getTime() === new Date(wateredAt).getTime() ? r.plants : null;
  } catch {
    return null;
  }
}
