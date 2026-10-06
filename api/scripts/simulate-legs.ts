// The go-live gate (spec 6.5): build and SIMULATE a real planting per leg on mainnet. Never sends a planting.
// --no-post is the DEFAULT: a leg whose price must be posted (SKR leashed, or any leg whose source answers "post") is skipped
// and printed `skipped=needs-post`, so nothing at all is sent. Only the owner passes --allow-post, in his own Terminal: a posted
// price then sends its puller-paid VAA pre-txs and reclaims the rent after (no user funds move). It needs PYTH_API_KEY (the
// crypto-entitled key) in the env file, else SKR has no source and its build fails. With --size-only (or --assume-alt) the post
// is built and sized but NOT sent (`priceTxs=... (built, not sent)`).
// --size-only builds and measures (size, account locks) without simulating: the leashed size before the leash program is deployed.
// --assume-alt (implies --size-only): sizes with the Sprouts ALT's address list compressed in memory, before the owner creates the
// ALT (Task 22 D1). COMPUTED, not measured on chain. Refused when SPROUTS_ALT is set (then the real table is used: measure that).
// Run: cd api && pnpm tsx --env-file=.env.local scripts/simulate-legs.ts --user <seed vault> --wallet <linked wallet> --delegation <pda>
//        [--leashed] [--size-only] [--assume-alt] [--allow-post] [--pull 1000000] cbBTC hSOL USDC_LEND:kamino_klend USDC_LEND:jupiter_lend
// Exit: 0 all passed, 1 any leg failed, 2 none failed but a leg was skipped (not a pass).
import { address } from "@solana/kit";
import { buildPlantingTx, simulatePlanting, cleanupPlanting, type BuiltPlanting } from "../src/lib/planting";
import { legShortfall, type Simulation } from "../src/lib/plant-run";
import { leashLegOf, priceSourceFor } from "../src/lib/leash";
import { readDelegation } from "../src/lib/subscriptions";
import { sproutsAltAddresses } from "../src/lib/alt";
import { pullerSigner } from "../src/lib/puller";
import { accountLocks, exitCode, headroom, parseArgs, runLeg, type LegResult } from "./simulate-legs-lib";

const o = parseArgs(process.argv.slice(2));
const user = address(o.user);
const wallet = address(o.wallet);
const delegation = address(o.delegation);

const altSet = Boolean(process.env.SPROUTS_ALT);
if (o.assumeAlt && altSet) throw new Error("--assume-alt with SPROUTS_ALT set: the real table exists, measure with it (drop --assume-alt)");
const measureAlt = o.assumeAlt ? await sproutsAltAddresses((await pullerSigner()).address) : undefined;
const d = await readDelegation(delegation);
console.log(d.exists
  ? `delegation ${delegation}: delegator ${d.delegator}, allowance ${Number(d.amountPerPeriodRaw) / 1e6} USDC per period, pulled this period ${Number(d.pulledInPeriodRaw) / 1e6}`
  : `delegation ${delegation}: NOT FOUND on chain (unleashed simulations will fail at the pull)`);
console.log(`mode ${o.leashed ? "leashed" : "unleashed"}${o.sizeOnly ? " size-only" : ""}${measureAlt ? ` assume-alt (${measureAlt.length} addresses in memory, COMPUTED)` : ` SPROUTS_ALT ${altSet ? "set" : "NOT set (Jupiter's tables only)"}`}, pull ${o.pullRaw} raw USDC, ${o.noPost ? "no-post (nothing is sent)" : o.sizeOnly ? "allow-post size-only (posted prices are built and sized, NOT sent)" : "ALLOW-POST (posted prices send puller-paid VAA txs)"}`);

const results: LegResult[] = [];
for (const leg of o.legs) {
  let b: BuiltPlanting | null = null;
  let sim: Simulation | null = null;
  const r = await runLeg(leg, o, {
    priceSource: async (l) => (await priceSourceFor(leashLegOf(l.asset, l.venue))).kind,
    build: async (l, jlLeftover) => {
      b = null;
      b = await buildPlantingTx({ delegator: wallet, user, asset: l.asset, venue: l.venue, pullRaw: o.pullRaw, delegationPda: delegation, leashed: o.leashed, carryIn: {}, ...(jlLeftover !== undefined ? { jlLeftover } : {}), ...(measureAlt ? { measureAlt } : {}), ...(o.sizeOnly ? { dryPost: true } : {}) });
      return { sizeBytes: b.sizeBytes, locks: accountLocks(new Uint8Array(b.tx.messageBytes)), minOut: b.leashMinOutRaw ?? b.minOutRaw, cleanupCount: b.cleanup.length, floor: b.leashFloorRaw, priceTxBytes: b.priceTxBytes };
    },
    simulate: async () => { sim = await simulatePlanting(b as unknown as BuiltPlanting); return sim; },
    guard: () => legShortfall(sim as unknown as Simulation, b as unknown as BuiltPlanting, leg.asset, leg.venue, {}),
    cleanup: () => cleanupPlanting(b as unknown as BuiltPlanting),
    log: (line) => console.log(line),
  }).catch((e): LegResult => ({ name: leg.name, status: "fail", line: `LEG ${leg.name} ${o.leashed ? "leashed" : "unleashed"} error: ${e instanceof Error ? e.message : String(e)}`, sizeBytes: null, locks: null, units: null, jlLeftover: null }));
  console.log(r.line);
  results.push(r);
  await new Promise((res) => setTimeout(res, 3_000));   // measured 10-04: back-to-back legs hit Jupiter's 429 on the quote
}
console.log(headroom(results));
process.exit(exitCode(results));
