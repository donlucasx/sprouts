import { describe, it, expect } from "vitest";
import { generateKeyPairSigner, address } from "@solana/kit";
import { ASSOCIATED_TOKEN_PROGRAM_ADDRESS, findAssociatedTokenPda, TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import { storeAccountInstructions } from "@/lib/planting";
import { STORE_MINT } from "@/lib/constants";

const USER = address("52vzF8A1qEL7qTY7HiRnvTrXSMN4FkTANZ1DYKQBiF6e");
const FEE = address("9H7ChDC2o32wC8jcpVDjLGQhwyx1hmLW1fiCjsjUuzFm");

// audits/ore-plan, finding 3: Jupiter assumes a custom destination account exists, so an stORE leg creates the user's and the
// fee wallet's stORE token accounts itself (idempotently, the puller paying the rent). An SKR leg needs nothing.
describe("storeAccountInstructions", () => {
  it("adds nothing for an SKR leg", async () => {
    const payer = await generateKeyPairSigner();
    expect(await storeAccountInstructions({ asset: "SKR", payer, user: USER, feeWallet: FEE })).toEqual([]);
  });

  it("creates the user's and the fee wallet's stORE token accounts idempotently for an stORE leg", async () => {
    const payer = await generateKeyPairSigner();
    const ixs = await storeAccountInstructions({ asset: "stORE", payer, user: USER, feeWallet: FEE });
    expect(ixs.length).toBe(2);
    const [userAta] = await findAssociatedTokenPda({ owner: USER, mint: STORE_MINT, tokenProgram: TOKEN_PROGRAM_ADDRESS });
    const [feeAta] = await findAssociatedTokenPda({ owner: FEE, mint: STORE_MINT, tokenProgram: TOKEN_PROGRAM_ADDRESS });
    for (const [i, owner, ata] of [[0, USER, userAta], [1, FEE, feeAta]] as const) {
      const ix = ixs[i];
      expect(ix.programAddress).toBe(ASSOCIATED_TOKEN_PROGRAM_ADDRESS);
      expect(Array.from(ix.data ?? [])).toEqual([1]); // 1 = CreateIdempotent, so an existing account is not an error
      const accounts = (ix.accounts ?? []).map((a) => a.address);
      expect(accounts[0]).toBe(payer.address);
      expect(accounts[1]).toBe(ata);
      expect(accounts[2]).toBe(owner);
      expect(accounts[3]).toBe(STORE_MINT);
    }
  });
});
