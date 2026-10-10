import { store } from "./store";
import type { Stages } from "@/model/garden2";

/** R521: the stage each Garden2 plant last showed on this phone, so the first open after a step up can reveal it. */
const KEY = "garden2.seenStages";
export function readSeenStages(): Partial<Stages> | null {
  try {
    const raw = store.getString(KEY);
    const v = raw ? (JSON.parse(raw) as unknown) : null;
    return v && typeof v === "object" ? (v as Partial<Stages>) : null;
  } catch {
    return null;
  }
}
export function writeSeenStages(stages: Stages): void {
  try {
    store.set(KEY, JSON.stringify(stages));
  } catch {
    // the reveal is a nicety: a failed write only means the next open shows the garden as is
  }
}
