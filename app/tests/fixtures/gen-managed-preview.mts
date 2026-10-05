// Regenerate with: (cd ../api && npx tsx ../app/tests/fixtures/gen-managed-preview.mts) — runs the API's own effectiveSplit (R346 oracle).
import fs from "node:fs";
import { effectiveSplit } from "../../../api/src/domain/split";
const ASSETS = ["SKR", "stORE", "USDC_LEND", "SOL_LEND", "hSOL", "cbBTC"] as const;
let seed = 7;
const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
const cases: unknown[] = [];
const push = (stopSplit: Record<string, number>, pins: Record<string, number>, stop: "careful" | "balanced" | "bold") =>
  cases.push({ stopSplit, pins, stop, want: effectiveSplit({ managed: true, stop, pins, stopSplit: stopSplit as never }) });
push({ SKR: 65, stORE: 10, USDC_LEND: 0, SOL_LEND: 0, hSOL: 15, cbBTC: 10 }, {}, "balanced");
push({ SKR: 65, stORE: 10, USDC_LEND: 0, SOL_LEND: 0, hSOL: 15, cbBTC: 10 }, { hSOL: 0 }, "balanced");
push({ SKR: 40, stORE: 0, USDC_LEND: 0, SOL_LEND: 0, hSOL: 30, cbBTC: 30 }, { stORE: 0, USDC_LEND: 0, SOL_LEND: 0, hSOL: 0, cbBTC: 0 }, "bold");
for (let i = 0; i < 400; i++) {
  const w = ASSETS.map(() => Math.floor(rnd() * 40));
  const total = w.reduce((a, b) => a + b, 0) || 1;
  const s: Record<string, number> = {};
  ASSETS.forEach((a, k) => (s[a] = Math.floor((w[k] / total) * 100)));
  s.SKR += 100 - ASSETS.reduce((t, a) => t + s[a], 0);
  const pins: Record<string, number> = {};
  for (const a of ASSETS.slice(1)) if (rnd() < 0.35) pins[a] = 0;
  push(s, pins, (["careful", "balanced", "bold"] as const)[i % 3]);
}
fs.writeFileSync(new URL("./managed-preview-golden.json", import.meta.url), JSON.stringify(cases));
console.log(cases.length, "cases");
