// Sets one or more numeric rules for a user (the app's rules screen does this in Plan 2; this is the by-hand version).
// Run from api/: pnpm tsx --env-file=.env.local spikes/set-rules.ts <seed vault pubkey> key=value [key=value ...]
//   keys: roundupToCents pctBps pctThresholdCents plantThresholdCents plantMaxDays dailyCapCents
import { getRepo } from "../src/db/repo";

const [user, ...pairs] = process.argv.slice(2);
if (!user || pairs.length === 0) { console.log("usage: set-rules.ts <user> key=value ..."); process.exit(1); }
const allowed = new Set(["roundupToCents", "pctBps", "pctThresholdCents", "plantThresholdCents", "plantMaxDays", "dailyCapCents"]);
const patch: Record<string, number> = {};
for (const p of pairs) {
  const [k, v] = p.split("=");
  if (!allowed.has(k) || !Number.isFinite(Number(v))) { console.log(`bad pair: ${p}`); process.exit(1); }
  patch[k] = Number(v);
}
const repo = await getRepo();
const before = await repo.getRules(user);
const after = await repo.saveRules(user, patch);
for (const k of Object.keys(patch)) console.log(`${k}: ${(before as unknown as Record<string, unknown>)[k]} -> ${(after as unknown as Record<string, unknown>)[k]}`);
