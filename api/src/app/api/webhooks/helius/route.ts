import { NextResponse, after } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { getRepo } from "@/db/repo";
import { config } from "@/lib/config";
import { bookSwap, type HeliusEnhancedTx } from "@/lib/book-swap";
import { sharedPriceUsd } from "@/lib/shared-reads";
import { priceUsd } from "@/lib/jupiter";
import { retryOncePrice, deliveryPriceLookup } from "@/lib/webhook-price";
import { pullerSigner } from "@/lib/puller";
import { onChainVerifier } from "@/lib/verify-swap";
import { stockMints } from "@/lib/token-kind";
import { countHelius } from "@/lib/helius-count";
import { recordSwapRefusal, recordZeroRoundup, refusalReason, MAX_REFUSAL_EVENTS_PER_DELIVERY, REFUSAL_WAIT_MS, REFUSAL_WAIT_TOTAL_MS } from "@/lib/swap-refusal";

export const runtime = "nodejs";
/**
 * L1: the booking runs in after(), inside this invocation's limit: per item a chain read (plus one 2 s retry), a price read
 * (two 800 ms attempts and a 300 ms wait at most), and the refusal-event waits capped at REFUSAL_WAIT_TOTAL_MS per delivery. 60 s is the explicit ceiling (Hobby's).
 */
export const maxDuration = 60;

/** The shared (memoed) price read, each attempt bounded at 800 ms, one retry after 300 ms (webhook-price.ts); the retry reads fresh (priceUsd), since the memo would hand back a hung first attempt. */
const webhookPrice = retryOncePrice(sharedPriceUsd, { retryRead: priceUsd });

function authorized(header: string | null): boolean {
  const expected = Buffer.from(`Bearer ${config().heliusWebhookSecret}`);
  const given = Buffer.from(header ?? "");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/**
 * Helius requires a 200 within one second and drops the event after three retries, so the route acknowledges first and
 * books afterwards. A malformed item is logged and skipped; the signature is the primary key, so retries never double-book.
 * The secret is not the whole boundary any more (R207 #8): every swap that would be booked is first read from chain and must
 * have succeeded, be signed by the linked wallet, be recent, carry the event's block time and amounts no larger than the chain's.
 */
export async function POST(request: Request) {
  if (!authorized(request.headers.get("authorization"))) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  const body = (await request.json().catch(() => null)) as unknown;
  const items = Array.isArray(body) ? (body as HeliusEnhancedTx[]) : [];
  countHelius(items.length);   // 11-19: Helius bills 1 credit per delivered event

  after(async () => {
    const repo = await getRepo();
    const puller = (await pullerSigner()).address;
    const verify = onChainVerifier();
    // Ops #9: a swap refused by the chain check, or an item whose booking threw, also leaves a `swap_refused` event (reason enum,
    // short signature), at most MAX_REFUSAL_EVENTS_PER_DELIVERY per delivery, each write bounded (swap-refusal.ts). Routine skips
    // (not a swap, a top-up, a puller planting, already booked) write nothing.
    let recorded = 0;
    let waitLeftMs = REFUSAL_WAIT_TOTAL_MS;
    const refusal = async (signature: unknown, walletPubkey: string | null, reason: ReturnType<typeof refusalReason>) => {
      if (recorded >= MAX_REFUSAL_EVENTS_PER_DELIVERY) return;
      recorded++;
      waitLeftMs -= await recordSwapRefusal(repo, { signature: String(signature ?? ""), walletPubkey, reason }, Math.max(0, Math.min(REFUSAL_WAIT_MS, waitLeftMs)));
    };
    // A swap with no price (after the retry) is left unbooked and logged as `zero_roundup`; it shares the per-delivery event cap and wait budget.
    const zeroRoundup = async (signature: unknown, walletPubkey: string) => {
      if (recorded >= MAX_REFUSAL_EVENTS_PER_DELIVERY) return;
      recorded++;
      waitLeftMs -= await recordZeroRoundup(repo, { signature: String(signature ?? ""), walletPubkey }, Math.max(0, Math.min(REFUSAL_WAIT_MS, waitLeftMs)));
    };
    // Per-delivery breaker, per mint, plus a 40 s read-time backstop. The shared memo keeps a missing price 10 s (11-23); the retry leg reads fresh.
    const deliveryPrice = deliveryPriceLookup(webhookPrice);
    for (const tx of items) {
      try {
        const r = await bookSwap({ repo, tx, priceUsd: deliveryPrice, ignoreFeePayer: puller, verify, stockMints });
        if (r.booked) console.log(`booked ${tx.signature} for ${r.walletPubkey}: ${r.roundupCents} cents`);
        else if (r.unpriced) {
          console.error(`webhook item unpriced ${tx.signature}: left unbooked`);
          await zeroRoundup(tx.signature, r.walletPubkey);
        } else if (r.refused) {
          console.error(`webhook item refused ${tx.signature}: ${r.refused}`);
          await refusal(tx.signature, r.walletPubkey ?? null, refusalReason(r.refused));
        }
      } catch (e) {
        console.error(`webhook item failed ${tx?.signature ?? "?"}: ${e instanceof Error ? e.message : String(e)}`);
        await refusal(tx?.signature, null, "error");
      }
    }
  });

  return NextResponse.json({ received: items.length });
}
