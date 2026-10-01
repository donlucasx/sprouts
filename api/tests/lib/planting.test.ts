import { describe, it, expect } from "vitest";
import { generateKeyPairSigner, address } from "@solana/kit";
import { ASSOCIATED_TOKEN_PROGRAM_ADDRESS, findAssociatedTokenPda, TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import { coinAccountInstructions } from "@/lib/planting";
import { COINS } from "@/domain/coins";

const USER = address("52vzF8A1qEL7qTY7HiRnvTrXSMN4FkTANZ1DYKQBiF6e");

// Spec 7.3: every wallet-held coin lands in the user's own token account, created idempotently in the same transaction, the
// puller paying the rent once per coin. SKR needs nothing (it is staked from the puller's account). The fee wallet needs no
// per-coin account any more: the fee is taken in USDC (R105).
describe("coinAccountInstructions", () => {
  it("adds nothing for an SKR leg", async () => {
    const payer = await generateKeyPairSigner();
    expect(await coinAccountInstructions({ asset: "SKR", payer, user: USER })).toEqual([]);
  });

  for (const asset of ["stORE", "hSOL", "JitoSOL", "JupSOL", "cbBTC"] as const) {
    it(`creates only the user's ${asset} token account, idempotently`, async () => {
      const payer = await generateKeyPairSigner();
      const ixs = await coinAccountInstructions({ asset, payer, user: USER });
      expect(ixs.length).toBe(1);
      const [ata] = await findAssociatedTokenPda({ owner: USER, mint: COINS[asset].mint, tokenProgram: TOKEN_PROGRAM_ADDRESS });
      const ix = ixs[0];
      expect(ix.programAddress).toBe(ASSOCIATED_TOKEN_PROGRAM_ADDRESS);
      expect(Array.from(ix.data ?? [])).toEqual([1]); // CreateIdempotent
      const accounts = (ix.accounts ?? []).map((a) => a.address);
      expect(accounts[0]).toBe(payer.address);
      expect(accounts[1]).toBe(ata);
      expect(accounts[2]).toBe(USER);
      expect(accounts[3]).toBe(COINS[asset].mint);
    });
  }
});
