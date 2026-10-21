// Read-only (R-O1, 10-21): how many saved rules the stORE floor touches. SELECTs only; prints counts, no keys, no secrets.
// Run from api/: pnpm tsx --env-file=.env.local spikes/store-floor-pins.ts
import { createClient } from "@supabase/supabase-js";
import { config } from "../src/lib/config";
import { rulesRow } from "../src/db/supabase";
import { ASSETS, type LiveAsset } from "../src/domain/coins";
import { validatePins, floorFor, effectiveSplit, STOP_DEFAULTS, STORE_FLOOR } from "../src/domain/split";
import type { Pins } from "../src/domain/roundup";

const db = createClient(config().supabaseUrl, config().supabaseServiceKey, { auth: { persistSession: false } });
const { data, error } = await db.from("rules").select("*");
if (error) throw new Error(error.message);
const rows = (data ?? []).map(rulesRow);
const latest: Record<string, unknown> = {};
for (const stop of ["careful", "balanced", "bold"] as const) {
  const r = await db.from("split_days").select("split").eq("stop", stop).order("day", { ascending: false }).limit(1).maybeSingle();
  latest[stop] = r.data?.split ?? null;
}
const n = { rules: rows.length, managed: 0, manual: 0, anyPins: 0, storePinBelowFloor: 0, storePinZeroOn: 0, problemSum: 0, problemOther: 0, allocStoreBelowFloor: 0, allocStoreBelowFloorManual: 0, allocStoreBelowFloorManaged: 0, splitWouldChangeManual: 0, splitWouldChangeManaged: 0, trimsAnotherPin: 0 };
for (const r of rows) {
  r.managed ? n.managed++ : n.manual++;
  // What the route would validate today: off, SKR pins and 0 pins are dropped (spec 4.2, R346); on, a 0 SKR pin is dropped.
  const pins: Pins = { ...r.pins };
  if (!r.managed) delete pins.SKR;
  for (const k of Object.keys(pins) as LiveAsset[]) if (pins[k] === 0 && (!r.managed || k === "SKR")) delete pins[k];
  if (Object.keys(pins).length) n.anyPins++;
  if (pins.stORE !== undefined && pins.stORE > 0 && pins.stORE < STORE_FLOOR) n.storePinBelowFloor++;
  if (r.managed && pins.stORE === 0) n.storePinZeroOn++;
  const p = validatePins(pins, floorFor(r.managed, r.stop));
  if (p === "sum") n.problemSum++;
  else if (p) n.problemOther++;
  if (r.allocation.stORE < STORE_FLOOR) {
    n.allocStoreBelowFloor++;
    r.managed ? n.allocStoreBelowFloorManaged++ : n.allocStoreBelowFloorManual++;
  }
  const stopSplit = r.managed ? ((latest[r.stop] as typeof STOP_DEFAULTS.careful | null) ?? STOP_DEFAULTS[r.stop]) : STOP_DEFAULTS[r.stop];
  const next = effectiveSplit({ managed: r.managed, stop: r.stop, pins, stopSplit });
  if (ASSETS.some((c) => next[c] !== r.allocation[c])) r.managed ? n.splitWouldChangeManaged++ : n.splitWouldChangeManual++;
  if (ASSETS.some((c) => c !== "SKR" && c !== "stORE" && pins[c] !== undefined && next[c] !== pins[c])) n.trimsAnotherPin++;
}
console.log(n);
