// Re-sends one swap to the production webhook, for a swap whose booking failed (Helius does not retry after a 200).
// Run from api/: pnpm tsx --env-file=.env.local spikes/replay-swap.ts <signature>
// Prints only the webhook's answer; the booking itself shows in the Vercel logs ("booked <sig> for <wallet>: N cents").
import { config } from "../src/lib/config";

const sig = process.argv[2];
if (!sig) { console.log("usage: replay-swap.ts <signature>"); process.exit(1); }
const txs = await (await fetch(`https://api.helius.xyz/v0/transactions?api-key=${config().heliusApiKey}`, {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ transactions: [sig] }),
})).json();
const r = await fetch("https://sprouts.money/api/webhooks/helius", {
  method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${config().heliusWebhookSecret}` }, body: JSON.stringify(txs),
});
console.log("webhook", r.status, await r.text());
