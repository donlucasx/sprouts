/** What Home knows about the can beyond the scene: what the user is doing and what the API said. */
export type WatcherInput = {
  unrevealed: number;      // buds waiting to be opened (Scene.unrevealed)
  neverWatered: boolean;   // the API's wateredAt is null: the user has never watered
  watering: boolean;       // the request is running
  opened: number;          // buds this watering opened, until the screen is left
  failed: boolean;         // the last tap failed
};

export type Watcher = { line: string | null; button: "Water" | "Watering..." | null; note: string | null };

/** Under the button until the first watering (audits/watering-ux, finding 7): what watering is, so skipping it is no loss. */
export const FIRST_RUN = "Your garden grows on its own. Watering opens the new growth so you can see it.";

/**
 * The line beside the can and the can itself, decided in one place so they always agree. (audits/watering-ux, findings 2, 3, 7,
 * 8 and 12). With nothing new to open there is no line (R164: the progress row carries the next planting). R96: the button is there when a bud waits and nowhere otherwise; there is no clock. Copy verbatim from RECONCILED.
 */
export function watcherLine(w: WatcherInput): Watcher {
  const one = (n: number, a: string, b: string) => (n === 1 ? a : b);
  if (w.unrevealed > 0) {
    const line = w.failed
      ? "Could not water. Try again."
      : `${w.unrevealed} new ${one(w.unrevealed, "sprout is", "sprouts are")} waiting. Water to open ${one(w.unrevealed, "it", "them")}.`;
    return { line, button: w.watering ? "Watering..." : "Water", note: w.neverWatered ? FIRST_RUN : null };
  }
  if (w.opened > 0) return { line: `Opened ${w.opened} new ${one(w.opened, "sprout", "sprouts")}.`, button: null, note: null };
  return { line: null, button: null, note: null };
}
