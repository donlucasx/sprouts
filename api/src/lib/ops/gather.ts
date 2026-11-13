// Ops dashboard: run every source under a timeout, feed the pure lights, cache the snapshot 60 s per instance.
// The snapshot holds only Light objects, the (already shortened) numbers, timestamps and the blind-spot lines: never a raw source value.
import { movesEnabled } from "@/lib/moves";
import { leashLive } from "@/lib/leash";
import { EXPECTED_LEGS_ENABLED, shortWallet, realOpsSources, type OpsSources, type OpsNumbers } from "./sources";
import { dailyRunLight, firstPlantingLight, moneyOpsLight, swapWatchingLight, swapsArrivingLight, pricesLight, gasLight, programLight, supportLight, PYTH_ACCESS_ENDS, type Light, type LightKey } from "./lights";

export type OpsSnapshot = { at: string; lights: Light[]; numbers: OpsNumbers | null; numbersAt: string | null; blindSpots: string[] };

export type GatherOpts = { sources?: OpsSources; now?: Date; fresh?: boolean; flags?: { movesEnabled: boolean; leashLive: boolean } };

const TIMEOUT_MS = 5_000;
const CACHE_MS = 60_000;
const DAY = 86_400_000;

/** Spec "Known blind spots", one per line. */
export const BLIND_SPOTS = [
  "Helius registered but not delivering (caught only by Swaps arriving after 24-72 h)",
  "one wallet's swaps dropped while others arrive",
  "the Discord alert pipeline itself failing",
  "plantings that succeed with a wrong amount",
];

/** Leg index to coin, in LEG_SPEC order (api/src/lib/leash.ts). */
const LEG_NAMES = ["SKR", "stORE", "USDC lend (Kamino)", "USDC lend (Jupiter)", "SOL lend (Kamino)", "SOL lend (Jupiter)", "hSOL", "cbBTC"];

type Settled<T> = { ok: true; value: T } | { ok: false };

function withTimeout<T>(p: () => Promise<T>, ms: number): Promise<Settled<T>> {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve({ ok: false }), ms);
    let run: Promise<T>;
    try { run = p(); } catch { clearTimeout(t); resolve({ ok: false }); return; }
    run.then(
      (value) => { clearTimeout(t); resolve({ ok: true, value }); },
      () => { clearTimeout(t); resolve({ ok: false }); },
    );
  });
}

let cache: { at: number; snap: OpsSnapshot } | null = null;
let inflight: Promise<OpsSnapshot> | null = null;
let lastNumbers: { numbers: OpsNumbers; at: string } | null = null;

export function resetOpsCacheForTests(): void {
  cache = null;
  inflight = null;
  lastNumbers = null;
}

/** Defence in depth: a light fact never carries a full-length key, whatever a source or summary held. */
const redact = (l: Light): Light => ({ ...l, fact: l.fact.replace(/[1-9A-HJ-NP-Za-km-z]{32,44}/g, shortWallet) });

async function gather(sources: OpsSources, now: Date, flags: { movesEnabled: boolean; leashLive: boolean }): Promise<OpsSnapshot> {
  const since24 = new Date(now.getTime() - DAY).toISOString();
  const since7d = new Date(now.getTime() - 7 * DAY).toISOString();
  const T = <K extends keyof OpsSources>(name: K, fn: () => ReturnType<OpsSources[K]>) => withTimeout(fn as () => Promise<Awaited<ReturnType<OpsSources[K]>>>, TIMEOUT_MS).then((r) => ({ name, r }));

  const [cron, first, failures, pending, linked, webhook, swaps, feeds, skr, gas, legs, support, nums] = await Promise.all([
    T("cronLatest", () => sources.cronLatest()),
    T("firstPlantingLast", () => sources.firstPlantingLast()),
    T("failures", () => sources.failures(since7d)),
    T("oldestPendingWithdrawalAt", () => sources.oldestPendingWithdrawalAt()),
    T("linkedWallets", () => sources.linkedWallets()),
    T("webhookAddresses", () => sources.webhookAddresses()),
    T("swapStats", () => sources.swapStats(since24)),
    T("feeds", () => sources.feeds()),
    T("skrPrice", () => sources.skrPrice()),
    T("pullerLamports", () => sources.pullerLamports()),
    T("legsEnabled", () => sources.legsEnabled()),
    T("support", () => sources.support(since7d)),
    T("numbers", () => sources.numbers(now.toISOString())),
  ]);

  const unknown = (key: LightKey, label: string, failed: string[]): Light => ({ key, label, state: "unknown", fact: `could not check: ${failed.join(", ")}` });
  const failedOf = (...xs: { name: string; r: { ok: boolean } }[]) => xs.filter((x) => !x.r.ok).map((x) => x.name);

  const lights: Light[] = [];
  // Order here is LightKey order; each light is unknown if ANY of its sources failed.
  if (cron.r.ok) lights.push(dailyRunLight({ now, latest: cron.r.value, movesEnabled: flags.movesEnabled }));
  else lights.push(unknown("dailyRun", "Daily run", ["cronLatest"]));

  if (first.r.ok) lights.push(firstPlantingLight({ now, lastRunAt: first.r.value }));
  else lights.push(unknown("firstPlanting", "First planting", ["firstPlantingLast"]));

  if (linked.r.ok && webhook.r.ok) lights.push(swapWatchingLight({ linked: linked.r.value, onWebhook: webhook.r.value }));
  else lights.push(unknown("swapWatching", "Swap watching", failedOf(linked, webhook)));

  if (linked.r.ok && swaps.r.ok) lights.push(swapsArrivingLight({ now, linkedCount: new Set(linked.r.value).size, lastSwapAt: swaps.r.value.lastSwapAt, unpriced24h: swaps.r.value.unpriced }));
  else lights.push(unknown("swapsArriving", "Swaps arriving", failedOf(linked, swaps)));

  if (feeds.r.ok && skr.r.ok) lights.push(pricesLight({ now, feeds: feeds.r.value, skr: skr.r.value, accessEnds: PYTH_ACCESS_ENDS }));
  else lights.push(unknown("prices", "Prices", failedOf(feeds, skr)));

  if (gas.r.ok) lights.push(gasLight({ lamports: gas.r.value }));
  else lights.push(unknown("gas", "Gas", ["pullerLamports"]));

  if (failures.r.ok && pending.r.ok) lights.push(moneyOpsLight({ now, failures: failures.r.value, oldestPendingWithdrawalAt: pending.r.value }));
  else lights.push(unknown("moneyOps", "Money ops", failedOf(failures, pending)));

  if (legs.r.ok) lights.push(programLight({ enabled: legs.r.value, expected: [...EXPECTED_LEGS_ENABLED], leashLive: flags.leashLive, names: LEG_NAMES }));
  else lights.push(unknown("program", "Program", ["legsEnabled"]));

  if (support.r.ok) lights.push(supportLight({ now, count7d: support.r.value.count, newestAt: support.r.value.newestAt }));
  else lights.push(unknown("support", "Support", ["support"]));

  if (nums.r.ok) lastNumbers = { numbers: nums.r.value, at: now.toISOString() };

  return {
    at: now.toISOString(),
    lights: lights.map(redact),
    numbers: lastNumbers?.numbers ?? null,
    numbersAt: lastNumbers?.at ?? null,
    blindSpots: [...BLIND_SPOTS],
  };
}

export async function gatherOps(opts: GatherOpts = {}): Promise<OpsSnapshot> {
  const now = opts.now ?? new Date();
  if (!opts.fresh && cache) {
    const age = now.getTime() - cache.at;
    if (age >= 0 && age < CACHE_MS) return cache.snap;
  }
  if (!opts.fresh && inflight) return inflight;

  const sources = opts.sources ?? realOpsSources();
  const flags = opts.flags ?? { movesEnabled: movesEnabled(), leashLive: leashLive() };
  const run = gather(sources, now, flags).then((snap) => {
    cache = { at: now.getTime(), snap };
    return snap;
  });
  const tracked = run.finally(() => { if (inflight === tracked) inflight = null; });
  inflight = tracked;
  return tracked;
}
