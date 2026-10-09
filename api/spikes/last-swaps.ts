// Read-only: the latest booked swaps (wallet shortened), their size and round-up, and whether they are planted yet.
import { createClient } from "@supabase/supabase-js";

const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!, { auth: { persistSession: false } });
const { data, error } = await db.from("swaps").select("*").order("ts", { ascending: false }).limit(5);
if (error) throw new Error(error.message);
for (const s of data) {
  const w = String(s.wallet_pubkey ?? s.wallet ?? "");
  console.log(s.ts, `${w.slice(0, 4)}...${w.slice(-4)}`, "size", s.usd_size_cents, "roundup", s.roundup_cents, "planting", s.planting_id ?? "waiting");
}
