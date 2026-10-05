// api/spikes/pyth-ages.ts
// Spike S4 (contracts 9, amended R324): how old do the free sponsored accounts get? Samples SOL, ORE and cbBTC every 15 s for
// ROUNDS rounds (default 120 = 30 min) and prints, per account, the max age seen and the gaps between publish times.
// cbBTC's max_age_s (600 s today, from four reads of 233-288 s) is confirmed or moved by this output.
// Run: cd api && pnpm tsx --env-file=.env.local spikes/pyth-ages.ts [rounds]   (read-only RPC)
import { address } from "@solana/kit";
import { rpc } from "../src/lib/rpc";

const ACCOUNTS: Record<string, string> = {
  SOL: "7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE",
  CBBTC: "7oqYpv5YbjJ2PEsNeVVB5ZEZ8ZE6ufkj8hAvAiaiftbe",
  ORE: "GYYQ8gbX4Tndc4WMJ9jSjZTePTvbmgRRxByt54ZQYqvZ",
};
const ROUNDS = Number(process.argv[2] ?? 120);
const seen: Record<string, { maxAge: number; publishes: number[]; bad: number }> = {};
for (let round = 0; round < ROUNDS; round++) {
  for (const [name, acc] of Object.entries(ACCOUNTS)) {
    const s = (seen[name] ??= { maxAge: 0, publishes: [], bad: 0 });
    const info = await rpc().getAccountInfo(address(acc), { encoding: "base64" }).send();
    if (!info.value) { s.bad++; continue; }
    const b = Buffer.from(info.value.data[0], "base64");
    if (info.value.owner !== "rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ" || b.length !== 134 || b[40] !== 1) { s.bad++; continue; }
    const publish = Number(b.readBigInt64LE(93));
    s.maxAge = Math.max(s.maxAge, Math.round(Date.now() / 1000 - publish));
    if (s.publishes.at(-1) !== publish) s.publishes.push(publish);
  }
  if (round % 20 === 0) console.log(`round ${round}/${ROUNDS}`);
  if (round < ROUNDS - 1) await new Promise((r) => setTimeout(r, 15_000));
}
for (const [name, s] of Object.entries(seen)) {
  const gaps = s.publishes.slice(1).map((p, i) => p - s.publishes[i]);
  console.log(`${name} max age ${s.maxAge}s; updates seen ${s.publishes.length}; gaps (s) min ${Math.min(...gaps)} max ${Math.max(...gaps)}; not Full/missing ${s.bad}`);
}
