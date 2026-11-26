import type { Usage } from "./anthropic";

/**
 * The AI budget the daily Yield Manager (split-run.ts) draws on. Haiku 5.5: $0.10 per million tokens in, $0.50 per million out
 * (prompts under 100K tokens). In microcents (a millionth of a cent), so a call is an integer. Every surface has a template behind
 * it, so hitting the cap changes nothing but the model's silence.
 */
const IN_MICROCENTS_PER_TOKEN = 10;
const OUT_MICROCENTS_PER_TOKEN = 50;
export const costMicrocents = (u: Usage) => u.inputTokens * IN_MICROCENTS_PER_TOKEN + u.outputTokens * OUT_MICROCENTS_PER_TOKEN;

/** $10 a month in total (design notes 5). */
export const MONTH_CAP_MICROCENTS = 1_000_000_000;
