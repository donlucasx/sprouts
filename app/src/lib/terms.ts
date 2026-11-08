import type { MeResponse } from "./api";
import { TERMS_MD } from "./terms-text";

/** Contracts 5.6 (DECIDED 10-04): the version the API records at sign-in and on POST /api/terms. */
export const TERMS_VERSION = "2026-11-01";
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
/** The three lines the acceptance screen shows. */
export function termsSummary(md: string = TERMS_MD): string[] {
  return (md.split(SUMMARY)[1] ?? "").split("\n").map((l) => l.trim()).filter((l) => l.startsWith("- ")).map((l) => l.slice(2));
}
/** A signed-in user is asked to accept only when the API says the current version is not the accepted one; an older API never asks. */
export function termsNeeded(me: Pick<MeResponse, "terms"> | null | undefined): boolean {
  return !!me?.terms && me.terms.acceptedVersion !== me.terms.currentVersion;
}

/** What the Terms page offers a signed-in user: "agree" when the page's bundled text is the version the API asks for, "update" when the API has moved on (the text shown would not be the one accepted), null when nothing is owed. */
export function termsAction(me: Pick<MeResponse, "terms"> | null | undefined): "agree" | "update" | null {
  if (!termsNeeded(me)) return null;
  return me?.terms?.currentVersion === TERMS_VERSION ? "agree" : "update";
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
  return `You agreed to these Terms on ${d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone })}.`;
}
