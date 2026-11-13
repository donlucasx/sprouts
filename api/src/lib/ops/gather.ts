// Ops dashboard: run every source under a timeout, feed the pure lights, cache the snapshot 60 s per instance.
// The snapshot holds only Light objects, the (already shortened) numbers, timestamps and the blind-spot lines: never a raw source value.
import { movesEnabled } from "@/lib/moves";
import { leashLive } from "@/lib/leash";
import { EXPECTED_LEGS_ENABLED, shortWallet, realOpsSources, type OpsSources, type OpsNumbers } from "./sources";
import { dailyRunLight, firstPlantingLight, moneyOpsLight, swapWatchingLight, swapsArrivingLight, pricesLight, gasLight, programLight, supportLight, PYTH_ACCESS_ENDS, LIGHT_LABELS, type Light, type LightKey } from "./lights";

export type OpsSnapshot = { at: string; lights: Light[]; numbers: OpsNumbers | null; numbersAt: string | null; blindSpots: string[]; liveOff: boolean };

export type GatherOpts = { sources?: OpsSources; now?: Date; fresh?: boolean; flags?: { movesEnabled: boolean; leashLive: boolean } };

const TIMEOUT_MS = 5_000;
const CACHE_MS = 60_000;
const DAY = 86_400_000;

/** Spec "Known blind spots", one per line. */
export const BLIND_SPOTS = [
  "The swap watcher can be registered but silently not delivering. \"Swaps coming in\" only catches that after 1 to 3 days.",
  "One wallet's swaps can go missing while other wallets' swaps keep arriving.",
  "The Discord alerts themselves can fail, and then nothing tells you.",
  "A saving can succeed but with the wrong amount.",
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
let lastNumbers: { numbers: OpsNumbers; at: string; ms: number } | null = null;

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
    // Audit F1: 14 days back, the remainder retry window; moneyOpsLight keeps the other kinds to 7.
    T("failures", () => sources.failures(new Date(now.getTime() - 14 * DAY).toISOString())),
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

  // Source names stay out of the fact (the founder cannot read them); they go to the server log for debugging.
  const unknown = (key: LightKey, failed: string[]): Light => {
    console.error(`ops: could not check ${key}: ${failed.join(", ")}`);
    return { key, label: LIGHT_LABELS[key], state: "unknown", fact: "Could not check this (a data source timed out)", action: "Try Refresh. If it stays grey, ask Claude." };
  };
  const failedOf = (...xs: { name: string; r: { ok: boolean } }[]) => xs.filter((x) => !x.r.ok).map((x) => x.name);

  // Order here is LightKey order; each light is unknown if ANY of its sources failed, or if building it throws on odd data.
  const light = (key: LightKey, srcs: { name: string; r: { ok: boolean } }[], build: () => Light): Light => {
    const failed = failedOf(...srcs);
    if (failed.length) return unknown(key, failed);
    try { return build(); } catch { return unknown(key, srcs.map((x) => x.name)); }
  };
  const v = <T,>(x: { r: Settled<T> }): T => (x.r as { ok: true; value: T }).value;

  const lights: Light[] = [
    light("dailyRun", [cron], () => dailyRunLight({ now, latest: v(cron), movesEnabled: flags.movesEnabled })),
    light("firstPlanting", [first], () => firstPlantingLight({ now, lastRunAt: v(first)?.at ?? null, reasons: v(first)?.reasons })),
    light("swapWatching", [linked, webhook], () => swapWatchingLight({ linked: v(linked), onWebhook: v(webhook) })),
    light("swapsArriving", [linked, swaps], () => swapsArrivingLight({ now, linkedCount: new Set(v(linked)).size, lastSwapAt: v(swaps).lastSwapAt, unpriced24h: v(swaps).unpriced })),
    light("prices", [feeds, skr], () => pricesLight({ now, feeds: v(feeds), skr: v(skr), accessEnds: PYTH_ACCESS_ENDS })),
    light("gas", [gas], () => gasLight({ lamports: v(gas) })),
    light("moneyOps", [failures, pending], () => moneyOpsLight({ now, failures: v(failures), oldestPendingWithdrawalAt: v(pending) })),
    light("program", [legs], () => programLight({ enabled: v(legs), expected: [...EXPECTED_LEGS_ENABLED], leashLive: flags.leashLive, names: LEG_NAMES })),
    light("support", [support], () => supportLight({ now, count7d: v(support).count, newestAt: v(support).newestAt })),
  ];

  // Overlapping runs: only a newer run may replace the last good numbers.
  if (nums.r.ok && (!lastNumbers || now.getTime() > lastNumbers.ms)) lastNumbers = { numbers: nums.r.value, at: now.toISOString(), ms: now.getTime() };

  return {
    at: now.toISOString(),
    lights: lights.map(redact),
    numbers: lastNumbers?.numbers ?? null,
    numbersAt: lastNumbers?.at ?? null,
    blindSpots: [...BLIND_SPOTS],
    liveOff: !flags.leashLive,
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
    if (!cache || now.getTime() >= cache.at) cache = { at: now.getTime(), snap };
    return snap;
  });
  const tracked = run.finally(() => { if (inflight === tracked) inflight = null; });
  inflight = tracked;
  return tracked;
}
