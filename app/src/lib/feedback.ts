import { api, type MeResponse } from "./api";
import { store } from "./store";

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
export async function sendFeedback(q: Question, choice: string, text: string | undefined, ref?: string): Promise<void> {
  const t = text?.trim();
  await api("/api/feedback", { method: "POST", body: { question: q, ...(ref ? { ref } : {}), choice, ...(t ? { text: t } : {}) } });
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
export const countHomeVisit = (): void => store.set(VISITS, homeVisits() + 1);

/** What Home shows: the message until dismissed; the ask unless its ref was dismissed, and "brought_you" only from the second visit. */
export function cardsFor(
  me: Pick<MeResponse, "message" | "ask"> | null,
  dismissed: string[],
  visits: number,
): { message: MeResponse["message"] | null; ask: MeResponse["ask"] | null } {
  const message = me?.message && !dismissed.includes(me.message.id) ? me.message : null;
  const a = me?.ask;
  const ask = a && !dismissed.includes(a.ref) && (a.question !== "brought_you" || visits >= 2) ? a : null;
  return { message, ask };
}
