// Reads a wallet's USDC subscription authority (exists? init id?) and its delegation to the puller, read-only.
// Run from api/: pnpm tsx --env-file=.env.local spikes/read-authority.ts <wallet> [nonce]
import { address } from "@solana/kit";
import { readSubscriptionAuthority, delegationPda, readDelegation } from "../src/lib/subscriptions";
import { pullerSigner } from "../src/lib/puller";

const wallet = address(process.argv[2] ?? "");
const authority = await readSubscriptionAuthority(wallet);
console.log(authority.exists ? `authority EXISTS, initId ${authority.initId}` : "authority MISSING (fresh wallet: two-instruction approval)");
if (process.argv[3]) {
  const puller = (await pullerSigner()).address;
  const pda = await delegationPda({ delegator: wallet, delegatee: puller, nonce: BigInt(process.argv[3]) });
  const d = await readDelegation(pda);
  console.log(`delegation ${pda}: ${d.exists ? `cap ${d.amountPerPeriodRaw} raw/period, pulled ${d.pulledInPeriodRaw}` : "missing"}`);
}
