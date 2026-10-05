import { describe, it, expect, vi } from "vitest";
import { findAssociatedTokenPda, TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";

vi.mock("@/lib/config", () => ({ config: () => ({ feeWallet: "8KiTtZXjcpxUGuH93G12iMVNcTYteTbRvaovdeQdfjc6" }) }));
import { address } from "@solana/kit";
import { sproutsAltAddresses } from "@/lib/alt";
import { KLEND, JLEND, PYTH_ACCOUNT } from "@/lib/venues/addresses";
import { LEASH_PROGRAM, SUBSCRIPTIONS_PROGRAM, USDC_MINT } from "@/lib/constants";
import { leashConfigPda } from "@/lib/leash";

describe("the Sprouts lookup table's contents (contracts 3.2, PROVISIONAL(S1))", () => {
  it("holds the leash, venue, Pyth and staking static accounts, each once, within 256", async () => {
    const list = await sproutsAltAddresses(address("4wiD3N7FrBNJSmZUQDkGHM4CsvDrvyvx7G1FApLGEbJ1"));
    for (const a of [LEASH_PROGRAM, await leashConfigPda(), SUBSCRIPTIONS_PROGRAM, KLEND.USDC_LEND.reserve, KLEND.SOL_LEND.supplyVault, JLEND.SOL_LEND.lending, JLEND.USDC_LEND.rewardsRateModel, PYTH_ACCOUNT.SOL, PYTH_ACCOUNT.ORE]) expect(list).toContain(a);
    expect(new Set(list).size).toBe(list.length);
    // T9 review M1: the fee wallet's USDC ATA (every coin leg's swap) and the cbBTC sponsored price account (leg 7)
    const [feeAta] = await findAssociatedTokenPda({ owner: address("8KiTtZXjcpxUGuH93G12iMVNcTYteTbRvaovdeQdfjc6"), mint: USDC_MINT, tokenProgram: TOKEN_PROGRAM_ADDRESS });
    expect(list).toContain(feeAta);
    expect(list).toContain(PYTH_ACCOUNT.CBBTC);
    expect(list.length).toBe(56);
    expect(list.length).toBeLessThanOrEqual(256);
  });
});
