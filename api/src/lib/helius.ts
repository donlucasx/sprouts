import { config } from "./config";
import type { HeliusEnhancedTx } from "./book-swap";
import { parsedEventToTx, PREVIEW_PAGE_SIZE, type FetchPage } from "./preview";
import { countHelius, HELIUS_REST_COST } from "./helius-count";

const API = "https://api.helius.xyz";

function url(path: string, extra = "") {
  return `${API}${path}?api-key=${config().heliusApiKey}${extra}`;
}

/** The one enhanced webhook for SWAP transactions. Helius echoes `authHeader` verbatim, so it carries the full "Bearer <secret>". */
/** Helius refuses an empty address list at creation (400 "At least one account address is required"), so the first linked wallet seeds it. */
// Every transaction type, not SWAP only: a swap through a router Helius does not know parses as INITIALIZE_ACCOUNT or UNKNOWN
// (09-30, Jupiter's Order Engine); the booking reads the legs itself.
export async function heliusCreateWebhook(a: { webhookUrl: string; authHeader: string; accountAddresses: string[] }): Promise<{ webhookID: string }> {
  countHelius(HELIUS_REST_COST.webhookWrite);
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
  countHelius(HELIUS_REST_COST.webhookRead);
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
    countHelius(HELIUS_REST_COST.webhookWrite);
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

/**
 * Take addresses off the webhook (revoked wallets), same read-modify-write and re-read loop as heliusEnsureAddresses. Each try:
 * (1) `stillRevoked` is asked for every address first (a DB read), so no DB call sits between the webhook read and the write;
 * (2) the webhook is read and written back at once without the addresses; (3) after a pause it is read again: a racing link write
 * can put one back (removed again on the next try), and a racing write built from an older read can drop an address the snapshot
 * had and we kept (re-added through heliusEnsureAddresses, and logged). A write that lands between our read and our PUT and adds
 * an address we never saw is not visible here: that writer's own re-read (heliusEnsureAddresses, 11-10) puts it back.
 * An address `stillRevoked` answers false for (re-linked meanwhile) is left alone. An empty list is never written (Helius refuses
 * it). Returns `removed` (requested addresses no longer on the webhook) and `kept` (still on it, for any reason).
 * Calls per prune: normal 1 read + 1 PUT + 1 re-read; worst case per try the same again, plus a re-add (1 read + 1 PUT + 1 re-read).
 */
export async function heliusRemoveAddresses(
  webhookId: string,
  remove: string[],
  opts: { tries?: number; settleMs?: number; stillRevoked?: (address: string) => Promise<boolean> } = {},
): Promise<{ removed: string[]; kept: string[] }> {
  const tries = opts.tries ?? ENSURE_TRIES;
  const settleMs = opts.settleMs ?? ENSURE_SETTLE_MS;
  const wanted = [...new Set(remove)];
  let work = wanted;
  let on = new Set<string>();   // the webhook as last read
  const result = () => ({ removed: wanted.filter((a) => !on.has(a)), kept: wanted.filter((a) => on.has(a)) });
  for (let i = 0; i < tries; i++) {
    if (opts.stillRevoked) {
      const ok = await Promise.all(work.map((a) => opts.stillRevoked!(a)));
      work = work.filter((_, j) => ok[j]);
    }
    const hook = await readWebhook(webhookId);
    on = new Set(hook.accountAddresses);
    work = work.filter((a) => on.has(a));
    if (!work.length) return result();
    const drop = new Set(work);
    const left = hook.accountAddresses.filter((a) => !drop.has(a));
    if (!left.length) {
      console.error(`helius: not removing ${work.length} address(es): it would leave the webhook with none`);
      return result();
    }
    countHelius(HELIUS_REST_COST.webhookWrite);
    const res = await fetch(url(`/v0/webhooks/${webhookId}`), {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        webhookURL: hook.webhookURL, transactionTypes: hook.transactionTypes, accountAddresses: left,
        webhookType: hook.webhookType, ...(hook.authHeader ? { authHeader: hook.authHeader } : {}),
      }),
    });
    if (!res.ok) throw new Error(`Helius update webhook failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
    await sleep(settleMs + Math.floor(Math.random() * settleMs));
    const after = await readWebhook(webhookId);
    on = new Set(after.accountAddresses);
    const lost = left.filter((a) => !on.has(a));
    if (lost.length) {
      console.error(`helius: a concurrent write dropped ${lost.length} watched address(es) while removing; re-added them`);
      const still = await heliusEnsureAddresses(webhookId, lost, { tries, settleMs });
      if (still.length) console.error(`helius: ${still.length} address(es) still off the webhook after the re-add; the daily coverage pass retries`);
      for (const a of lost) if (!still.includes(a)) on.add(a);   // they are back on the list: the counts below read it
    }
    work = work.filter((a) => on.has(a));
    if (!work.length) return result();
  }
  return result();
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

/**
 * One page of a wallet's history through Parsed Events (10 credits a page; Enhanced Transactions cost 100), every type (the
 * preview reads the legs itself, like the webhook), for Home's preview only. The cursor is the answer's `paginationToken`.
 * Helius answers 429 when several reads land at once (seen 11-12 on the free plan): one more try after 1 s. Each read gets 2.5 s.
 * The URL carries the key, so a failure is rethrown as `history <status>` with no URL and no body text.
 */
export const heliusParsedPage: FetchPage = async (wallet, cursor) => {
  for (let attempt = 0; ; attempt++) {
    let res: Response;
    countHelius(HELIUS_REST_COST.parsedEvents);   // each attempt, a 429'd one too
    try {
      res = await fetch(url("/v1/parsed-events/transaction-history"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ address: wallet, limit: PREVIEW_PAGE_SIZE, ...(cursor ? { paginationToken: cursor } : {}) }),
        signal: AbortSignal.timeout(2_500),
      });
    } catch (e) {
      throw new Error(`history ${e instanceof Error ? e.name : "error"}`);
    }
    if (res.ok) {
      const j = (await res.json().catch(() => null)) as { data?: unknown; paginationToken?: unknown } | null;
      if (!j || !Array.isArray(j.data)) throw new Error("history no list");
      const txs = j.data.map((e) => parsedEventToTx(e, wallet)).filter((t): t is HeliusEnhancedTx => t !== null);
      return { txs, next: typeof j.paginationToken === "string" && j.paginationToken ? j.paginationToken : null };
    }
    if (res.status !== 429 || attempt >= 1) throw new Error(`history ${res.status}`);
    await new Promise((r) => setTimeout(r, 1_000));
  }
};

/**
 * Ops #9: Helius's parse of up to 100 signatures (POST /v0/transactions), for the daily missed-swap check. The URL carries the
 * key, so a failure is rethrown with no URL and no body text.
 */
export async function heliusParseTransactions(signatures: string[], opts: { timeoutMs?: number } = {}): Promise<import("./book-swap").HeliusEnhancedTx[]> {
  if (signatures.length > 100) throw new Error("Helius parse takes at most 100 signatures");
  let res: Response;
  countHelius(HELIUS_REST_COST.parseTransactions);
  try {
    res = await fetch(url("/v0/transactions"), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ transactions: signatures }), signal: AbortSignal.timeout(opts.timeoutMs ?? 15_000) });
  } catch (e) {
    throw new Error(`Helius parse failed: ${e instanceof Error ? e.name : "error"}`);
  }
  if (!res.ok) throw new Error(`Helius parse failed: ${res.status}`);
  const body = (await res.json().catch(() => null)) as unknown;
  if (!Array.isArray(body)) throw new Error("Helius parse answered no list");
  return body as import("./book-swap").HeliusEnhancedTx[];
}
