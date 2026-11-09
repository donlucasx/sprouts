import { api, type MeResponse } from "./api";
import { store } from "./store";
import { localDay } from "./reminders";

export type Question = "link_failed" | "wallet_removed" | "brought_you";

/** Copy D and E, verbatim. The values are the ones POST /api/feedback accepts (api/src/domain/asks.ts FEEDBACK_OPTIONS). */
export const QUESTIONS: Record<Question, { title: string; options: { value: string; label: string }[] }> = {
  link_failed: {
    title: "What happened?",
    options: [
      { value: "backed_out", label: "I backed out" },
      { value: "closed_itself", label: "The screen closed by itself" },
      { value: "warning_worried", label: "The approval warning worried me" },
      { value: "other", label: "Something else" },
    ],
  },
  wallet_removed: {
    title: "Before you go: why did you remove it?",
    options: [
      { value: "testing", label: "I just wanted to test it" },
      { value: "approval", label: "I didn't like the approval" },
      { value: "not_planting", label: "It wasn't planting" },
      { value: "need_usdc", label: "I need the USDC for something else" },
      { value: "other", label: "Something else" },
    ],
  },
  brought_you: {
    title: "What brought you to Sprouts?",
    options: [
      { value: "skr_staking", label: "Staking and unstaking SKR" },
      { value: "roundups", label: "Round-up savings" },
      { value: "looking", label: "Just looking around" },
      { value: "other", label: "Something else" },
    ],
  },
};

export const TEXT_MAX = 500;

/** Posts one answer. Throws on failure so the card stays; the caller shows the one-line error. */
export async function sendFeedback(q: Question, choice: string, text: string | undefined, ref?: string, email?: string): Promise<string | null> {
  const t = text?.trim();
  const e = email?.trim();
  // 11-08: an answer with a note or an email comes back with its message reference (S-XXXX); a one-tap answer has none
  const r = await api<{ ref?: unknown }>("/api/feedback", { method: "POST", body: { question: q, ...(ref ? { ref } : {}), choice, ...(t ? { text: t } : {}), ...(e ? { email: e } : {}) } });
  return typeof r?.ref === "string" ? r.ref : null;
}

const DISMISSED = "feedback.dismissed";
const VISITS = "feedback.homeVisits";

/** Message ids and ask refs the user closed or answered, kept on this phone only. */
export function readDismissed(): string[] {
  try {
    const v: unknown = JSON.parse(store.getString(DISMISSED) ?? "[]");
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}
export function dismiss(id: string): void {
  const all = readDismissed();
  if (!all.includes(id)) store.set(DISMISSED, JSON.stringify([...all, id]));
}

export const homeVisits = (): number => store.getNumber(VISITS) ?? 0;
const VISIT_DAY = "feedback.homeVisitDay";
/** A visit counts at most once per local day, so "after their second visit" means a second day, not a tab switch. */
export function countHomeVisit(now: Date = new Date()): void {
  const day = localDay(now);
  if (store.getString(VISIT_DAY) === day) return;
  store.set(VISIT_DAY, day);
  store.set(VISITS, homeVisits() + 1);
}

/** What Home shows: the message until dismissed; the ask unless its ref was dismissed, and "brought_you" only from the second visit. */
export function cardsFor(
  me: Pick<MeResponse, "message" | "ask"> | null,
  dismissed: string[],
  visits: number,
): { message: MeResponse["message"] | null; ask: MeResponse["ask"] | null } {
  // Shape-checked: a newer server value or a bad cached read must never reach the card (QuestionCard would read undefined.title).
  const m = me?.message;
  const message = m && typeof m.id === "string" && typeof m.heading === "string" && typeof m.body === "string" && !dismissed.includes(m.id) ? m : null;
  // 11-08 (his device note: "From Lucas" and a question together = "too cluttered"): Home shows one card. The removed-wallet
  // question lives in Settings under Linked wallets (removedAskFor); "What brought you?" waits until From Lucas is closed.
  const a = validAsk(me?.ask, dismissed);
  const ask = !message && a && a.question === "brought_you" && visits >= 2 ? a : null;
  return { message, ask };
}

/** Settings > Linked wallets: the server's "why did you remove it?" for a wallet removed anywhere (in the app or on the web). */
export function removedAskFor(me: Pick<MeResponse, "ask"> | null, dismissed: string[]): MeResponse["ask"] | null {
  const a = validAsk(me?.ask, dismissed);
  return a && a.question === "wallet_removed" ? a : null;
}

function validAsk(a: MeResponse["ask"] | undefined, dismissed: string[]): MeResponse["ask"] | null {
  const known = !!a && typeof a.question === "string" && Object.prototype.hasOwnProperty.call(QUESTIONS, a.question) && typeof a.ref === "string";
  return a && known && !dismissed.includes(a.ref) ? a : null;
}
