// Read-only: why does Activity never show a "Found" row? Counts found_venues and what the model answered in split_days. Prints no secrets.
import { createClient } from "@supabase/supabase-js";

const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!, { auth: { persistSession: false } });

const found = await db.from("found_venues").select("day,project,symbol,asset,apy_base_pct,note").order("day", { ascending: false }).limit(20);
console.log("found_venues rows (latest 20):", found.error ? found.error.message : found.data?.length);
for (const r of found.data ?? []) console.log(" ", r.day, r.project, r.symbol, r.asset, r.apy_base_pct, (r.note ?? "").slice(0, 80));

const days = await db.from("split_days").select("day,stop,fallback,model_answer").order("day", { ascending: false }).limit(21);
console.log("split_days (latest 21):", days.error ? days.error.message : days.data?.length);
for (const r of days.data ?? []) {
  const a = r.model_answer as { found?: unknown[] } | null;
  const f = Array.isArray(a?.found) ? a!.found : null;
  console.log(" ", r.day, r.stop, "fallback=" + (r.fallback ?? "none"), "found=" + (f === null ? "absent" : f.length), f && f.length ? JSON.stringify(f).slice(0, 160) : "");
}
