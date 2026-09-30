import { z } from "zod";
import type { Repo } from "@/db/repo";
import type { Rules } from "@/domain/roundup";
import type { ModelCall, Usage } from "./anthropic";

export type { ModelCall } from "./anthropic";

/**
 * The watcher (spec 6, R40): Sprouts reads every swap; the model turns that into rules and words, never into money moves. This
 * file is the first feature, rules in plain English: the typed rule and the current rules go in, a patch of the rules' numbers
 * comes out, shown back on the Rules screen as a draft; nothing changes until the user saves it, with the fingerprint a raise asks
 * for (R84). The model is a parameter, so nothing here touches the network in tests.
 */

/** The model could not be read or reached. The route answers a fixed sentence; `usage` is what the failed call still cost. */
export class WatcherError extends Error {
  constructor(message: string, public usage: Usage | null = null) {
    super(message);
  }
}

// Haiku 4.5: $1 per million tokens in, $5 per million out. In microcents (a millionth of a cent), so a call is an integer.
const IN_MICROCENTS_PER_TOKEN = 100;
const OUT_MICROCENTS_PER_TOKEN = 500;
export const costMicrocents = (u: Usage) => u.inputTokens * IN_MICROCENTS_PER_TOKEN + u.outputTokens * OUT_MICROCENTS_PER_TOKEN;

/** The budget (design notes 5): $10 a month in total, and 30 calls per user per day. Every surface has a template behind it. */
export const MONTH_CAP_MICROCENTS = 1_000_000_000;
export const DAY_CAP_CALLS = 30;

/** Null when the watcher may be called; "month" when the month's $10 has gone; "day" when this user has had today's calls. */
export async function watcherBudget(repo: Repo, userPubkey: string, now: Date): Promise<"month" | "day" | null> {
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  if ((await repo.watcherSpendMicrocents(monthStart)) >= MONTH_CAP_MICROCENTS) return "month";
  const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  if ((await repo.watcherCallsBy(userPubkey, dayStart)) >= DAY_CAP_CALLS) return "day";
  return null;
}

// The controls' own ranges and steps (Rules screen, R92): the model may say anything, the compiler snaps and clamps to these.
type Numeric = "pctBps" | "pctThresholdCents" | "plantThresholdCents" | "plantMaxDays" | "dailyCapCents" | "oreShare";
const usd = (cents: number) => `$${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
const plain = (n: number) => String(n);
const BOUNDS: Record<Numeric, { min: number; max: number; step: number; label: string; fmt: (n: number) => string }> = {
  dailyCapCents: { min: 100, max: 2_000, step: 100, label: "The daily limit", fmt: usd },
  plantThresholdCents: { min: 50, max: 2_000, step: 50, label: "Plant at", fmt: usd },
  pctThresholdCents: { min: 1_000, max: 100_000, step: 1_000, label: "The big-swap size", fmt: usd },
  pctBps: { min: 0, max: 500, step: 25, label: "The big-swap rate, in hundredths of a percent,", fmt: plain },
  plantMaxDays: { min: 1, max: 30, step: 1, label: "The wait between plantings, in days,", fmt: plain },
  oreShare: { min: 0, max: 50, step: 10, label: "ORE's share", fmt: plain },
};

const ToolOutput = z.object({
  roundupOn: z.boolean().optional(),
  pctOn: z.boolean().optional(),
  pctBps: z.number().int().optional(),
  pctThresholdCents: z.number().int().optional(),
  plantThresholdCents: z.number().int().optional(),
  plantMaxDays: z.number().int().optional(),
  dailyCapCents: z.number().int().optional(),
  oreShare: z.number().int().optional(),
  understood: z.string().min(1),
  cannot: z.string().nullable().optional(),
}).strict();

const TOOL = {
  name: "set_rules",
  description: "The compiled rule: only the fields the person's words change, and one sentence saying what was set.",
  input_schema: {
    type: "object",
    properties: {
      roundupOn: { type: "boolean", description: "Round every swap up to the next dollar." },
      pctOn: { type: "boolean", description: "Add a percentage of big swaps." },
      pctBps: { type: "integer", description: "That percentage in basis points: 100 is 1%. 0 to 500." },
      pctThresholdCents: { type: "integer", description: "A swap is big from this size, in cents. 1000 to 100000." },
      plantThresholdCents: { type: "integer", description: "Plant when the change reaches this, in cents. 50 to 2000." },
      plantMaxDays: { type: "integer", description: "Plant at least every this many days. 1 to 30." },
      dailyCapCents: { type: "integer", description: "The daily limit, in cents. 100 to 2000." },
      oreShare: { type: "integer", description: "The percent of each planting that grows ORE instead of SKR. 0 to 50, steps of 10." },
      understood: { type: "string", description: "What you set, under 25 words, second person, dollars first, no advice, no exclamation marks. If nothing changes, say so." },
      cannot: { type: ["string", "null"], description: "If they asked for something outside these fields (selling, withdrawing, predictions, other coins, advice): one sentence saying Sprouts does not do it. Otherwise null." },
    },
    required: ["understood"],
  },
};

const SYSTEM = [
  "You compile a savings rule for Sprouts. Sprouts watches a person's swaps: each swap rounds up to the next dollar, and a percentage of big swaps can be added; the change is planted as SKR, and as ORE for the share they choose, once it reaches a threshold, at most a daily limit.",
  "The person typed a rule in plain English. Set only the fields their words ask to change and leave every other field out. Never set a field they did not mention. Money is given in cents.",
  "Sprouts never sells, never withdraws, never predicts and never advises; if they ask for any of that, say so in `cannot` and set nothing for it.",
].join("\n");

export type Compiled = { patch: Partial<Rules>; understood: string; notes: string[]; usage: Usage };

/** The typed rule against the current rules: a patch of what changes, the sentence, the notes on what was clamped or refused. */
export async function compileRule(opts: { text: string; current: Rules; model: ModelCall }): Promise<Compiled> {
  let raw: { input: unknown; usage: Usage };
  try {
    raw = await opts.model({
      system: SYSTEM,
      user: `Current rules: ${JSON.stringify(opts.current)}\nRule: ${opts.text}`,
      tool: TOOL,
      maxTokens: 300,
    });
  } catch {
    throw new WatcherError("The model could not be reached.");
  }
  const parsed = ToolOutput.safeParse(raw.input);
  if (!parsed.success) throw new WatcherError("The model's answer could not be read.", raw.usage);
  const out = parsed.data;

  const patch: Partial<Rules> = {};
  const notes: string[] = [];
  if (out.roundupOn !== undefined && out.roundupOn !== opts.current.roundupOn) patch.roundupOn = out.roundupOn;
  if (out.pctOn !== undefined && out.pctOn !== opts.current.pctOn) patch.pctOn = out.pctOn;
  const fit = (key: Numeric, value: number): number => {
    const b = BOUNDS[key];
    const snapped = Math.round(value / b.step) * b.step;
    if (snapped > b.max) notes.push(`${b.label} tops out at ${b.fmt(b.max)}.`);
    if (snapped < b.min) notes.push(`${b.label} starts at ${b.fmt(b.min)}.`);
    return Math.min(b.max, Math.max(b.min, snapped));
  };
  for (const key of ["pctBps", "pctThresholdCents", "plantThresholdCents", "plantMaxDays", "dailyCapCents"] as const) {
    const value = out[key];
    if (value === undefined) continue;
    const fitted = fit(key, value);
    if (fitted !== opts.current[key]) patch[key] = fitted;
  }
  if (out.oreShare !== undefined) {
    const share = fit("oreShare", out.oreShare);
    if (share !== opts.current.allocation.stORE) patch.allocation = { SKR: 100 - share, stORE: share };
  }
  if (out.cannot) notes.push(out.cannot.trim().slice(0, 300));
  return { patch, understood: out.understood.trim().slice(0, 200), notes, usage: raw.usage };
}
