import { buildScene, type Scene } from "@/model/garden";
import { previewInputAt } from "@/model/fixtures/median-year";
import { SLOGAN } from "@/lib/slogan";

/** R282 ("Short splash on every load", Hammer: "super clear (for non English speakers)"): one painted picture, one line, about 1.5 s. R319: the line is the slogan. */
export const SPLASH = { ms: 1500, fadeMs: 250, day: 240, line: SLOGAN } as const;

/** The picture: the preview year's garden at SPLASH.day, every bud open, without stakes, seeds, swelling or rings (nothing to tap). */
export function splashScene(): Scene {
  const s = buildScene(previewInputAt(SPLASH.day));
  const parts = s.parts
    .filter((p) => p.kind !== "sign" && p.kind !== "seed" && p.kind !== "swelling" && p.kind !== "ring")
    .map((p) => (p.kind === "sprout" ? { ...p, bud: false } : p));
  return { parts, unrevealed: 0, canReady: false };
}
