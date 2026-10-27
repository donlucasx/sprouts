// Read-only (10-27, his "continue measuring it"): the Add USDC top-ups from their events. Sent = marked before the send; landed = a
// topped_up row (at confirm, or settled later by /api/activity); open = sent, no row yet (still pending, expired or failed); late =
// landed, settled after the confirm gave up. Also: any booked swap carrying a top-up's signature (must be 0).
// Run from api/: pnpm tsx --env-file=.env.local spikes/topup-stats.ts
import { createClient } from "@supabase/supabase-js";
import { config } from "../src/lib/config";

const c = config();
const db = createClient(c.supabaseUrl, c.supabaseServiceKey, { auth: { persistSession: false } });
const { data, error } = await db.from("events").select("ts, user_pubkey, kind, detail").in("kind", ["topup_sent", "topped_up"]).order("ts");
if (error) throw new Error(`events read failed: ${error.message}`);
type D = { signature?: string; usdcRaw?: string; sentAt?: string };
const sent = new Map<string, { ts: string; user: string; usdcRaw?: string }>();
const landed = new Map<string, { ts: string; sentAt?: string }>();
for (const e of data) {
  const d = (e.detail ?? {}) as D;
  if (!d.signature) continue;
  if (e.kind === "topup_sent") sent.set(d.signature, { ts: e.ts, user: e.user_pubkey, usdcRaw: d.usdcRaw });
  else landed.set(d.signature, { ts: e.ts, sentAt: d.sentAt });
}
// "late": the row was written more than 2 minutes after the send (the confirm poll waits about 30 s)
const late = [...landed.values()].filter((l) => l.sentAt && Date.parse(l.ts) - Date.parse(l.sentAt) > 120_000).length;
const open = [...sent.keys()].filter((s) => !landed.has(s));
const dollars = [...landed.keys()].reduce((n, s) => n + Number(sent.get(s)?.usdcRaw ?? 0) / 1e6, 0);
console.log(`top-ups sent ${sent.size} · landed ${landed.size} ($${dollars.toFixed(2)}) · late ${late} · open ${open.length} · users ${new Set([...sent.values()].map((s) => s.user)).size}`);
const short = (k: string) => `${k.slice(0, 4)}...${k.slice(-4)}`;
for (const s of open) console.log(`open ${short(s)} sent ${sent.get(s)!.ts.slice(0, 16)} by ${short(sent.get(s)!.user)}`);
const sigs = [...sent.keys()];
const { data: booked, error: e2 } = sigs.length ? await db.from("swaps").select("signature").in("signature", sigs) : { data: [], error: null };
if (e2) throw new Error(`swaps read failed: ${e2.message}`);
console.log(`top-ups booked as swaps: ${booked?.length ?? 0} (must be 0)`);
// Kimi R2-2: the webhook's skip rides on SupabaseRepo.topUpKinds (a JSON-path filter only production exercises). Ask it, as the
// webhook does, for the newest mark: it must answer at least ["topup_sent"].
const newest = [...sent].at(-1);
if (newest) {
  const { SupabaseRepo } = await import("../src/db/supabase");
  const kinds = await new SupabaseRepo().topUpKinds(newest[0], newest[1].user);
  console.log(`topUpKinds on the newest top-up: ${JSON.stringify(kinds)} (must include "topup_sent")`);
}
