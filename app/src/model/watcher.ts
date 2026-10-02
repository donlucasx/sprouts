/** What Home knows about the can beyond the scene: what the user did and what the API said. */
export type WatcherInput = {
  unrevealed: number;      // buds waiting to be opened (Scene.unrevealed)
  neverWatered: boolean;   // the API's wateredAt is null: the user has never watered
  opened: number;          // buds this watering opened, until the screen is left
  failed: boolean;         // the last watering failed
  nudged: boolean;         // the greyed can was tapped, until the screen is left
};

/** R175: the can lives in the garden, in colour while a bud waits and greyed otherwise. */
export type Watcher = { line: string | null; can: "ready" | "grey"; note: string | null };

/** Under the line until the first watering (audits/watering-ux, finding 7): what watering is, so skipping it is no loss. */
export const FIRST_RUN = "Your garden grows on its own. Watering opens the new growth so you can see it.";

/**
 * The line under the garden and the can, decided in one place so they always agree (audits/watering-ux, findings 2, 3, 7, 8 and 12).
 * R175: while a bud waits the can is in colour and the line says how to use it; otherwise the can is greyed and a tap on it says why
 * nothing happens. With nothing new to open there is no line (R164: the progress row carries the next planting). R96: no clock.
 */
export function watcherLine(w: WatcherInput): Watcher {
  if (w.unrevealed > 0) {
    const line = w.failed ? "Could not water. Try again." : "Drag the can to a plant to water.";
    return { line, can: "ready", note: w.neverWatered ? FIRST_RUN : null };
  }
  if (w.opened > 0) return { line: `Opened ${w.opened} new ${w.opened === 1 ? "sprout" : "sprouts"}.`, can: "grey", note: null };
  return { line: w.nudged ? "Nothing to water yet." : null, can: "grey", note: null };
}
