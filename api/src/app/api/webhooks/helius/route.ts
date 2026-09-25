import { NextResponse, after } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { getRepo } from "@/db/repo";
import { config } from "@/lib/config";
import { bookSwap, type HeliusEnhancedTx } from "@/lib/book-swap";
import { priceUsd } from "@/lib/jupiter";
import type { PriceLookup } from "@/domain/sizing";

export const runtime = "nodejs";

const PRICE_TIMEOUT_MS = 800;

/** A price lookup that gives up after 800 ms: an unpriced swap books zero rather than losing the event. */
const boundedPrice: PriceLookup = (mint) =>
  Promise.race([priceUsd(mint), new Promise<null>((resolve) => setTimeout(() => resolve(null), PRICE_TIMEOUT_MS))]);

function authorized(header: string | null): boolean {
  const expected = Buffer.from(`Bearer ${config().heliusWebhookSecret}`);
  const given = Buffer.from(header ?? "");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/**
 * Helius requires a 200 within one second and drops the event after three retries, so the route acknowledges first and
 * books afterwards. A malformed item is logged and skipped; the signature is the primary key, so retries never double-book.
 */
export async function POST(request: Request) {
  if (!authorized(request.headers.get("authorization"))) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  const body = (await request.json().catch(() => null)) as unknown;
  const items = Array.isArray(body) ? (body as HeliusEnhancedTx[]) : [];

  after(async () => {
    const repo = await getRepo();
    for (const tx of items) {
      try {
        const r = await bookSwap({ repo, tx, priceUsd: boundedPrice });
        if (r.booked) console.log(`booked ${tx.signature} for ${r.walletPubkey}: ${r.roundupCents} cents`);
      } catch (e) {
        console.error(`webhook item failed ${tx?.signature ?? "?"}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  });

  return NextResponse.json({ received: items.length });
}
