// Read-only: the three stops' decision rows for one day: the applied split, the why line, the fallback reason and the raw model answer.
// Run from api/: pnpm tsx --env-file=.env.local spikes/split-days-peek.ts [YYYY-MM-DD]
import { getRepo } from "../src/db/repo";
import { STOP_ORDER } from "../src/domain/coins";
import { dayOf } from "../src/domain/day";

const day = process.argv[2] ?? dayOf(new Date());
const repo = await getRepo();
for (const stop of STOP_ORDER) {
  const row = await repo.getSplitDay(day, stop);
  if (!row) { console.log(`${day} ${stop}: no row`); continue; }
  console.log(`${day} ${stop}: fallback ${row.fallback ?? "none"} callId ${row.callId ?? "none"}`);
  console.log(`  split ${JSON.stringify(row.split)}`);
  console.log(`  why   ${row.why}`);
  console.log(`  raw   ${JSON.stringify(row.modelAnswer)}`);
}
