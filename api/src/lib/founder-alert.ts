import { z } from "zod";
import type { EventRow } from "@/db/types";
import type { Repo } from "@/db/repo";
import { errorText } from "./redact";
import { FEEDBACK_OPTIONS, type FeedbackQuestion } from "@/domain/asks";
import { isSupportRef } from "./support-ref";

/**
 * 10-26 (Kimi user-comms A, build order 2-3): the events a user would want someone to act on, and the run's ALERT lines, reached
 * nobody but the Vercel logs. Each one now also goes to the founder's webhook (ALERT_WEBHOOK_URL: a Discord or Slack webhook, or an
 * ntfy.sh topic), so a paused or broken wallet can be followed up by hand while the app has no server push. Unset: nothing is sent.
 * An alert never fails the write or the run it comes from.
 */
/** 11-01 (his ask): the founder's Discord user, mentioned on Message us posts so his phone gets a notification. Not a secret. */
export const FOUNDER_DISCORD_ID = "459534488825888769";

/**
 * 11-11 (his ask: "categorize the alerts and divide them in channels, update the format/wording to ensure its clear what they
 * are"). Three Discord channels by what he has to do:
 *   support  - a person wrote to us: reply                                   (ALERT_WEBHOOK_SUPPORT, pings him)
 *   friction - someone got stuck or stopped: read daily, reach out to some   (ALERT_WEBHOOK_FRICTION, no ping: Claude's call)
 *   ops      - money or the daily job is involved: act now                   (ALERT_WEBHOOK_OPS, pings him)
 * A channel without its own webhook falls back to ALERT_WEBHOOK_URL (the old single feed), its title prefixed with the channel,
 * so nothing is lost while the new webhooks are being set up. On Discord an alert is a card (title, what happened, who, what to do,
 * colour by channel); Slack and ntfy get the same card as plain lines.
 */
export type AlertChannel = "support" | "friction" | "ops";
export type AlertCard = {
  channel: AlertChannel;
  /** Plain words, e.g. "Wallet link failed". */
  title: string;
  /** What happened, in one or two lines (may hold a code block of client text: see supportAlert). */
  text: string;
  /** Who it is about: label + value, e.g. ["User", "alice.skr"]. Server-written values only. */
  fields?: [string, string][];
  /** The next step for him, e.g. "Nothing yet: most people retry". */
  todo?: string;
  mention?: boolean;
};
const CHANNEL_ENV: Record<AlertChannel, string> = { support: "ALERT_WEBHOOK_SUPPORT", friction: "ALERT_WEBHOOK_FRICTION", ops: "ALERT_WEBHOOK_OPS" };
const CHANNEL_ICON: Record<AlertChannel, string> = { support: "💬", friction: "🧗", ops: "🚨" };
const CHANNEL_COLOR: Record<AlertChannel, number> = { support: 0x2e8b57, friction: 0xe0a030, ops: 0xd64545 };
const CHANNEL_PINGS: Record<AlertChannel, boolean> = { support: true, friction: false, ops: true };

/** The card as plain lines (Slack, ntfy, logs, tests). */
export function cardText(c: AlertCard): string {
  return [
    c.title,
    c.text,
    ...(c.fields?.length ? [c.fields.map(([k, v]) => `${k}: ${v}`).join(" | ")] : []),
    ...(c.todo ? [`What to do: ${c.todo}`] : []),
  ].join("\n");
}

export async function alertFounder(input: string | AlertCard, opts: { mention?: boolean } = {}): Promise<void> {
  // A bare line (older callers) is an ops alert sent as before: one plain message.
  const card = typeof input === "string" ? null : input;
  const channel: AlertChannel = card?.channel ?? "ops";
  const own = process.env[CHANNEL_ENV[channel]];
  const url = own || process.env.ALERT_WEBHOOK_URL;
  if (!url) return;
  const text = card ? cardText(card) : (input as string);
  try {
    const host = new URL(url).hostname;
    const ntfy = host.endsWith("ntfy.sh");
    const discord = /(^|\.)discord(app)?\.com$/.test(host);
    // Only Discord understands <@id>; Slack and ntfy get the plain line.
    // 11-08 (his ask: "every/any important message should tag me"); 11-11: per channel (support + ops ping, friction does not).
    const mention = (opts.mention ?? card?.mention ?? (card ? CHANNEL_PINGS[channel] : true)) && discord;
    const ping = mention ? `<@${FOUNDER_DISCORD_ID}>` : "";
    // allowed_mentions: no @everyone, role or user ping, whatever a line quotes (security review 10-31); the one exception is the
    // founder's own id, named here, so no text inside a message can ping anyone else.
    const allowed = mention ? { parse: [], users: [FOUNDER_DISCORD_ID] } : { parse: [] };
    let body: string;
    if (ntfy) body = text;
    else if (card && discord) {
      const prefix = own ? "" : `[${channel}] `;   // on the shared fallback feed the channel is named in the title
      body = JSON.stringify({
        content: ping,
        embeds: [{
          title: `${CHANNEL_ICON[channel]} ${prefix}${card.title}`.slice(0, 250),
          description: card.text.slice(0, 3900),
          color: CHANNEL_COLOR[channel],
          ...(card.fields?.length ? { fields: card.fields.slice(0, 10).map(([name, value]) => ({ name: name.slice(0, 250), value: (value || "?").slice(0, 1000), inline: true })) } : {}),
          ...(card.todo ? { footer: { text: `What to do: ${card.todo}`.slice(0, 2000) } } : {}),
        }],
        text,
        allowed_mentions: allowed,
      });
    } else {
      // Discord reads `content` (2000 characters at most), Slack reads `text`.
      const content = (ping ? `${ping} ${text}` : text).slice(0, 1900);
      body = JSON.stringify({ content, text, allowed_mentions: allowed });
    }
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": ntfy ? "text/plain" : "application/json" },
      body,
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
/** 11-01 (security review): a burst of Message us posts can race the route's daily cap; the webhook still gets one a minute per user. */
const SUPPORT_WINDOW_MS = 60_000;
export function alertAllowed(e: Pick<EventRow, "kind" | "userPubkey">, now = Date.now()): boolean {
  if (e.kind !== "signin_failed" && e.kind !== "link_failed" && e.kind !== "support_message" && e.kind !== "feedback_answer") return true;
  const key = `${e.kind}:${e.userPubkey}`;
  const last = lastAlert.get(key);
  if (last !== undefined && now - last < (e.kind === "support_message" || e.kind === "feedback_answer" ? SUPPORT_WINDOW_MS : ALERT_WINDOW_MS)) return false;
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
    case "feedback_answer": {
      // Client-written: only the question and choice that match the allow-list are named, and the text only by its length (no keys, no words).
      const q = String(d.question);
      const options: readonly string[] = Object.hasOwn(FEEDBACK_OPTIONS, q) ? FEEDBACK_OPTIONS[q as FeedbackQuestion] : [];
      const choice = options.includes(String(d.choice)) ? String(d.choice) : "?";
      // 11-08: an email the user left for a reply, re-checked here (written by the route, read back from the table) so only a plain address reaches the post.
      const email = typeof d.email === "string" && z.string().email().max(254).safeParse(d.email).success ? d.email : null;
      return `${isSupportRef(d.messageRef) ? `${d.messageRef} | ` : ""}Answer to "${options.length ? q : "?"}": ${choice}, ${typeof d.text === "string" ? d.text.length : 0} characters of text.${email ? ` Reply to: ${email}` : ""}`;
    }
    case "wallet_linked":
      return d.webhookAdded === false ? `Linked but NOT on the Helius webhook: ${who}. Its swaps are not being counted; add the address by hand.` : null;
    default:
      return null;
  }
}

/**
 * 11-11: the card for an event: which channel, a plain title, who it is about, and the next step. The text is founderAlertFor's
 * line (unchanged, so its cleaning of client-written fields still holds). `skrName` comes from the users table (server-written).
 */
export function founderCardFor(e: Omit<EventRow, "id" | "ts">, extra: { skrName?: string | null } = {}): AlertCard | null {
  const text = founderAlertFor(e);
  if (!text) return null;
  const d = (e.detail ?? {}) as Record<string, unknown>;
  const name = typeof extra.skrName === "string" ? extra.skrName.replace(/[^\w.-]/g, "") : null;
  const fields: [string, string][] = [["User", name ?? short(e.userPubkey)]];
  if (e.walletPubkey) fields.push(["Wallet", short(e.walletPubkey)]);
  const card = (channel: AlertChannel, title: string, todo: string): AlertCard => ({ channel, title, text, fields, todo });
  switch (e.kind) {
    case "support_message":
      return { channel: "support", title: `New message${typeof d.ref === "string" ? ` (${d.ref})` : ""}`, text, todo: typeof d.email === "string" ? "Reply by email (address below)" : "No email left: reach out by their .skr name on X or Discord, or answer in the next release note" };
    case "feedback_answer": {
      const wrote = (typeof d.text === "string" && d.text.length > 0) || typeof d.email === "string";
      return wrote
        ? card("support", `Question answered with a note${isSupportRef(d.messageRef) ? ` (${d.messageRef})` : ""}`, typeof d.email === "string" ? "Read the note in Help > messages; reply by email" : "Read the note (feedback-peek); no email left")
        : card("friction", "Question answered", "Nothing: it counts toward what to fix next");
    }
    case "link_failed":
      return card("friction", "Wallet link failed", "Nothing yet: most people retry. If the same user fails again, reach out");
    case "signin_failed":
      return card("friction", "Sign-in failed", "Nothing yet; reach out if it repeats");
    case "paused_no_usdc":
      return card("friction", "Paused: no USDC in the wallet", "Nothing: plantings resume once they add USDC, and the app reminds them");
    case "revoke_seen":
      return d.by === "token_revoke"
        ? card("friction", "Wallet lost its USDC approval", "Ask them to re-link the wallet in the app")
        : card("friction", "Wallet removed outside the app", "Nothing: the app asks them why on their next open");
    case "wallet_linked":
      return card("ops", "Wallet linked but not on the watch list", "The daily job re-adds it; check its swaps since the link");
    case "pull_failed":
      return card("ops", "Planting failed", "Retried next run. If it repeats for this wallet, look at the error");
    case "withdraw_failed":
      return card("ops", "SKR withdrawal failed", "Retried next run. If it repeats, check the stake account");
    case "move_failed":
      return card("ops", "Venue move half done", "The money is idle in their wallet: finish the move or let the next run plant it");
    case "run_stopped":
      return card("ops", "Planting run stopped", "Likely a Jupiter or RPC outage: check status, then re-run or wait for tomorrow");
    default:
      return card("ops", e.kind, "Check the events table");
  }
}

/**
 * 10-26: a linked wallet the Helius webhook does not watch has its swaps never booked, and nothing else would say so (Helius
 * replaces the whole address list on every update, so one bad write could drop them all). Once a day the cron compares the list
 * with every wallet that is not revoked (a paused one still tallies its round-ups) and alerts on any that are missing.
 */
/**
 * 11-10: `repair` (the cron passes heliusEnsureAddresses) re-adds the missing wallets and returns the ones still off. Swaps a
 * wallet made while off the webhook were never booked, so a repaired gap still alerts: someone may want to look at its swaps.
 * A throwing repair counts as nothing repaired.
 */
export async function checkWebhookCoverage(a: { repo: Repo; watched: () => Promise<string[]>; repair?: (missing: string[]) => Promise<string[]>; alert?: (text: string) => Promise<void> }): Promise<{ missing: string[]; repaired: string[] }> {
  const [watched, active, paused] = await Promise.all([a.watched(), a.repo.listActiveWallets(), a.repo.listPausedWallets()]);
  const on = new Set(watched);
  const missing = [...active, ...paused].map((w) => w.pubkey).filter((k) => !on.has(k));
  if (!missing.length) return { missing, repaired: [] };
  let still = missing;
  if (a.repair) {
    try {
      const left = new Set(await a.repair(missing));
      still = missing.filter((k) => left.has(k));
    } catch (e) {
      console.error(`webhook coverage: repair failed: ${errorText(e)}`);
    }
  }
  const repaired = missing.filter((k) => !still.includes(k));
  const parts: string[] = [];
  if (repaired.length) parts.push(`Re-added ${repaired.length} linked wallet(s) to the Helius webhook: ${repaired.map((k) => short(k)).join(", ")}. Swaps they made while off it were not counted.`);
  if (still.length) parts.push(`Round-ups NOT being counted: ${still.length} linked wallet(s) missing from the Helius webhook: ${still.map((k) => short(k)).join(", ")}. Add them back.`);
  await (a.alert ?? ((text: string) => alertFounder({
    channel: "ops",
    title: still.length ? "Swaps not being counted (watch list)" : "Wallets put back on the watch list",
    text,
    todo: still.length ? "Add the listed wallets to the Helius webhook by hand" : "Check their swaps during the gap; nothing was booked while they were off",
  })))(parts.join(" "));
  return { missing: still, repaired };
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
  // Discord: a fence in the text would end the code block. Slack: <...> is its link and mention markup (<!channel>, <url|text>).
  const msg = String(d.message ?? "").replace(/`/g, "'").replace(/</g, "\u2039").replace(/>/g, "\u203A");
  const body = msg.length > 1200 ? `${msg.slice(0, 1200)}\n(cut: the full text is in the events table)` : msg;
  const wallets = ctx.wallets?.length ? ctx.wallets.map((w) => `${short(w.pubkey)} ${w.status}`).join(", ") : "none linked";
  const recent = ctx.recent?.length ? ctx.recent.map((r) => `${r.kind}${r.step ? ` (${String(r.step)})` : ""} ${at(r.ts)}`).join(", ") : "nothing";
  return [
    `${typeof d.ref === "string" ? `${d.ref} | ` : ""}Message from ${name ?? "no .skr name"} (user ${short(userPubkey)}) | ${TOPIC_LABEL[String(d.topic)] ?? "No topic"}`,
    "```",
    body,
    "```",
    `Reply to: ${String(d.email ?? "?")} | app ${String(app.version ?? "?")} | ${String(app.device ?? "?")}`,
    `Wallets: ${wallets} | recent (UTC): ${recent}`,
  ].join("\n");
}
