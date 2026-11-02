// Read-only (11-01, his ruling B: "a log of messages+ref numbers that we can see from our end as well"): every Message us message,
// newest first: reference, time (UTC), .skr name or user, topic, reply email, app line, and the text. The Discord post carries the same
// reference. Prints user-written text and emails: run it in your own Terminal, not into a shared log.
// Run from api/: pnpm tsx --env-file=.env.local spikes/support-log.ts [how many, default 30]
import { createClient } from "@supabase/supabase-js";
import { config } from "../src/lib/config";

const db = createClient(config().supabaseUrl, config().supabaseServiceKey, { auth: { persistSession: false } });
const limit = Number(process.argv[2] ?? 30);
const { data, error } = await db.from("events").select("ts,user_pubkey,detail").eq("kind", "support_message").order("ts", { ascending: false }).limit(limit);
if (error) throw new Error(error.message);
for (const e of data ?? []) {
  const d = (e.detail ?? {}) as { ref?: string; topic?: string; email?: string; message?: string; app?: { version?: string; device?: string }; context?: { skrName?: string } };
  const who = d.context?.skrName ?? `${String(e.user_pubkey).slice(0, 4)}...${String(e.user_pubkey).slice(-4)}`;
  console.log(`${d.ref ?? "(no ref)"}  ${String(e.ts).slice(0, 16)} UTC  ${who}  ${d.topic ?? "no topic"}  reply: ${d.email ?? "?"}  app ${d.app?.version ?? "?"} ${d.app?.device ?? ""}`);
  console.log(`    ${String(d.message ?? "").replace(/\s+/g, " ")}`);
}
console.log(`${data?.length ?? 0} message(s)`);
