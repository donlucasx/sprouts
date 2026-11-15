// Regenerate with: (cd ../api && npx tsx ../app/tests/fixtures/gen-split-parity.mts) — runs the API's own effectiveSplit and
// validatePins (coin flexibility, 11-15) over a seeded sweep of pin sets, both modes, every stop, SKR switched off included.
import fs from "node:fs";
import { effectiveSplit, validatePins, STOP_DEFAULTS, PIN_MAX } from "../../../api/src/domain/split";
const ASSETS = ["SKR", "stORE", "USDC_LEND", "SOL_LEND", "hSOL", "cbBTC"] as const;
const STOPS = ["careful", "balanced", "bold"] as const;
let seed = 20261115;
const rnd = (n: number) => {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed % n;
};
const cases: unknown[] = [];
const push = (managed: boolean, stop: (typeof STOPS)[number], pins: Record<string, number>, stopSplit: Record<string, number>) =>
  cases.push({ managed, stop, pins, stopSplit, want: effectiveSplit({ managed, stop, pins, stopSplit: stopSplit as never }) });
let tries = 0;
while (cases.length < 1200 && tries++ < 20000) {
  const stop = STOPS[rnd(3)];
  const pins: Record<string, number> = {};
  let room = 100;
  for (const c of ASSETS) {
    const k = rnd(5); // 0-1: free, 2: off, 3-4: a pin (a multiple of 5, as the app's stepper makes)
    if (k === 2) pins[c] = 0;
    else if (k >= 3) {
      const v = 5 * rnd(Math.floor(Math.min(PIN_MAX[c as keyof typeof PIN_MAX], room) / 5) + 1);
      pins[c] = v;
      room -= v;
    }
  }
  if (validatePins(pins)) continue;
  // The manager's stop split: the stop's default, or a random whole split (the morning's answer).
  let stopSplit: Record<string, number> = { ...STOP_DEFAULTS[stop] };
  if (rnd(2) === 0) {
    const w = ASSETS.map(() => rnd(40));
    const total = w.reduce((a, b) => a + b, 0) || 1;
    stopSplit = {};
    ASSETS.forEach((a, i) => (stopSplit[a] = Math.floor((w[i] / total) * 100)));
    stopSplit.SKR += 100 - ASSETS.reduce((t, a) => t + stopSplit[a], 0);
  }
  push(cases.length % 2 === 0, stop, pins, stopSplit);
}
fs.writeFileSync(new URL("./split-parity-golden.json", import.meta.url), JSON.stringify(cases));
console.log(cases.length, "cases");
