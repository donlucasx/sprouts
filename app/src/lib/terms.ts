import { t } from "@/i18n";
import type { MeResponse } from "./api";
import { TERMS_MD } from "./terms-text";
import { TERMS_MD_ES } from "./terms-text-es";
import type { Lang } from "@/i18n";
import { dayMonthYear } from "@/i18n/format"

/** Contracts 5.6 (DECIDED 10-04): the version the API records at sign-in and on POST /api/terms. */
export const TERMS_VERSION = "2026-11-23";
export type TermsBlock = { kind: "title" | "heading" | "para" | "bullet"; text: string };
const SUMMARY = "## In three lines";

/** The page, as blocks: everything before the three-line summary (that section is for the "I agree" screen). */
export function termsBlocks(md: string = TERMS_MD): TermsBlock[] {
  return md
    .split(SUMMARY)[0]
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .map((l): TermsBlock =>
      l.startsWith("# ") ? { kind: "title", text: l.slice(2) } : l.startsWith("## ") ? { kind: "heading", text: l.slice(3) } : l.startsWith("- ") ? { kind: "bullet", text: l.slice(2) } : { kind: "para", text: l },
    );
}
/** 0.1.13 Spanish pass P10: the text the Terms page shows. Spanish (a courtesy translation) when the app is in Spanish, unless the reader
 *  asked for the binding English. Only the text changes: the version and what accepting records are the same in every language. */
export function termsText(lang: Lang, binding = false): string {
  return lang === "es" && !binding ? TERMS_MD_ES : TERMS_MD;
}
/** The page's title and the blocks under it. The Spanish opens with its courtesy line before the title, so the title is found, not
 *  assumed first; for the English this is blocks[0] and blocks.slice(1), as before. */
export function termsPage(md: string = TERMS_MD): { title: string | undefined; body: TermsBlock[] } {
  const all = termsBlocks(md);
  const i = all.findIndex((b) => b.kind === "title");
  return i < 0 ? { title: undefined, body: all } : { title: all[i].text, body: [...all.slice(0, i), ...all.slice(i + 1)] };
}
/** The three lines the acceptance screen shows. */
export function termsSummary(md: string = TERMS_MD): string[] {
  return (md.split(SUMMARY)[1] ?? "").split("\n").map((l) => l.trim()).filter((l) => l.startsWith("- ")).map((l) => l.slice(2));
}
/** 0.1.13 Spanish pass P6 (e): Home's Terms card shows the three lines in the current language (a courtesy; the Terms page and its own
 *  summary stay the binding English). The en lines are termsSummary() word for word (terms test). */
export const TERMS_SUMMARY_KEYS = ["terms.summary.1", "terms.summary.2", "terms.summary.3"] as const;
export const homeTermsSummary = (): string[] => TERMS_SUMMARY_KEYS.map((k) => t(k));
/** A signed-in user is asked to accept only when the API says the current version is not the accepted one; an older API never asks. */
export function termsNeeded(me: Pick<MeResponse, "terms"> | null | undefined): boolean {
  return !!me?.terms && me.terms.acceptedVersion !== me.terms.currentVersion;
}

/** What the Terms page offers a signed-in user: "agree" when the API asks for the bundled version or an older one (the text shown is at least as new), "update" only when the API is newer than the bundle (date strings compare lexically), null when nothing is owed. */
export function termsAction(me: Pick<MeResponse, "terms"> | null | undefined): "agree" | "update" | null {
  if (!termsNeeded(me)) return null;
  return (me?.terms?.currentVersion ?? "") <= TERMS_VERSION ? "agree" : "update";
}
/** The cached read with the accepted version filled in from the POST's answer, so Home drops its card at once. */
export function withAccepted<T extends { terms?: MeResponse["terms"] }>(me: T, version: string): T {
  return me.terms ? { ...me, terms: { ...me.terms, acceptedVersion: version } } : me;
}

/** Signing in records the acceptance on the server (/api/auth/verify), so the saved last read must agree: the same user's read is stamped accepted now; another user's (or none) gives null and the caller clears it. */
export function stampSignIn(last: MeResponse | null, pubkey: string): MeResponse | null {
  if (!last || last.user.pubkey !== pubkey) return null;
  const stamped = withAccepted(last, TERMS_VERSION);
  return stamped.terms ? { ...stamped, terms: { ...stamped.terms, acceptedAt: new Date().toISOString() } } : stamped;
}

/** "You agreed to these Terms on Nov 7, 2026." when nothing is owed and the API gave a date; the date is in the phone's zone unless one is passed (tests). */
export function agreedLine(me: Pick<MeResponse, "terms"> | null | undefined, timeZone?: string): string | null {
  const at = me?.terms?.acceptedAt;
  if (!at || termsNeeded(me)) return null;
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return null;
  return t("terms.agreed", { date: dayMonthYear(d, undefined, timeZone) });
}
