import { z } from "zod";
import type { Repo } from "@/db/repo";
import type { SplitDayRow } from "@/db/types";
import { ASSETS, STOP_ORDER, sameSplit, zeroSplit, type Asset, type Split, type Stop } from "@/domain/coins";
import { STOPS, STOP_DEFAULTS, STOP_LABEL, stopMax, clampSplit, fallbackSplit, checkWhy, templateWhy, effectiveSplit } from "@/domain/split";
import { dayOf, addDays } from "@/domain/day";
import { growth, priceChange } from "./coin-data";
import { costMicrocents, MONTH_CAP_MICROCENTS } from "./watcher";
import type { ModelCall, Usage } from "./anthropic";

/**
 * The daily decision (spec section 6, R113): one forced tool call per risk stop, the answer clamped to the stop's table and the
 * move limit, the why line checked against the facts, everything persisted raw beside the result; then every managed user's
 * split recomputed around their pins. The model is a parameter: nothing here touches the network in tests.
 */

export type CoinFacts = { asset: Asset; growthPct: number | null; days: number; pricePct: number | null; priceDays: number; tradeable: boolean; noData: boolean };

const Int = z.number().int().min(0).max(100);
const SUM_MESSAGE = "the six numbers must sum to 100";
const Answer = z.object({ SKR: Int, stORE: Int, hSOL: Int, JitoSOL: Int, JupSOL: Int, cbBTC: Int, why: z.string().min(1).max(200) }).strict()
  .refine((o) => ASSETS.reduce((s, a) => s + o[a], 0) === 100, { message: SUM_MESSAGE });
const badSum = (e: z.ZodError) => e.issues.some((i) => i.message === SUM_MESSAGE);

const TOOL = {
  name: "set_split",
  description: "Today's split of new round-ups across the six coins, in whole percents summing to 100, and one line saying why.",
  input_schema: {
    type: "object",
    properties: {
      SKR: { type: "integer" }, stORE: { type: "integer" }, hSOL: { type: "integer" }, JitoSOL: { type: "integer" }, JupSOL: { type: "integer" }, cbBTC: { type: "integer" },
      why: { type: "string", description: "One line, under 25 words, second person, plain words, no advice, no exclamation marks, quoting only numbers from the table, saying why today's split leans where it does." },
    },
    required: ["SKR", "stORE", "hSOL", "JitoSOL", "JupSOL", "cbBTC", "why"],
  },
};

const system = (stop: Stop) => [
  `You choose how Sprouts splits new round-ups across six coins for its ${STOP_LABEL[stop]} setting. Every number you are given was measured by code.`,
  "Pick whole percents that sum to 100, inside each coin's max and at or above SKR's floor. Prefer measured growth; weigh short spans lightly; a coin marked no data or not tradeable keeps yesterday's share (the code holds it there); move gently from yesterday.",
  "Then write one line, under 25 words, second person, plain words, no advice, no exclamation marks, quoting only numbers from the table, that says why today's split leans where it does.",
  'Say "your coins", "your split": the line speaks to the person whose round-ups these are.',
].join("\n");

const r1 = (n: number) => Math.round(n * 10) / 10;

/** Every coin's measured facts for the day, from our own rows (spec 5.4): numbers only. */
export async function readFacts(repo: Repo, day: string): Promise<CoinFacts[]> {
  const out: CoinFacts[] = [];
  for (const asset of ASSETS) {
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

function topCoin(facts: CoinFacts[]): { asset: Asset; pct: number } | null {
  let top: { asset: Asset; pct: number } | null = null;
  for (const f of facts) if (!f.noData && f.growthPct !== null && f.days > 0 && (!top || f.growthPct > top.pct)) top = { asset: f.asset, pct: f.growthPct };
  return top;
}

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** One row per stop for the day. A row that already exists is reused, so a second run the same day calls no model (spec 6.1). */
export async function decideSplits(a: { repo: Repo; now: Date; model: ModelCall | null }): Promise<SplitDayRow[]> {
  const day = dayOf(a.now);
  const facts = await readFacts(a.repo, day);
  const noData = facts.filter((f) => f.noData).map((f) => f.asset);
  // A coin with no measured span (cbBTC's constant 0, a collecting coin) is not a measured growth: the fallback skips it (spec 6.5).
  const growthMap: Partial<Record<Asset, number | null>> = Object.fromEntries(facts.map((f) => [f.asset, f.days > 0 ? f.growthPct : null]));
  const allNoData = facts.every((f) => f.asset === "SKR" || f.noData);
  const monthStart = new Date(Date.UTC(a.now.getUTCFullYear(), a.now.getUTCMonth(), 1));
  const overBudget = (await a.repo.watcherSpendMicrocents(monthStart)) >= MONTH_CAP_MICROCENTS;
  const out: SplitDayRow[] = [];
  for (const stop of STOP_ORDER) {
    const existing = await a.repo.getSplitDay(day, stop);
    if (existing) {
      out.push(existing);
      continue;
    }
    const yesterday = (await a.repo.latestSplitDay(stop, day))?.split ?? null;
    const row: SplitDayRow = { day, stop, split: zeroSplit(), modelAnswer: null, why: null, fallback: null, callId: null };
    const byRule = (reason: string) => {
      row.split = fallbackSplit({ stop, growth: growthMap, noData, yesterday });
      row.fallback = reason;
    };
    if (allNoData) {
      // Spec 5.5: every coin failed, so yesterday's split stands whatever the model's state (no clamp: the clamp would zero
      // every no-data coin, and the move limit would then hold each coin to 10 points a day on the way back).
      row.split = yesterday ?? STOP_DEFAULTS[stop];
      row.fallback = "no data";
    } else if (!a.model) byRule("model");
    else if (overBudget) byRule("budget");
    else {
      const model = a.model;
      const prompt = { system: system(stop), user: factsTable(facts, stop, yesterday), tool: TOOL, maxTokens: 200 };
      // One call: recorded against the budget and kept raw beside the row, whatever the answer; null when the model was not reached.
      const ask = async () => {
        let raw: { input: unknown; usage: Usage };
        try {
          raw = await model(prompt);
        } catch (e) {
          console.error(`split ${stop}: the model could not be reached: ${msg(e)}`);
          return null;
        }
        row.callId = await a.repo.addWatcherCall({ userPubkey: null, kind: "split", inputTokens: raw.usage.inputTokens, outputTokens: raw.usage.outputTokens, costMicrocents: costMicrocents(raw.usage) });
        row.modelAnswer = raw.input;
        return Answer.safeParse(raw.input);
      };
      let parsed = await ask();
      if (parsed && !parsed.success && badSum(parsed.error)) {
        // R133: six numbers that do not sum to 100 get one more try with the same prompt before the fallback; the second call
        // counts against the budget like the first, and the row keeps the answer that was judged last.
        console.error(`split ${stop}: the six numbers did not sum to 100 (${JSON.stringify(row.modelAnswer)}); asking once more`);
        parsed = (await ask()) ?? parsed;
      }
      if (!parsed) byRule("model");
      else {
        if (!parsed.success) byRule("schema");
        else {
          const { why, ...numbers } = parsed.data;
          const clamped = clampSplit({ stop, proposed: numbers as Split, noData, yesterday });
          if (!clamped) byRule("bounds");
          else {
            row.split = clamped;
            row.why = checkWhy(why, factsNumbers(facts, stop, yesterday, clamped));
          }
        }
      }
    }
    if (row.why === null) row.why = templateWhy({ stop, top: topCoin(facts) });
    await a.repo.putSplitDay(row);
    out.push(row);
  }
  return out;
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
