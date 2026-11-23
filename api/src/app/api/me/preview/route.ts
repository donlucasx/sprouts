import { NextResponse } from "next/server";
import { rateLimited, requireSession } from "@/lib/auth-guard";
import { getRepo } from "@/db/repo";
import { rulesRowToRules } from "@/db/types";
import { sharedPriceUsd } from "@/lib/shared-reads";
import { heliusParsedPage } from "@/lib/helius";
import { cached } from "@/lib/memo";
import { PREVIEW_CACHE_MS, previewTotals, walletSwaps } from "@/lib/preview";
import type { PriceLookup } from "@/domain/sizing";

export const runtime = "nodejs";
export const maxDuration = 30;

const boundedPrice: PriceLookup = (mint) =>
  Promise.race([sharedPriceUsd(mint), new Promise<null>((resolve) => setTimeout(() => resolve(null), 800))]);

/**
 * 11-12 (his ruling): Home's preview for a user with no wallet linked: what the signed-in wallet's swaps of the last 30 days would
 * have saved under their rules, and under "add 10 cents to every swap". Read from the public chain on request; nothing is stored.
 * 503 when the history cannot be read, so the app shows its plain prompt instead of a wrong number. 11-19 (Season economics): the
 * swaps read are kept 24 h per user in this instance (a failed read is not kept); the totals are worked out on every request, so a
 * rules change shows at once.
 */
export async function GET(request: Request) {
  const session = await requireSession(request);
  if (session instanceof NextResponse) return session;
  // Up to 2 history pages per read share the Helius quota the swap webhook needs: 3 reads a minute per user (the app also
  // keeps the answer for 12 hours).
  if (rateLimited(`preview:${session.pubkey}`, 3)) return NextResponse.json({ error: "Too many requests. Try again in a minute." }, { status: 429 });
  const repo = await getRepo();
  // Only for a user with no wallet linked (Home asks only then; review 11-12: the route must not read history for anyone else).
  if ((await repo.listWalletsOf(session.pubkey)).some((w) => w.status !== "revoked")) return NextResponse.json({ error: "Only for a user with no wallet linked." }, { status: 409 });
  const rules = rulesRowToRules(await repo.getRules(session.pubkey));
  try {
    const { swaps, partial } = await cached(
      `preview|${session.pubkey}`,
      () => walletSwaps(session.pubkey, { fetchPage: heliusParsedPage, priceUsd: boundedPrice, nowS: Math.floor(Date.now() / 1000) }),
      () => true,
      PREVIEW_CACHE_MS,
    );
    return NextResponse.json(previewTotals(swaps, rules, partial));
  } catch (e) {
    console.error(`/api/me/preview: the history could not be read (${e instanceof Error ? e.message : String(e)})`);
    return NextResponse.json({ error: "The preview is not available right now." }, { status: 503 });
  }
}
