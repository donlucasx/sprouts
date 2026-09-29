// Seeds a Seeker that registered before Plan 2 (R61, [A1]): records the position at join and the minted shares of every confirmed
// planting that lacks them, so the first reconciliation finds delta 0. All but the newest lacking planting are estimated from
// their SKR leg at today's share price; the newest takes the remainder, so the sum equals the chain today. Dry run by default.
// Run from api/: pnpm tsx --env-file=.env.local spikes/set-joined.ts <seed vault pubkey | name.skr> [--write]
import { address } from "@solana/kit";
import { Connection } from "@solana/web3.js";
import { TldParser } from "@onsol/tldparser";
import { getRepo } from "../src/db/repo";
import { config } from "../src/lib/config";
import { readPosition, sharePrice } from "../src/lib/staking";

const arg = (process.argv[2] ?? "").trim();
const write = process.argv.includes("--write");
if (!arg) { console.log("usage: set-joined.ts <seed vault pubkey | name.skr> [--write]"); process.exit(1); }

let pubkey = arg;
if (arg.toLowerCase().endsWith(".skr")) {
  const owner = await new TldParser(new Connection(config().heliusRpcUrl, "confirmed")).getOwnerFromDomainTld(arg.toLowerCase());
  if (!owner) { console.log(`${arg}: no owner found`); process.exit(1); }
  pubkey = typeof owner === "string" ? owner : owner.toBase58();
}

const repo = await getRepo();
const user = await repo.getUser(pubkey);
if (!user) { console.log(`no user row for ${pubkey.slice(0, 6)}...`); process.exit(1); }

const [position, price] = await Promise.all([readPosition(address(pubkey)), sharePrice()]);
const plantings = await repo.listConfirmedPlantings(pubkey);
const lacking = plantings.filter((p) => p.sharesMinted === null);
const recorded = plantings.filter((p) => p.sharesMinted !== null).reduce((s, p) => s + (p.sharesMinted ?? 0n), 0n);
// Registered before Plan 2 with an empty position (RESULTS.md, 09-27): everything on chain is Sprouts' plantings.
const joinedShares = 0n;
console.log(`user ${pubkey.slice(0, 6)}...: chain shares ${position.shares}, share price ${price}, confirmed plantings ${plantings.length}, lacking minted shares ${lacking.length}, already recorded ${recorded}`);
console.log(`joined: ${user.joinedShares} shares at ${user.joinedSharePrice} -> ${joinedShares} shares at ${price}`);

const plan: { id: string; ts: Date; skrRaw: bigint; minted: bigint; after: bigint }[] = [];
let running = joinedShares + recorded;
for (const [i, p] of lacking.entries()) {
  const legs = await repo.plantingLegs(p.id);
  const skrRaw = legs.filter((l) => l.asset === "SKR").reduce((s, l) => s + l.amountOutRaw, 0n);
  const minted = i < lacking.length - 1 ? (skrRaw * 1_000_000_000n) / price : position.shares - running;
  running += minted;
  plan.push({ id: p.id, ts: p.ts, skrRaw, minted, after: running });
}
for (const x of plan) console.log(`  ${x.ts.toISOString().slice(0, 16)} ${x.id.slice(0, 8)}... leg ${x.skrRaw} raw SKR -> minted ${x.minted} shares (after ${x.after})`);
const total = joinedShares + recorded + plan.reduce((s, x) => s + x.minted, 0n);
console.log(`check: joined + minted = ${total}, chain = ${position.shares}, delta ${position.shares - total}`);
if (plan.some((x) => x.minted < 0n)) { console.log("a negative estimate: the chain holds fewer shares than the legs imply; stop and look"); process.exit(1); }

if (!write) { console.log("dry run; add --write to record it"); process.exit(0); }
await repo.setJoinedPosition(pubkey, { shares: joinedShares, sharePrice: price });
for (const x of plan) await repo.setPlantingShares(x.id, { before: null, after: x.after, minted: x.minted });
const again = (await repo.listConfirmedPlantings(pubkey)).reduce((s, p) => s + (p.sharesMinted ?? 0n), 0n);
console.log(`written: joined ${joinedShares} shares, minted recorded for ${plan.length} plantings; expected ${joinedShares + again} vs chain ${position.shares}`);
