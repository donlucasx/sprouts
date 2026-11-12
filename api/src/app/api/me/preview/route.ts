import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth-guard";
import { getRepo } from "@/db/repo";
import { rulesRowToRules } from "@/db/types";
import { priceUsd } from "@/lib/jupiter";
import { heliusPage, previewTotals, walletSwaps } from "@/lib/preview";
import type { PriceLookup } from "@/domain/sizing";

export const runtime = "nodejs";
export const maxDuration = 30;

const boundedPrice: PriceLookup = (mint) =>
  Promise.race([priceUsd(mint), new Promise<null>((resolve) => setTimeout(() => resolve(null), 800))]);

/**
 * 11-12 (his ruling): Home's preview for a user with no wallet linked: what the signed-in wallet's swaps of the last 30 days would
 * have saved under their rules, and under "add 10 cents to every swap". Read from the public chain on request; nothing is stored.
 * 503 when the history cannot be read, so the app shows its plain prompt instead of a wrong number.
 */
export async function GET(request: Request) {
  const session = await requireSession(request);
  if (session instanceof NextResponse) return session;
  const repo = await getRepo();
  const rules = rulesRowToRules(await repo.getRules(session.pubkey));
  try {
    const { swaps, partial } = await walletSwaps(session.pubkey, { fetchPage: heliusPage, priceUsd: boundedPrice, nowS: Math.floor(Date.now() / 1000) });
    return NextResponse.json(previewTotals(swaps, rules, partial));
  } catch (e) {
    console.error(`/api/me/preview: the history could not be read (${e instanceof Error ? e.message : String(e)})`);
    return NextResponse.json({ error: "The preview is not available right now." }, { status: 503 });
  }
}
