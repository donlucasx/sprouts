/** What Home knows about the can beyond the scene: what the user did and what the API said. */
export type WatcherInput = {
  unrevealed: number;      // buds waiting to be opened (Scene.unrevealed)
  failed: boolean;         // the last watering failed
  nudged: boolean;         // the greyed can was tapped, until the screen is left
};

/** R186: the can sits at the end of the Next planting bar, in colour while a bud waits and greyed otherwise. */
export type Watcher = { line: string | null; can: "ready" | "grey" };

/**
 * The ONE line under the garden and the can, decided in one place so they always agree (audits/watering-ux, findings 2, 3, 8 and 12).
 * R184, R186: while a bud waits the line joins the planting to the can and the buds (one line, no first-run note); otherwise the can is
 * greyed and a tap on it says why nothing happens. With nothing new to open there is no line (R164: the progress row carries the next
 * planting). R96: no clock.
 * R199 (device check 2; Claude's proposal, flagged to him): no line after a watering either. The "Opened N new sprouts." confirmation
 * is gone: he asked what it meant, and the bud opening in the garden is the confirmation; a watering that opened everything leaves the
 * can greyed and the line empty, the same as any moment with nothing waiting.
 */
export function watcherLine(w: WatcherInput): Watcher {
  const one = w.unrevealed === 1;
  if (w.unrevealed > 0) {
    const line = w.failed ? "Could not water. Try again." : `Your change was planted. Drag the can onto the new ${one ? "sprout to open it" : "sprouts to open them"}.`;
    return { line, can: "ready" };
  }
  return { line: w.nudged ? "Nothing to water yet." : null, can: "grey" };
}
