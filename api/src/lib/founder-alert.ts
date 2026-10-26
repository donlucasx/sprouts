import type { EventRow } from "@/db/types";
import { errorText } from "./redact";

/**
 * 10-26 (Kimi user-comms A, build order 2-3): the events a user would want someone to act on, and the run's ALERT lines, reached
 * nobody but the Vercel logs. Each one now also goes to the founder's webhook (ALERT_WEBHOOK_URL: a Discord or Slack webhook, or an
 * ntfy.sh topic), so a paused or broken wallet can be followed up by hand while the app has no server push. Unset: nothing is sent.
 * An alert never fails the write or the run it comes from.
 */
export async function alertFounder(text: string): Promise<void> {
  const url = process.env.ALERT_WEBHOOK_URL;
  if (!url) return;
  try {
    const ntfy = new URL(url).hostname.endsWith("ntfy.sh");
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": ntfy ? "text/plain" : "application/json" },
      // Discord reads `content` (2000 characters at most), Slack reads `text`.
      body: ntfy ? text : JSON.stringify({ content: text.slice(0, 1900), text }),
      signal: AbortSignal.timeout(3_000),
    });
    if (!res.ok) console.error(`founder alert not delivered: HTTP ${res.status}`);
  } catch (e) {
    // The URL carries the webhook's secret: never logged.
    console.error(`founder alert not delivered: ${e instanceof Error ? e.name : "error"}`);
  }
}

const short = (k: string | null) => (k ? `${k.slice(0, 4)}...${k.slice(-4)}` : "?");
const clip = (v: unknown) => errorText(v).slice(0, 160);

/** The alert line for an event, or null for the events nobody needs to hear about. */
export function founderAlertFor(e: Omit<EventRow, "id" | "ts">): string | null {
  const d = (e.detail ?? {}) as Record<string, unknown>;
  const who = `wallet ${short(e.walletPubkey)} (user ${short(e.userPubkey)})`;
  switch (e.kind) {
    case "paused_no_usdc":
      return `Paused for no USDC: ${who}, needs $${(Number(d.needCents ?? 0) / 100).toFixed(2)}. Plantings resume on their own once USDC is there.`;
    case "revoke_seen":
      return `Revoked outside the app: ${who}. Sprouts has stopped planting for this wallet.`;
    case "pull_failed":
      return `Planting failed at ${String(d.stage ?? "?")}: ${who}: ${clip(d.err)}`;
    case "withdraw_failed":
      return `SKR withdrawal failed (retried next run): user ${short(e.userPubkey)}: ${clip(d.err)}`;
    case "move_failed":
      return `Venue move half done (redeemed, not deposited): ${who}. The money is back in the wallet, idle.`;
    case "run_stopped":
      return `Planting run STOPPED after ${String(d.after ?? "?")} build failures in a row (Jupiter or RPC outage?). Last wallet ${short(String(d.lastWallet ?? ""))}.`;
    case "wallet_linked":
      return d.webhookAdded === false ? `Linked but NOT on the Helius webhook: ${who}. Its swaps are not being counted; add the address by hand.` : null;
    default:
      return null;
  }
}
