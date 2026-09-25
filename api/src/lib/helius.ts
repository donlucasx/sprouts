import { config } from "./config";

const API = "https://api.helius.xyz";

function url(path: string, extra = "") {
  return `${API}${path}?api-key=${config().heliusApiKey}${extra}`;
}

/** The one enhanced webhook for SWAP transactions. Helius echoes `authHeader` verbatim, so it carries the full "Bearer <secret>". */
/** Helius refuses an empty address list at creation (400 "At least one account address is required"), so the first linked wallet seeds it. */
export async function heliusCreateWebhook(a: { webhookUrl: string; authHeader: string; accountAddresses: string[] }): Promise<{ webhookID: string }> {
  const res = await fetch(url("/v0/webhooks"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ webhookURL: a.webhookUrl, transactionTypes: ["SWAP"], accountAddresses: a.accountAddresses, webhookType: "enhanced", authHeader: a.authHeader }),
  });
  if (!res.ok) throw new Error(`Helius create webhook failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as { webhookID: string };
}

type Webhook = { webhookID: string; webhookURL: string; transactionTypes: string[]; accountAddresses: string[]; webhookType: string; authHeader?: string };

/** Add one wallet to the webhook. Helius replaces the whole list on update, so it is read, extended and written back. */
export async function heliusAddAddress(webhookId: string, address: string): Promise<void> {
  const current = await fetch(url(`/v0/webhooks/${webhookId}`));
  if (!current.ok) throw new Error(`Helius read webhook failed: ${current.status}`);
  const hook = (await current.json()) as Webhook;
  if (hook.accountAddresses.includes(address)) return;
  const res = await fetch(url(`/v0/webhooks/${webhookId}`), {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      webhookURL: hook.webhookURL, transactionTypes: hook.transactionTypes, accountAddresses: [...hook.accountAddresses, address],
      webhookType: hook.webhookType, ...(hook.authHeader ? { authHeader: hook.authHeader } : {}),
    }),
  });
  if (!res.ok) throw new Error(`Helius update webhook failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
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
