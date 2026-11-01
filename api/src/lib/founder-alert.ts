import type { EventRow } from "@/db/types";
import type { Repo } from "@/db/repo";
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
      // allowed_mentions: no @everyone, role or user ping, whatever a line quotes (security review 10-31).
      body: ntfy ? text : JSON.stringify({ content: text.slice(0, 1900), text, allowed_mentions: { parse: [] } }),
      signal: AbortSignal.timeout(3_000),
    });
    if (!res.ok) console.error(`founder alert not delivered: HTTP ${res.status}`);
  } catch (e) {
    // The URL carries the webhook's secret: never logged.
    console.error(`founder alert not delivered: ${e instanceof Error ? e.name : "error"}`);
  }
}

const APP_STEPS = new Set(["new", "approval", "sign", "confirm"]);
const APP_REASONS = new Set(["declined", "dropped", "refused", "other"]);

/**
 * 10-31 (security review): a sign-in or link failure is alerted at most once per user per kind in ALERT_WINDOW_MS (per function
 * instance; the event itself is always written). Every other kind passes: those come from the run, not from a caller.
 */
const ALERT_WINDOW_MS = 10 * 60_000;
const lastAlert = new Map<string, number>();
export function alertAllowed(e: Pick<EventRow, "kind" | "userPubkey">, now = Date.now()): boolean {
  if (e.kind !== "signin_failed" && e.kind !== "link_failed") return true;
  const key = `${e.kind}:${e.userPubkey}`;
  const last = lastAlert.get(key);
  if (last !== undefined && now - last < ALERT_WINDOW_MS) return false;
  lastAlert.set(key, now);
  return true;
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
      return d.by === "token_revoke"
        // 10-27 (wallet 2hEw): "removed" was wrong when the approval was never granted (a link on an older API skipped it), so the
        // line says what the run saw, not how it got there.
        ? `No USDC approval on this wallet: ${who}. Sprouts has stopped planting for it; a re-link (app 0.1.5 or later) restores it.`
        : `Revoked outside the app: ${who}. Sprouts has stopped planting for this wallet.`;
    case "pull_failed":
      return `Planting failed at ${String(d.stage ?? "?")}: ${who}: ${clip(d.err)}`;
    case "withdraw_failed":
      return `SKR withdrawal failed (retried next run): user ${short(e.userPubkey)}: ${clip(d.err)}`;
    case "move_failed":
      return `Venue move half done (redeemed, not deposited): ${who}. The money is back in the wallet, idle.`;
    case "run_stopped":
      return `Planting run STOPPED after ${String(d.after ?? "?")} build failures in a row (Jupiter or RPC outage?). Last wallet ${short(String(d.lastWallet ?? ""))}.`;
    // 10-31: only a failure tied to someone real (a verified sign-in, a live link code, a signed-in app) has a userPubkey; the rest
    // stay in the table unannounced, so an anonymous caller cannot flood the webhook (failure-log.ts).
    case "signin_failed":
      return e.userPubkey ? `Sign-in failed: user ${short(e.userPubkey)}: ${String(d.status ?? "?")} ${clip(d.error)}` : null;
    case "link_failed":
      if (!e.userPubkey) return null;
      // An app report's text is client-written: only its two enum fields are sent (security review 10-31).
      if (d.from === "app") return `Link stopped in the app at ${APP_STEPS.has(String(d.step)) ? String(d.step) : "?"}: ${who}: ${APP_REASONS.has(String(d.reason)) ? String(d.reason) : "?"}`;
      return `Link failed at ${String(d.step ?? "?")}: ${who}: ${clip(d.error)}`;
    case "support_message":
      return supportAlert(e.userPubkey, d);
    case "wallet_linked":
      return d.webhookAdded === false ? `Linked but NOT on the Helius webhook: ${who}. Its swaps are not being counted; add the address by hand.` : null;
    default:
      return null;
  }
}

/**
 * 10-26: a linked wallet the Helius webhook does not watch has its swaps never booked, and nothing else would say so (Helius
 * replaces the whole address list on every update, so one bad write could drop them all). Once a day the cron compares the list
 * with every wallet that is not revoked (a paused one still tallies its round-ups) and alerts on any that are missing.
 */
export async function checkWebhookCoverage(a: { repo: Repo; watched: () => Promise<string[]>; alert?: (text: string) => Promise<void> }): Promise<{ missing: string[] }> {
  const [watched, active, paused] = await Promise.all([a.watched(), a.repo.listActiveWallets(), a.repo.listPausedWallets()]);
  const on = new Set(watched);
  const missing = [...active, ...paused].map((w) => w.pubkey).filter((k) => !on.has(k));
  if (missing.length) await (a.alert ?? alertFounder)(`Round-ups NOT being counted: ${missing.length} linked wallet(s) missing from the Helius webhook: ${missing.map((k) => short(k)).join(", ")}. Add them back.`);
  return { missing };
}

const TOPIC_LABEL: Record<string, string> = { link: "Linking a wallet", planting: "Plantings", withdraw: "Withdrawing", idea: "An idea", other: "Something else" };
const at = (iso: unknown) => (typeof iso === "string" ? iso.slice(11, 16) : "?");

/**
 * 11-01: a Message us post. The message is the one alert line that carries client-written text on purpose (reading it is the point),
 * so it sits inside a code block with any fence in it broken: no markdown, no links, no unfurls; mentions are off for every post
 * (allowed_mentions). Everything else on the post comes from the server or is cleaned at the route (support/route.ts).
 */
export function supportAlert(userPubkey: string | null, d: Record<string, unknown>): string {
  const ctx = (d.context ?? {}) as { skrName?: unknown; wallets?: { pubkey: string; status: string }[]; recent?: { kind: string; ts: string; step?: unknown }[] };
  const app = (d.app ?? {}) as { version?: unknown; device?: unknown };
  const name = typeof ctx.skrName === "string" ? ctx.skrName.replace(/[^\w.-]/g, "") : null;
  const msg = String(d.message ?? "").replace(/`/g, "'");
  const body = msg.length > 1200 ? `${msg.slice(0, 1200)}\n(cut: the full text is in the events table)` : msg;
  const wallets = ctx.wallets?.length ? ctx.wallets.map((w) => `${short(w.pubkey)} ${w.status}`).join(", ") : "none linked";
  const recent = ctx.recent?.length ? ctx.recent.map((r) => `${r.kind}${r.step ? ` (${String(r.step)})` : ""} ${at(r.ts)}`).join(", ") : "nothing";
  return [
    `Message from ${name ?? "no .skr name"} (user ${short(userPubkey)}) | ${TOPIC_LABEL[String(d.topic)] ?? "No topic"}`,
    "```",
    body,
    "```",
    `Reply to: ${String(d.email ?? "?")} | app ${String(app.version ?? "?")} | ${String(app.device ?? "?")}`,
    `Wallets: ${wallets} | recent (UTC): ${recent}`,
  ].join("\n");
}
