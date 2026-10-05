// Pure helpers behind scripts/simulate-legs.ts (the go-live gate, spec 6.5). Never imported by the server.
// Everything that touches the chain is injected (LegDeps), so the argument parsing, the Jupiter Lend leftover retry, the
// no-post skip and the exit code are unit-tested with fakes (tests/scripts/simulate-legs.test.ts).
import { getCompiledTransactionMessageDecoder } from "@solana/kit";
import { isLiveAsset, type LiveAsset } from "@/domain/coins";
import { isAutoVenue, type AutoVenue } from "@/domain/venues";
import { LEASH_ERRORS, LEG_SPEC, SKR_PRICE_SOURCE, leashLegOf } from "@/lib/leash";

/** Solana's packet limit for a serialized transaction, and the per-transaction account-lock limit. */
export const MAX_TX_BYTES = 1232;
export const MAX_ACCOUNT_LOCKS = 64;

export type Leg = { name: string; asset: LiveAsset; venue: AutoVenue | null };
export type SimArgs = {
  user: string; wallet: string; delegation: string; leashed: boolean; pullRaw: bigint;
  /** Default ON. Off only with --allow-post (the owner's own Terminal): a leg whose price must be POSTED is skipped, never posted. */
  noPost: boolean;
  /** Build and measure (size, locks) without simulating: today's only honest leashed run, the leash program is not deployed yet. */
  sizeOnly: boolean;
  /**
   * Size with the Sprouts ALT before it exists on chain: its address list (lib/alt.ts) compressed in memory (buildPlantingTx
   * measureAlt). COMPUTED, not measured on chain; implies sizeOnly (a tx naming a table not on chain cannot be simulated).
   */
  assumeAlt: boolean;
  legs: Leg[];
};

const VALUE_FLAGS = new Set(["--user", "--wallet", "--delegation", "--pull"]);
const BOOL_FLAGS = new Set(["--leashed", "--no-post", "--allow-post", "--size-only", "--assume-alt"]);
const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/** The command line -> what to run. Throws on anything unknown, so a typo never silently drops a leg or a flag. */
export function parseArgs(argv: readonly string[]): SimArgs {
  const values: Record<string, string> = {};
  const positional: string[] = [];
  const bools = new Set<string>();
  for (let i = 0; i < argv.length; i++) {
    const x = argv[i];
    if (VALUE_FLAGS.has(x)) {
      const v = argv[i + 1];
      if (v === undefined || v.startsWith("--")) throw new Error(`${x} needs a value`);
      values[x] = v;
      i++;
    } else if (BOOL_FLAGS.has(x)) bools.add(x);
    else if (x.startsWith("--")) throw new Error(`unknown flag ${x}`);
    else positional.push(x);
  }
  if (bools.has("--no-post") && bools.has("--allow-post")) throw new Error("--no-post and --allow-post contradict each other");
  for (const k of ["--user", "--wallet", "--delegation"]) {
    if (!values[k]) throw new Error(`${k} <address> is required`);
    if (!BASE58.test(values[k])) throw new Error(`${k} ${values[k]} is not a base58 address`);
  }
  const pullText = values["--pull"] ?? "1000000";
  if (!/^[1-9][0-9]*$/.test(pullText)) throw new Error(`--pull ${pullText} is not a positive whole number of raw USDC`);
  if (!positional.length) throw new Error("name at least one leg (e.g. hSOL USDC_LEND:kamino_klend)");
  const legs = positional.map(parseLeg);
  const seen = new Set<string>();
  for (const l of legs) { if (seen.has(l.name)) throw new Error(`leg ${l.name} named twice`); seen.add(l.name); }
  return { user: values["--user"], wallet: values["--wallet"], delegation: values["--delegation"], leashed: bools.has("--leashed"), pullRaw: BigInt(pullText),
    noPost: !bools.has("--allow-post"), sizeOnly: bools.has("--size-only") || bools.has("--assume-alt"), assumeAlt: bools.has("--assume-alt"), legs };
}

/** "hSOL" or "USDC_LEND:jupiter_lend": a lending leg needs its venue, a coin leg takes none (buildPlantingTx's own rule). */
export function parseLeg(name: string): Leg {
  const [assetName, venueName, extra] = name.split(":");
  if (extra !== undefined || !isLiveAsset(assetName) || (venueName !== undefined && !isAutoVenue(venueName))) throw new Error(`unknown leg ${name}`);
  const lend = assetName === "USDC_LEND" || assetName === "SOL_LEND";
  if (lend && venueName === undefined) throw new Error(`leg ${name}: a lending leg needs a venue (${name}:kamino_klend or ${name}:jupiter_lend)`);
  if (!lend && venueName !== undefined) throw new Error(`leg ${name}: ${assetName} takes no venue`);
  return { name, asset: assetName, venue: (venueName ?? null) as AutoVenue | null };
}

/**
 * Whether a leg cannot run without POSTING a price (a puller-paid send). Unleashed: never (no price is read). Leashed: SKR (leg 0)
 * while it has no source (R324, SKR_PRICE_SOURCE false), or any leg whose live price source answered "post".
 */
export function needsPost(leg: Leg, leashed: boolean, liveSource?: "none" | "sponsored" | "post"): boolean {
  if (!leashed) return false;
  if (LEG_SPEC[leashLegOf(leg.asset, leg.venue)].feed === "SKR" && !SKR_PRICE_SOURCE) return true;
  return liveSource === "post";
}

/** Account locks of a built v0 transaction: its static keys plus every address loaded from a lookup table. */
export function accountLocks(messageBytes: Uint8Array): number {
  const m = getCompiledTransactionMessageDecoder().decode(messageBytes) as { staticAccounts: readonly unknown[]; addressTableLookups?: readonly { readonlyIndexes: readonly number[]; writableIndexes: readonly number[] }[] };
  return m.staticAccounts.length + (m.addressTableLookups ?? []).reduce((s, l) => s + l.readonlyIndexes.length + l.writableIndexes.length, 0);
}

/** The custom program error in a simulation's logs, named when it is a leash (or Subscriptions) error. */
export function leashErrorOf(logs: readonly string[]): string | null {
  const code = /custom program error: 0x([0-9a-f]+)/i.exec(logs.join(" "))?.[1];
  return code ? (LEASH_ERRORS[parseInt(code, 16)] ?? `0x${code}`) : null;
}

/** buildPlantingTx's over-size refusal carries the measured size; read it back so an over-limit leg still reports its bytes. */
export function sizeFromError(msg: string): number | null {
  const m = /planting is (\d+) bytes, over \d+/.exec(msg);
  return m ? Number(m[1]) : null;
}

export type Built = { sizeBytes: number; locks: number; minOut: bigint; cleanupCount: number };
export type Sim = { ok: boolean; units: number; logs: string[] };
export type LegDeps = {
  /** The leg's live price source (leashed only; called before any build so a "post" leg is skipped before buildPlantingTx could send its VAA). */
  priceSource: (leg: Leg) => Promise<"none" | "sponsored" | "post">;
  build: (leg: Leg, jlLeftover: 0n | 1n | undefined) => Promise<Built>;
  simulate: () => Promise<Sim>;
  /** legShortfall on the last build's simulation (null = delivered). */
  guard: (sim: Sim) => string | null;
  /** cleanupPlanting on the last build (a send: rent reclaim of a posted price). Never called under noPost. */
  cleanup: () => Promise<void>;
  log: (line: string) => void;
};
export type LegResult = { name: string; status: "ok" | "fail" | "skipped" | "built"; line: string; sizeBytes: number | null; locks: number | null; units: number | null; jlLeftover: 0n | 1n | null };

/**
 * One leg as the run plants it: a Jupiter Lend leg tries jlLeftover 0 then 1 (the run's retry) and reports which passed; any other
 * leg one build. noPost: a leg needing a posted price is skipped before any build. sizeOnly: built and measured, never simulated.
 */
export async function runLeg(leg: Leg, o: { leashed: boolean; noPost: boolean; sizeOnly: boolean; assumeAlt?: boolean }, d: LegDeps): Promise<LegResult> {
  const mode = o.leashed ? "leashed" : "unleashed";
  const head = `LEG ${leg.name} ${mode}`;
  const skip = (why: string): LegResult => ({ name: leg.name, status: "skipped", line: `${head} skipped=${why}`, sizeBytes: null, locks: null, units: null, jlLeftover: null });
  if (o.noPost) {
    if (needsPost(leg, o.leashed)) return skip("needs-post");
    if (o.leashed) {
      let src: "none" | "sponsored" | "post";
      try { src = await d.priceSource(leg); } catch (e) { return skip(`no-price (${e instanceof Error ? e.message : String(e)})`); }
      if (needsPost(leg, o.leashed, src)) return skip("needs-post");
    }
  }
  const tries: (0n | 1n | undefined)[] = leg.venue === "jupiter_lend" ? [0n, 1n] : [undefined];
  let last: LegResult | null = null;
  for (const jl of tries) {
    const jlText = jl !== undefined ? ` jlLeftover=${jl}` : "";
    let b: Built;
    try {
      b = await d.build(leg, jl);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const size = sizeFromError(msg);
      last = { name: leg.name, status: "fail", line: `${head}${size !== null ? ` size=${size}` : ""} build failed${jlText}${o.assumeAlt ? " (computed with the Sprouts ALT in memory)" : ""}: ${msg}`, sizeBytes: size, locks: null, units: null, jlLeftover: jl ?? null };
      if (jl !== undefined && jl !== tries[tries.length - 1]) d.log(`  ${last.line}`);
      continue;
    }
    if (o.noPost && b.cleanupCount > 0) throw new Error(`${leg.name}: the build posted a price under --no-post (cleanup ${b.cleanupCount}); stop and investigate`);
    const sizeLocks = `size=${b.sizeBytes} locks=${b.locks}`;
    if (o.sizeOnly) {
      return { name: leg.name, status: "built", line: `${head} ${sizeLocks} ok=n/a (${o.assumeAlt ? "computed with the Sprouts ALT in memory" : "built"}, not simulated) minOut=${b.minOut}${jlText}`, sizeBytes: b.sizeBytes, locks: b.locks, units: null, jlLeftover: jl ?? null };
    }
    const sim = await d.simulate();
    const guard = sim.ok ? d.guard(sim) : null;
    const ok = sim.ok && guard === null;
    const line = `${head} size=${b.sizeBytes} ok=${ok} units=${sim.units} guard=${guard} leashError=${leashErrorOf(sim.logs)} minOut=${b.minOut}${jlText} locks=${b.locks}${ok ? "" : `\n  logs: ${sim.logs.slice(-4).join(" | ")}`}`;
    if (!o.noPost) await d.cleanup().catch((e) => d.log(`  price cleanup failed: ${e instanceof Error ? e.message : String(e)}`));
    last = { name: leg.name, status: ok ? "ok" : "fail", line, sizeBytes: b.sizeBytes, locks: b.locks, units: sim.units, jlLeftover: jl ?? null };
    if (ok) return last;
    if (jl !== undefined && jl !== tries[tries.length - 1]) d.log(`  ${line}`);
  }
  return last as LegResult;
}

/**
 * 0: every leg passed (ok, or built under --size-only). 1: any leg failed (the brief's gate). 2: nothing failed but a leg was
 * skipped, so the gate is NOT passed for it (a skip must never read as a pass).
 */
export function exitCode(results: readonly Pick<LegResult, "status">[]): 0 | 1 | 2 {
  if (results.some((r) => r.status === "fail")) return 1;
  if (results.some((r) => r.status === "skipped")) return 2;
  return 0;
}

/** One summary line: the worst size and lock count across the legs that built, against the limits. */
export function headroom(results: readonly LegResult[]): string {
  const built = results.filter((r) => r.sizeBytes !== null);
  if (!built.length) return "HEADROOM none built";
  const big = built.reduce((a, b) => ((b.sizeBytes as number) > (a.sizeBytes as number) ? b : a));
  const withLocks = built.filter((r) => r.locks !== null);
  const locks = withLocks.length ? withLocks.reduce((a, b) => ((b.locks as number) > (a.locks as number) ? b : a)) : null;
  return `HEADROOM worst size ${big.name} ${big.sizeBytes}/${MAX_TX_BYTES} B (${MAX_TX_BYTES - (big.sizeBytes as number)} B left)` +
    (locks ? `; worst locks ${locks.name} ${locks.locks}/${MAX_ACCOUNT_LOCKS} (${MAX_ACCOUNT_LOCKS - (locks.locks as number)} left)` : "");
}

