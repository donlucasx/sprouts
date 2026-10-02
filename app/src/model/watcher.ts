/** What Home knows about the can beyond the scene: what the user did and what the API said. */
export type WatcherInput = {
  unrevealed: number;      // buds waiting to be opened (Scene.unrevealed)
  opened: number;          // buds this watering opened, until the screen is left
  failed: boolean;         // the last watering failed
  nudged: boolean;         // the greyed can was tapped, until the screen is left
};

/** R175: the can lives in the garden, in colour while a bud waits and greyed otherwise. */
export type Watcher = { line: string | null; can: "ready" | "grey" };

/**
 * The ONE line under the garden and the can, decided in one place so they always agree (audits/watering-ux, findings 2, 3, 8 and 12).
 * R184: while a bud waits the line joins the can to the buds (it replaces the prompt and the first-run note); otherwise the can is
 * greyed and a tap on it says why nothing happens. With nothing new to open there is no line (R164: the progress row carries the next
 * planting). R96: no clock.
 */
export function watcherLine(w: WatcherInput): Watcher {
  const one = w.unrevealed === 1;
  if (w.unrevealed > 0) {
    const line = w.failed ? "Could not water. Try again." : `${w.unrevealed} new ${one ? "sprout is" : "sprouts are"} waiting. Drag the can onto ${one ? "it" : "them"} to water.`;
    return { line, can: "ready" };
  }
  if (w.opened > 0) return { line: `Opened ${w.opened} new ${w.opened === 1 ? "sprout" : "sprouts"}.`, can: "grey" };
  return { line: w.nudged ? "Nothing to water yet." : null, can: "grey" };
}
