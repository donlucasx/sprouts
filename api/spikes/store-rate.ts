// Prints stORE's supply, the vault's ORE stake and the redeem rate the garden uses (expected about 1.048 on 2026-09-28). Read-only.
// Run from api/: pnpm tsx --env-file=.env.local spikes/store-rate.ts
import { rpc } from "../src/lib/rpc";
import { STORE_MINT } from "../src/lib/constants";
import { storeRedeemRate } from "../src/lib/store";

const supply = (await rpc().getTokenSupply(STORE_MINT).send()).value;
const rate = await storeRedeemRate();
console.log(`stORE supply: ${supply.uiAmountString} (${supply.amount} raw, ${supply.decimals} decimals)`);
console.log(`redeem rate: ${Number(rate) / 1e9} ORE per stORE (${rate} at 1e9 scale)`);
