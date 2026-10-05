import { z } from "zod";
import type { Repo } from "@/db/repo";
import type { FoundVenueRow, SplitDayRow, VenueDayRow } from "@/db/types";
import { ASSETS, LEND_ASSETS, STOP_ORDER, isLendAsset, sameSplit, zeroSplit, type LendAsset, type LiveAsset, type Split, type Stop } from "@/domain/coins";
import { VENUES, VENUE_NAME, isAutoVenue, pickVenue, venueCandidates, type AutoVenue, type Venue, type VetoReason } from "@/domain/venues";
import { STOPS, STOP_DEFAULTS, STOP_LABEL, stopMax, clampSplit, fallbackSplit, checkWhy, templateWhy, effectiveSplit } from "@/domain/split";
import { dayOf, addDays } from "@/domain/day";
import { growth, priceChange } from "./coin-data";
import { costMicrocents, MONTH_CAP_MICROCENTS } from "./watcher";
import { runToolLoop, type ConversationCall } from "./anthropic";
import { getVenueRates, type FoundPool } from "./venues/rates";

/**
 * The daily decision (spec section 6, R113): one forced tool call per risk stop, the answer clamped to the stop's table and the
 * move limit, the why line checked against the facts, everything persisted raw beside the result; then every managed user's
 * split recomputed around their pins. The model is a parameter: nothing here touches the network in tests.
 */

export type CoinFacts = { asset: LiveAsset; growthPct: number | null; days: number; pricePct: number | null; priceDays: number; tradeable: boolean; noData: boolean };

const Int = z.number().int().min(0).max(100);
const SUM_MESSAGE = "the six numbers must sum to 100";
const badSum = (e: z.ZodError) => e.issues.some((i) => i.message === SUM_MESSAGE);

const Verdict = z.object({ venue: z.enum(["kamino_klend", "jupiter_lend"]), asset: z.enum(["USDC_LEND", "SOL_LEND"]), verdict: z.enum(["ok", "avoid"]), reason: z.enum(["incentive_spike", "near_full", "deposits_fleeing", "data_suspect"]).optional() }).strict()
  .refine((v) => (v.verdict === "avoid") === (v.reason !== undefined), { message: "an avoid needs exactly one reason" });
const Found = z.object({ poolId: z.string().min(1).max(64), note: z.string().min(1).max(140) }).strict();
const Answer = z.object({ SKR: Int, stORE: Int, USDC_LEND: Int, SOL_LEND: Int, hSOL: Int, cbBTC: Int, verdicts: z.array(Verdict).max(4).default([]), found: z.array(Found).max(5).default([]), why: z.string().min(1).max(200) }).strict()
  .refine((o) => ASSETS.reduce((s, a) => s + o[a], 0) === 100, { message: SUM_MESSAGE });

const SET_SPLIT = {
  name: "set_split",
  description: "Today's split of new round-ups across the six legs in whole percents summing to 100, a verdict per auto venue and asset, the scout's pools worth a human look, and one line saying why.",
  input_schema: {
    type: "object",
    properties: {
      SKR: { type: "integer" }, stORE: { type: "integer" }, USDC_LEND: { type: "integer" }, SOL_LEND: { type: "integer" }, hSOL: { type: "integer" }, cbBTC: { type: "integer" },
      verdicts: { type: "array", items: { type: "object", properties: { venue: { enum: ["kamino_klend", "jupiter_lend"] }, asset: { enum: ["USDC_LEND", "SOL_LEND"] }, verdict: { enum: ["ok", "avoid"] }, reason: { enum: ["incentive_spike", "near_full", "deposits_fleeing", "data_suspect"] } }, required: ["venue", "asset", "verdict"] } },
      found: { type: "array", items: { type: "object", properties: { poolId: { type: "string" }, note: { type: "string" } }, required: ["poolId", "note"] } },
      why: { type: "string", description: "One line, under 25 words, second person, plain words, no advice, no exclamation marks, quoting only numbers you were given. When USDC lending gets a share, say where it goes, as in 'Your USDC goes to Kamino, 4.4% vs Jupiter 4.2%'." },
    },
    required: ["SKR", "stORE", "USDC_LEND", "SOL_LEND", "hSOL", "cbBTC", "verdicts", "found", "why"],
  },
};
const GET_VENUE_RATES = { name: "get_venue_rates", description: "Today's measured numbers for one lending venue: supply rate (actual), rewards share, utilization, withdrawable, TVL, and our own 7-day average.", input_schema: { type: "object", properties: { venue: { enum: ["kamino_klend", "jupiter_lend", "kamino_sm_vault", "marginfi", "lulo_protected"] } }, required: ["venue"] } };
const SCOUT_YIELDS = { name: "scout_yields", description: "Single-asset USDC and SOL pools on Solana above $10M TVL from a public yield feed (labels unreliable; display only, money never goes there).", input_schema: { type: "object", properties: {} } };

const system = (stop: Stop) => [
  `You choose how Sprouts splits new round-ups across six coins for its ${STOP_LABEL[stop]} setting. Every number you are given was measured by code.`,
  "Pick whole percents that sum to 100, inside each coin's max and at or above SKR's floor. Prefer measured growth; weigh short spans lightly; a coin marked no data or not tradeable keeps yesterday's share (the code holds it there); move gently from yesterday.",
  "Then write one line, under 25 words, second person, plain words, no advice, no exclamation marks, quoting only numbers from the table, that says why today's split leans where it does.",
  'Say "your coins", "your split": the line speaks to the person whose round-ups these are.',
  // R177: stORE's growth has a source the other coins lack; the line names it when the split leans to stORE.
  'stORE grows from ORE mining fees. When today\'s split leans to stORE, say where its growth comes from, as in "stORE pays the most this week, from ORE mining fees".',
  "Two legs lend: USDC lending and SOL lending. Before you answer, call get_venue_rates for kamino_klend and jupiter_lend (the table-only venues kamino_sm_vault, marginfi and lulo_protected are optional), and scout_yields once if it is offered.",
  "For each auto venue and asset give a verdict: ok, or avoid with one reason: incentive_spike (most of the rate is rewards, or it jumped), near_full (utilization above 90%), deposits_fleeing (TVL falling fast), data_suspect (numbers that disagree). Code picks the venue: the highest 7-day average among eligible venues you did not avoid.",
  "found: up to 5 pool ids from scout_yields worth a human look, each with a short note quoting only its numbers. Money never goes to a found pool.",
].join("\n");

const r1 = (n: number) => Math.round(n * 10) / 10;

/** Every coin's measured facts for the day, from our own rows (spec 5.4): numbers only. */
export async function readFacts(repo: Repo, day: string): Promise<CoinFacts[]> {
  const out: CoinFacts[] = [];
  const venueRows = await repo.listVenueDays(day);
  for (const asset of ASSETS) {
    // Task 1 review: a lending leg's growth is the best eligible, non-vetoed auto venue's own 7-day average (venue_days), never coin_days.
    if (isLendAsset(asset)) {
      const best = venueRows.filter((r) => r.asset === asset && isAutoVenue(r.venue) && r.eligible && r.verdict !== "avoid" && r.avg7Pct !== null).sort((p, q) => (q.avg7Pct as number) - (p.avg7Pct as number))[0];
      out.push({ asset, growthPct: best?.avg7Pct ?? null, days: best?.daysMeasured ?? 0, pricePct: null, priceDays: 0, tradeable: true, noData: !best });
      continue;
    }
    const rows = await repo.listCoinDays(asset, addDays(day, -7));
    const today = rows.find((r) => r.day === day) ?? null;
    const g = asset === "cbBTC" ? { pct: 0, days: 0 } : growth(rows);
    const p = priceChange(rows);
    const noData = asset === "SKR" ? false : !today || !today.ok || !today.tradeable;
    out.push({ asset, growthPct: g.pct, days: g.days, pricePct: p.pct, priceDays: p.days, tradeable: today?.tradeable ?? false, noData });
  }
  return out;
}

/** The user message: plain rows, coin names from the registry, no mint, no URL, nothing from a user. */
export function factsTable(facts: CoinFacts[], stop: Stop, yesterday: Split | null): string {
  const lines = [`Setting: ${STOP_LABEL[stop]}. SKR floor ${STOPS[stop].floor}.`, "coin | growth % a year | days measured | price change % | price days | tradeable | max"];
  for (const f of facts) {
    const g = f.noData ? "no data" : f.growthPct === null ? "collecting" : r1(f.growthPct).toFixed(1);
    const p = f.pricePct === null ? "collecting" : r1(f.pricePct).toFixed(1);
    lines.push(`${f.asset} | ${g} | ${f.days} | ${p} | ${f.priceDays} | ${f.noData ? "no" : "yes"} | ${stopMax(stop, f.asset)}`);
  }
  lines.push(yesterday ? `Yesterday: ${ASSETS.map((a) => `${a} ${yesterday[a]}`).join(", ")}.` : "Yesterday: none, this is the first day.");
  return lines.join("\n");
}

/** Every number the why line may quote (spec 6.4). */
export function factsNumbers(facts: CoinFacts[], stop: Stop, yesterday: Split | null, split: Split): number[] {
  const n: number[] = [STOPS[stop].floor, ...ASSETS.map((a) => stopMax(stop, a)), ...ASSETS.map((a) => split[a])];
  for (const f of facts) {
    if (f.growthPct !== null) n.push(r1(f.growthPct));
    if (f.pricePct !== null) n.push(r1(f.pricePct));
    n.push(f.days, f.priceDays);
  }
  if (yesterday) n.push(...ASSETS.map((a) => yesterday[a]));
  return n;
}

function topCoin(facts: CoinFacts[]): { asset: LiveAsset; pct: number } | null {
  let top: { asset: LiveAsset; pct: number } | null = null;
  for (const f of facts) if (!f.noData && f.growthPct !== null && f.days > 0 && (!top || f.growthPct > top.pct)) top = { asset: f.asset, pct: f.growthPct };
  return top;
}

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

const numbersIn = (v: unknown): number[] => (typeof v === "number" ? [v] : Array.isArray(v) ? v.flatMap(numbersIn) : v && typeof v === "object" ? Object.values(v).flatMap(numbersIn) : []);
const r1s = (n: number) => (Math.round(n * 10) / 10).toFixed(1);
/** Controller ruling (fix round 1): the plain words for each veto reason, used when a higher-rate venue was set aside today. */
const REASON_WORDS: Record<VetoReason, string> = {
  incentive_spike: "most of its rate is temporary rewards",
  near_full: "it is nearly full",
  deposits_fleeing: "deposits are leaving it fast",
  data_suspect: "its numbers disagree today",
};
/**
 * Code's routing sentence for one lending leg (spec 4): where the money goes, against the other eligible auto venue; when a venue
 * with a higher 7-day average was avoided today, it says so and why (controller ruling, fix round 1). Always under 140 characters.
 */
export function routingWhy(asset: LendAsset, pick: AutoVenue | null, rows: VenueDayRow[], cappedFrom: AutoVenue | null = null, because: "cap" | "leash" = "cap"): string {
  const coin = asset === "USDC_LEND" ? "USDC" : "SOL";
  // K-I5: this user's 60% venue cap moved the money off the day's pick: the sentence names where it really goes, and why.
  // Residual O2: or the user's leashed wallet does not allow the day's pick (its leash leg is off).
  if (cappedFrom) {
    const full = because === "leash" ? `your wallet's leash does not take ${coin} to ${VENUE_NAME[cappedFrom]} yet` : `${VENUE_NAME[cappedFrom]} already holds 60% of your lending`;
    const other = because === "leash" ? "no venue it allows" : "no other venue";
    if (!pick) return `${full.charAt(0).toUpperCase()}${full.slice(1)} and ${other} passed today's checks; your ${coin} share goes to the next leg.`;
    const at = rows.find((r) => r.venue === pick && r.asset === asset)?.avg7Pct ?? null;
    return `Your ${coin} goes to ${VENUE_NAME[pick]}${at !== null ? ` at ${r1s(at)}%` : ""}: ${full}.`;
  }
  if (!pick) return `No lending venue passed today's checks; your ${coin} share goes to the next leg.`;
  const mine = rows.find((r) => r.venue === pick && r.asset === asset);
  const pct = mine?.avg7Pct ?? null;
  if (pct === null) return `Your ${coin} goes to ${VENUE_NAME[pick]}.`;
  const avoided = rows.find((r) => r.venue !== pick && isAutoVenue(r.venue) && r.asset === asset && r.verdict === "avoid" && r.reason !== null && r.avg7Pct !== null && r.avg7Pct > pct);
  if (avoided) return `Your ${coin} goes to ${VENUE_NAME[pick]} at ${r1s(pct)}%; ${VENUE_NAME[avoided.venue]}'s ${r1s(avoided.avg7Pct as number)}% was set aside today: ${REASON_WORDS[avoided.reason as VetoReason]}.`;
  const other = rows.find((r) => r.venue !== pick && isAutoVenue(r.venue) && r.asset === asset && r.eligible && r.avg7Pct !== null);
  return other ? `Your ${coin} goes to ${VENUE_NAME[pick]}, ${r1s(pct)}% vs ${VENUE_NAME[other.venue]} ${r1s(other.avg7Pct as number)}%.` : `Your ${coin} goes to ${VENUE_NAME[pick]} at ${r1s(pct)}%.`;
}

/** Review I3: what may be stored for display: plain letters, digits and basic punctuation, no domain-shaped word. */
const SAFE_CHARS = /^[A-Za-z0-9 .,;:'%()/+$-]+$/;
const DOMAIN_SHAPED = /\b[a-z0-9-]+\.[a-z]{2,}\b/i;
/** checkWhy (URLs stripped, whitespace and newlines collapsed, numbers in the facts) plus the allowlist; returns what to STORE. */
export function safeLine(line: string, facts: number[]): string | null {
  const s = checkWhy(line, facts);
  if (s === null || !SAFE_CHARS.test(s) || DOMAIN_SHAPED.test(s) || DOMAIN_SHAPED.test(joinDots(s))) return null;
  return s;
}
/**
 * K-M6: "kamino . finance" must not slip past DOMAIN_SHAPED. Spaces before a dot are dropped, and spaces after one when a lowercase
 * word follows (a sentence end is ". " then a capital in every line we keep, so "a year. SKR" stays two sentences).
 */
const joinDots = (s: string) => s.replace(/\s+\.\s*/g, ".").replace(/\.\s+(?=[a-z])/g, ".");
/** K-M3: a scouted pool's project and symbol (DefiLlama's raw strings) are stored only as plain names: no markup, no invisible or bidi characters, no domain. */
const PLAIN_NAME = /^[A-Za-z0-9][A-Za-z0-9 _-]{0,39}$/;
export const plainName = (s: string): boolean => PLAIN_NAME.test(s) && !DOMAIN_SHAPED.test(joinDots(s));
/** A model sentence that talks about lending (a venue, USDC, SOL, lending) could contradict code's routing: it is not kept. */
const TALKS_LENDING = /kamino|jupiter|marginfi|lulo|\bUSDC\b|\bSOL\b|\blend/i;
export const WHY_MAX = 200;
/** Review I5: the decide step's total budget, so planting (no new wallet past 240 s) always starts well in time. */
export const DECIDE_BUDGET_MS = 90_000;

/**
 * One row per stop for the day. A row that already exists is reused, so a second run the same day calls no model (spec 6.1).
 * Phase 1 asks each stop (a tool loop: the model reads the venues itself, R276/R278); phase 2 writes the day's verdicts and what was
 * served, lets code pick the venue, and settles each why line against every number served.
 * Verdicts are fail-open on silence [decision, Task 4 review]: a venue no stop judged (the model down, a fallback, no verdict given)
 * keeps a null verdict and stays pickable on code's eligibility alone; only an explicit avoid removes it, and any stop's avoid holds.
 */
export async function decideSplits(a: { repo: Repo; now: Date; model: ConversationCall | null; scout?: () => Promise<FoundPool[]>; budgetMs?: number }): Promise<SplitDayRow[]> {
  const day = dayOf(a.now);
  const deadlineMs = Date.now() + (a.budgetMs ?? DECIDE_BUDGET_MS);
  const facts = await readFacts(a.repo, day);
  const noData = facts.filter((f) => f.noData).map((f) => f.asset);
  // A coin with no measured span (cbBTC's constant 0, a collecting coin) is not a measured growth: the fallback skips it (spec 6.5).
  const growthMap: Partial<Record<LiveAsset, number | null>> = Object.fromEntries(facts.map((f) => [f.asset, f.days > 0 ? f.growthPct : null]));
  const allNoData = facts.every((f) => f.asset === "SKR" || f.noData);
  const monthStart = new Date(Date.UTC(a.now.getUTCFullYear(), a.now.getUTCMonth(), 1));
  const overBudget = (await a.repo.watcherSpendMicrocents(monthStart)) >= MONTH_CAP_MICROCENTS;
  const out: SplitDayRow[] = [];
  const servedByVenue = new Map<Venue, unknown>();
  const scouted = new Map<string, FoundPool>();
  const vetoes: { venue: AutoVenue; asset: LendAsset; reason: VetoReason }[] = [];
  const oks: { venue: AutoVenue; asset: LendAsset }[] = [];
  const foundRows: FoundVenueRow[] = [];
  const pending: { row: SplitDayRow; modelWhy: string | null; facts: number[] }[] = [];
  const servedNumbers: number[] = [];
  for (const stop of STOP_ORDER) {
    const existing = await a.repo.getSplitDay(day, stop);
    if (existing) {
      out.push(existing);
      continue;
    }
    const yesterday = (await a.repo.latestSplitDay(stop, day))?.split ?? null;
    const row: SplitDayRow = { day, stop, split: zeroSplit(), modelAnswer: null, why: null, fallback: null, callId: null, venuePick: null };
    let modelWhy: string | null = null;
    const byRule = (reason: string) => {
      row.split = fallbackSplit({ stop, growth: growthMap, noData, yesterday });
      row.fallback = reason;
    };
    if (allNoData) {
      // Spec 5.5: every coin failed, so yesterday's split stands whatever the model's state, and no model is called: with every
      // coin held at yesterday's share (R132) the clamp could only hand back the same split, so a call would buy nothing.
      row.split = yesterday ?? STOP_DEFAULTS[stop];
      row.fallback = "no data";
    } else if (!a.model) byRule("model");
    else if (overBudget) byRule("budget");
    else {
      const model = a.model;
      const tools = [GET_VENUE_RATES, ...(a.scout && process.env.SCOUT_ENABLED !== "false" ? [SCOUT_YIELDS] : []), SET_SPLIT];
      const run = async (name: string, input: unknown) => {
        if (name === "get_venue_rates") {
          const venue = (input as { venue?: string })?.venue;
          if (!venue || !(VENUES as readonly string[]).includes(venue)) throw new Error(`unknown venue ${venue}`);
          const out = await getVenueRates(a.repo, day, venue as Venue);
          servedByVenue.set(venue as Venue, out);
          return out;
        }
        if (name === "scout_yields" && a.scout && process.env.SCOUT_ENABLED !== "false") {
          const out = await a.scout();
          for (const p of out) scouted.set(p.poolId, p);
          return out;
        }
        throw new Error(`unknown tool ${name}`);
      };
      // One tool loop: recorded against the budget and kept raw beside the row, whatever the answer; null when the model was not
      // reached or never called set_split within the turn limit.
      const ask = async () => {
        let raw: Awaited<ReturnType<typeof runToolLoop>>;
        if (Date.now() >= deadlineMs) {
          console.error(`split ${stop}: the decide step's ${a.budgetMs ?? DECIDE_BUDGET_MS} ms budget is spent; falling back by rule`);
          return null;
        }
        try {
          raw = await runToolLoop({ call: model, system: system(stop), user: factsTable(facts, stop, yesterday), tools, finalTool: "set_split", maxTurns: 6, maxTokens: 600, run, deadlineMs });
        } catch (e) {
          console.error(`split ${stop}: the model could not be reached: ${msg(e)}`);
          return null;
        }
        row.callId = await a.repo.addWatcherCall({ userPubkey: null, kind: "split", inputTokens: raw.usage.inputTokens, outputTokens: raw.usage.outputTokens, costMicrocents: costMicrocents(raw.usage) });
        servedNumbers.push(...numbersIn(raw.served.map((x) => x.output)));
        if (raw.final === null) return null;
        row.modelAnswer = raw.final;
        return Answer.safeParse(raw.final);
      };
      let parsed = await ask();
      if (parsed && !parsed.success && badSum(parsed.error)) {
        // R133: six numbers that do not sum to 100 get one more try with the same prompt before the fallback; the second call
        // counts against the budget like the first, and the row keeps the answer that was judged last.
        console.error(`split ${stop}: the six numbers did not sum to 100 (${JSON.stringify(row.modelAnswer)}); asking once more`);
        parsed = (await ask()) ?? parsed;
      }
      if (!parsed) byRule("model");
      else if (!parsed.success) byRule("schema");
      else {
        const { why, verdicts, found, ...numbers } = parsed.data;
        for (const v of verdicts) {
          if (v.verdict === "avoid") vetoes.push({ venue: v.venue, asset: v.asset, reason: v.reason as VetoReason });
          else oks.push({ venue: v.venue, asset: v.asset });
        }
        for (const f of found) {
          const pool = scouted.get(f.poolId);
          if (pool && plainName(pool.project) && plainName(pool.symbol)) foundRows.push({ day, poolId: pool.poolId, project: pool.project, symbol: pool.symbol, asset: pool.asset, apyBasePct: pool.apyBasePct, tvlUsd: pool.tvlUsd, note: f.note });
        }
        const clamped = clampSplit({ stop, proposed: numbers as Split, noData, yesterday });
        if (!clamped) byRule("bounds");
        else {
          row.split = clamped;
          modelWhy = why;
        }
      }
    }
    pending.push({ row, modelWhy, facts: factsNumbers(facts, stop, yesterday, row.split) });
  }

  // Verdicts: an avoid from any stop holds for the day [decision: fail-safe]; an ok is recorded only where nobody avoided.
  const today = await a.repo.listVenueDays(day);
  for (const r of today) {
    if (!isAutoVenue(r.venue)) {
      if (servedByVenue.has(r.venue)) await a.repo.putVenueDay({ ...r, served: servedByVenue.get(r.venue) ?? null });
      continue;
    }
    const veto = vetoes.find((v) => v.venue === r.venue && v.asset === r.asset);
    const ok = oks.some((v) => v.venue === r.venue && v.asset === r.asset);
    await a.repo.putVenueDay({ ...r, verdict: veto ? "avoid" : ok ? "ok" : r.verdict, reason: veto ? veto.reason : r.verdict === "avoid" ? r.reason : null, served: servedByVenue.get(r.venue) ?? r.served });
  }
  const after = await a.repo.listVenueDays(day);
  const yesterdayRows = await a.repo.listVenueDays(addDays(day, -1));
  // Code's pick before the per-user 60% cap (the planting run applies the cap with each user's positions).
  const venuePick: Partial<Record<LendAsset, AutoVenue | null>> = {};
  for (const asset of LEND_ASSETS) venuePick[asset] = pickVenue({ candidates: venueCandidates(asset, after, yesterdayRows), lendingUsdByProtocol: {}, addUsd: 0 });
  const allFacts = (f: number[]) => [...f, ...servedNumbers];
  for (const p of pending) {
    p.row.venuePick = venuePick;
    // Controller ruling (fix round 1, review I1/I2): CODE owns the routing whenever lending gets a share; the model's line may only
    // add a sentence that says nothing about lending, checked as before.
    const routed = LEND_ASSETS.filter((l) => p.row.split[l] > 0);
    const checked = p.modelWhy === null ? null : safeLine(p.modelWhy, allFacts(p.facts));
    if (!routed.length) p.row.why = checked ?? templateWhy({ stop: p.row.stop, top: topCoin(facts) });
    else {
      const routing = routed.map((l) => routingWhy(l, venuePick[l] ?? null, after)).join(" ");
      const extra = checked !== null && !TALKS_LENDING.test(checked) ? checked : null;
      p.row.why = extra !== null && routing.length + 1 + extra.length <= WHY_MAX ? `${routing} ${extra}` : routing;
    }
    await a.repo.putSplitDay(p.row);
    out.push(p.row);
  }
  // Review I3: a note is stored as the checked string (URLs stripped, one line, allowlisted), never the raw model text.
  const notes = foundRows.flatMap((f) => { const note = f.note === null ? null : safeLine(f.note, servedNumbers); return note === null ? [] : [{ ...f, note }]; });
  await a.repo.putFoundVenues([...new Map(notes.map((f) => [f.poolId, f])).values()]);
  return STOP_ORDER.map((s) => out.find((r) => r.stop === s) as SplitDayRow);
}

/** Every managed user's split from their stop's row and their pins (spec 6.6); unchanged users get no event. */
export async function applyToUsers(a: { repo: Repo; now: Date }): Promise<{ changed: string[] }> {
  const day = dayOf(a.now);
  const changed: string[] = [];
  for (const r of await a.repo.listManagedRules()) {
    const row = (await a.repo.getSplitDay(day, r.stop)) ?? (await a.repo.latestSplitDay(r.stop));
    const stopSplit = row?.split ?? STOP_DEFAULTS[r.stop];
    const next = effectiveSplit({ managed: true, stop: r.stop, pins: r.pins, stopSplit });
    if (sameSplit(next, r.allocation)) continue;
    await a.repo.saveRules(r.userPubkey, { prevAllocation: r.allocation, allocation: next, allocationDay: day });
    await a.repo.addEvent({ userPubkey: r.userPubkey, walletPubkey: null, kind: "split_changed", detail: { by: "manager", from: r.allocation, to: next, stop: r.stop, why: row?.why ?? null, fallback: row?.fallback ?? null, day } });
    changed.push(r.userPubkey);
  }
  return { changed };
}
