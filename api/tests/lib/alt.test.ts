import { describe, it, expect } from "vitest";
import { address } from "@solana/kit";
import { sproutsAltAddresses } from "@/lib/alt";
import { KLEND, JLEND, PYTH_ACCOUNT } from "@/lib/venues/addresses";
import { LEASH_PROGRAM, SUBSCRIPTIONS_PROGRAM } from "@/lib/constants";
import { leashConfigPda } from "@/lib/leash";

describe("the Sprouts lookup table's contents (contracts 3.2, PROVISIONAL(S1))", () => {
  it("holds the leash, venue, Pyth and staking static accounts, each once, within 256", async () => {
    const list = await sproutsAltAddresses(address("4wiD3N7FrBNJSmZUQDkGHM4CsvDrvyvx7G1FApLGEbJ1"));
    for (const a of [LEASH_PROGRAM, await leashConfigPda(), SUBSCRIPTIONS_PROGRAM, KLEND.USDC_LEND.reserve, KLEND.SOL_LEND.supplyVault, JLEND.SOL_LEND.lending, JLEND.USDC_LEND.rewardsRateModel, PYTH_ACCOUNT.SOL, PYTH_ACCOUNT.ORE]) expect(list).toContain(a);
    expect(new Set(list).size).toBe(list.length);
    expect(list.length).toBeLessThanOrEqual(256);
  });
});
