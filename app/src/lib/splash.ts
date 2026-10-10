import { SLOGAN } from "@/lib/slogan";

/** R282 ("Short splash on every load", Hammer: "super clear (for non English speakers)"): one painted picture, one line, about 1.5 s. R319: the line is the slogan. */
export const SPLASH = { ms: 2500, fadeMs: 250, capMs: 4000,   // his note 10-05: "another beat" (R282's ~1.5 s was too quick)
  day: 240, line: SLOGAN } as const;

/** R574 (the re-open loading screen, components/Splash.tsx): once the tree has grown, this long before the fade; the most it ever
 * stays; and the fade's delay once grown: the hold, or under reduced motion (the grown tree at once) R282's SPLASH.ms. Replaces the
 * old painted-garden splash's splashScene / splashHoldMs (s6 review C8: dead since R573, still tested). */
export const GROWN_HOLD_MS = 400,
  SPLASH_CAP_MS = 7000;
export const fadeAfterGrownMs = (reduced: boolean): number => (reduced ? SPLASH.ms : GROWN_HOLD_MS);
