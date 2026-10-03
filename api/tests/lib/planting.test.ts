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

import { skrChangeFromMeta } from "@/lib/planting";

// Security audit R207 #2: the SKR remainder is read from the confirmed transaction's own balances, the puller's SKR only, so other
// owners and other mints in the same transaction do not count.
describe("skrChangeFromMeta", () => {
  const SKR = "SKRbvo6Gf7GondiT3BbTfuRDPqLWei4j2Qy2NPGZhW3";
  const PULLER = "9H7ChDC2o32wC8jcpVDjLGQhwyx1hmLW1fiCjsjUuzFm";
  const bal = (owner: string, amount: string, mint = SKR) => ({ mint, owner, uiTokenAmount: { amount } });
  it("is post minus pre for the puller's SKR, ignoring other owners and mints", () => {
    const meta = {
      preTokenBalances: [bal(PULLER, "5000"), bal(USER, "10"), bal(PULLER, "999", "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v")],
      postTokenBalances: [bal(PULLER, "5250"), bal(USER, "999999"), bal(PULLER, "0", "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v")],
    };
    expect(skrChangeFromMeta(meta, PULLER)).toBe(250n);
    expect(skrChangeFromMeta({ preTokenBalances: [], postTokenBalances: [bal(PULLER, "40")] }, PULLER)).toBe(40n); // account created in the transaction
    expect(skrChangeFromMeta({ preTokenBalances: [bal(PULLER, "500")], postTokenBalances: [bal(PULLER, "300")] }, PULLER)).toBe(-200n); // a carry drew more than the swap left
  });
  it("throws when the puller's SKR account is not in the transaction at all", () => {
    expect(() => skrChangeFromMeta({ preTokenBalances: [bal(USER, "1")], postTokenBalances: null }, PULLER)).toThrow(/no SKR account/);
  });
});
