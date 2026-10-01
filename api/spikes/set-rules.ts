// Sets rules for a user by hand (the app's Rules screen does this; this is the Terminal version for the demo accounts).
// Run from api/: pnpm tsx --env-file=.env.local spikes/set-rules.ts <seed vault pubkey> key=value ... [--managed on|off] [--stop careful|balanced|bold] [--pin COIN=PCT ...] [--pins-clear]
//   numeric keys: roundupToCents pctBps pctThresholdCents plantThresholdCents plantMaxDays dailyCapCents
// The split is recomputed the way PUT /api/rules does it, from the stop's latest row (or the stop default) and the pins.
import { getRepo } from "../src/db/repo";
import { isAsset, isStop, type Asset, type Stop } from "../src/domain/coins";
import type { Pins } from "../src/domain/roundup";
import { effectiveSplit, validatePins, floorFor, STOP_DEFAULTS } from "../src/domain/split";

const argv = process.argv.slice(2);
const user = argv[0];
if (!user) { console.log("usage: set-rules.ts <user> key=value ... [--managed on|off] [--stop s] [--pin COIN=PCT] [--pins-clear]"); process.exit(1); }
const allowed = new Set(["roundupToCents", "pctBps", "pctThresholdCents", "plantThresholdCents", "plantMaxDays", "dailyCapCents"]);
const patch: Record<string, unknown> = {};
let managed: boolean | undefined;
let stop: Stop | undefined;
let pins: Pins | undefined;
for (let i = 1; i < argv.length; i++) {
  const a = argv[i];
  if (a === "--managed") managed = argv[++i] === "on";
  else if (a === "--stop") { const s = argv[++i]; if (!isStop(s)) { console.log(`bad stop: ${s}`); process.exit(1); } stop = s; }
  else if (a === "--pin") { const [c, v] = argv[++i].split("="); if (!isAsset(c) || !Number.isInteger(Number(v))) { console.log(`bad pin: ${argv[i]}`); process.exit(1); } pins = { ...(pins ?? {}), [c as Asset]: Number(v) }; }
  else if (a === "--pins-clear") pins = {};
  else { const [k, v] = a.split("="); if (!allowed.has(k) || !Number.isFinite(Number(v))) { console.log(`bad pair: ${a}`); process.exit(1); } patch[k] = Number(v); }
}
const repo = await getRepo();
const before = await repo.getRules(user);
if (managed !== undefined || stop !== undefined || pins !== undefined) {
  const m = managed ?? before.managed;
  const s = stop ?? before.stop;
  const p = pins ?? before.pins;
  const problem = validatePins(p, floorFor(m, s));
  if (problem) { console.log(`pins refused: ${problem}`); process.exit(1); }
  const stopSplit = m ? ((await repo.latestSplitDay(s))?.split ?? STOP_DEFAULTS[s]) : STOP_DEFAULTS[s];
  Object.assign(patch, { managed: m, stop: s, pins: p, allocation: effectiveSplit({ managed: m, stop: s, pins: p, stopSplit }), prevAllocation: null, allocationDay: null });
}
const after = await repo.saveRules(user, patch);
for (const k of Object.keys(patch)) console.log(`${k}: ${JSON.stringify((before as unknown as Record<string, unknown>)[k])} -> ${JSON.stringify((after as unknown as Record<string, unknown>)[k])}`);
