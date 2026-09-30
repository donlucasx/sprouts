// Sets the Helius webhook's transaction types (09-30: swaps through Jupiter's Order Engine parse as INITIALIZE_ACCOUNT, so a
// webhook subscribed to SWAP only never sees them). Reads the hook, prints it, and PUTs it back with the types given.
// Run from api/: pnpm tsx --env-file=.env.local spikes/webhook-types.ts <webhook id> ANY
// Without a type argument it only prints the hook (read-only).
import { config } from "../src/lib/config";

const [id, ...types] = process.argv.slice(2);
if (!id) { console.log("usage: webhook-types.ts <webhook id> [TYPE ...]"); process.exit(1); }
const base = `https://api.helius.xyz/v0/webhooks/${id}?api-key=${config().heliusApiKey}`;
const hook = (await (await fetch(base)).json()) as { webhookURL: string; transactionTypes: string[]; accountAddresses: string[]; webhookType: string; authHeader?: string };
console.log(`hook: ${hook.webhookURL} types ${JSON.stringify(hook.transactionTypes)} addresses ${hook.accountAddresses.length} type ${hook.webhookType}`);
if (types.length === 0) process.exit(0);
const res = await fetch(base, {
  method: "PUT", headers: { "content-type": "application/json" },
  body: JSON.stringify({ webhookURL: hook.webhookURL, transactionTypes: types, accountAddresses: hook.accountAddresses, webhookType: hook.webhookType, ...(hook.authHeader ? { authHeader: hook.authHeader } : {}) }),
});
const after = (await res.json()) as { transactionTypes?: string[]; error?: string };
// Review M7: read back after the PUT, never trust the answer alone.
const check = (await (await fetch(base)).json()) as { transactionTypes: string[] };
console.log(`PUT ${res.status} ${after.error ?? ""}; now types ${JSON.stringify(check.transactionTypes)}`);
