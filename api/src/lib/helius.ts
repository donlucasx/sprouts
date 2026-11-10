import { config } from "./config";

const API = "https://api.helius.xyz";

function url(path: string, extra = "") {
  return `${API}${path}?api-key=${config().heliusApiKey}${extra}`;
}

/** The one enhanced webhook for SWAP transactions. Helius echoes `authHeader` verbatim, so it carries the full "Bearer <secret>". */
/** Helius refuses an empty address list at creation (400 "At least one account address is required"), so the first linked wallet seeds it. */
// Every transaction type, not SWAP only: a swap through a router Helius does not know parses as INITIALIZE_ACCOUNT or UNKNOWN
// (09-30, Jupiter's Order Engine); the booking reads the legs itself.
export async function heliusCreateWebhook(a: { webhookUrl: string; authHeader: string; accountAddresses: string[] }): Promise<{ webhookID: string }> {
  const res = await fetch(url("/v0/webhooks"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ webhookURL: a.webhookUrl, transactionTypes: ["ANY"], accountAddresses: a.accountAddresses, webhookType: "enhanced", authHeader: a.authHeader }),
  });
  if (!res.ok) throw new Error(`Helius create webhook failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as { webhookID: string };
}

type Webhook = { webhookID: string; webhookURL: string; transactionTypes: string[]; accountAddresses: string[]; webhookType: string; authHeader?: string };

async function readWebhook(webhookId: string): Promise<Webhook> {
  const res = await fetch(url(`/v0/webhooks/${webhookId}`));
  if (!res.ok) throw new Error(`Helius read webhook failed: ${res.status}`);
  return (await res.json()) as Webhook;
}

/** 11-10: tries and the pause before each re-read. Two links a moment apart is the case (launch traffic after the CLOCK IN win). */
export const ENSURE_TRIES = 3;
export const ENSURE_SETTLE_MS = 1_500;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Make the webhook watch every address in `want`; returns the ones still missing after the last try (empty = all watched).
 * Helius replaces the whole list on update, so the list is read, extended and written back. Two writers that read before either
 * writes each drop the other's address (lost update, 11-10 review). So every write is checked by a re-read after a pause, and a
 * missing address is written again with the list as it is then. Callers pass every wallet they know of, not only the new one,
 * so a wallet a racing write dropped earlier comes back on the next link (and the daily coverage pass re-adds the rest).
 */
export async function heliusEnsureAddresses(webhookId: string, want: string[], opts: { tries?: number; settleMs?: number } = {}): Promise<string[]> {
  const tries = opts.tries ?? ENSURE_TRIES;
  const settleMs = opts.settleMs ?? ENSURE_SETTLE_MS;
  const wanted = [...new Set(want)];
  let hook = await readWebhook(webhookId);
  for (let i = 0; i < tries; i++) {
    const have = new Set(hook.accountAddresses);
    const missing = wanted.filter((a) => !have.has(a));
    if (!missing.length) return [];
    const res = await fetch(url(`/v0/webhooks/${webhookId}`), {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        webhookURL: hook.webhookURL, transactionTypes: hook.transactionTypes, accountAddresses: [...hook.accountAddresses, ...missing],
        webhookType: hook.webhookType, ...(hook.authHeader ? { authHeader: hook.authHeader } : {}),
      }),
    });
    if (!res.ok) throw new Error(`Helius update webhook failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
    // A random part keeps two racing writers from re-reading and re-writing in lockstep.
    await sleep(settleMs + Math.floor(Math.random() * settleMs));
    hook = await readWebhook(webhookId);
  }
  const have = new Set(hook.accountAddresses);
  return wanted.filter((a) => !have.has(a));
}

/** Add one wallet to the webhook (plus `alsoKnown`, re-added if a racing write dropped them); throws when it is still not watched. */
export async function heliusAddAddress(webhookId: string, address: string, alsoKnown: string[] = []): Promise<void> {
  const missing = await heliusEnsureAddresses(webhookId, [address, ...alsoKnown]);
  if (missing.includes(address)) throw new Error(`Helius webhook still missing the wallet after ${ENSURE_TRIES} tries`);
  if (missing.length) console.error(`helius: ${missing.length} known wallet(s) still off the webhook after ${ENSURE_TRIES} tries; the daily coverage pass retries`);
}

/** The addresses the swap webhook watches (read-only), for the daily coverage check. */
export async function heliusWebhookAddresses(webhookId: string): Promise<string[]> {
  return (await readWebhook(webhookId)).accountAddresses;
}

/** Recent swaps for one address through Parsed Events (the cheaper successor of Enhanced Transactions). Onboarding preview only. */
export async function heliusHistory(address: string, limit = 100): Promise<unknown[]> {
  const res = await fetch(url("/v1/parsed-events/transaction-history"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ address, limit, types: ["swap"] }),
  });
  if (!res.ok) throw new Error(`Helius history failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
  const j = (await res.json()) as { data?: unknown[] } | unknown[];
  return Array.isArray(j) ? j : (j.data ?? []);
}
