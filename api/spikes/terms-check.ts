// Read-only: which Terms version each user has accepted, as counts per version plus the latest acceptance time. Prints no keys.
import { createClient } from "@supabase/supabase-js";

const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!, { auth: { persistSession: false } });
const { data, error } = await db.from("users").select("*");
if (error) throw new Error(error.message);
const cols = Object.keys(data[0] ?? {}).filter((k) => k.startsWith("terms"));
console.log("terms columns:", cols.join(", "));
const by = new Map<string, number>();
for (const u of data) by.set(String(u.terms_version ?? "none"), (by.get(String(u.terms_version ?? "none")) ?? 0) + 1);
console.log("users:", data.length, Object.fromEntries(by));
for (const u of data) if (u.terms_version === "2026-10-09") console.log("accepted 10-09 at:", u.terms_accepted_at ?? "(no time column)");
