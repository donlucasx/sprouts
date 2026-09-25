import { describe, it, expect } from "vitest";
import { address, createNoopSigner, AccountRole } from "@solana/kit";
import { userStakePda, buildStakeIx, buildWithdrawIx } from "@/lib/staking";
import { STAKE_CONFIG, GUARDIAN_POOL, SKR_STAKING_PROGRAM } from "@/lib/constants";

const user = address("DdpHknAJvVsG8HYTAN3ZmSLLiPh2GfXP2pMoJJFa1p9m");
const payerAddress = address("ADaL11LqTrsaqMh5XkyVGV6nE2wPdvPaR7GgFSvvJWuD");
const isSigner = (role: AccountRole) => role === AccountRole.READONLY_SIGNER || role === AccountRole.WRITABLE_SIGNER;

describe("staking helpers", () => {
  it("derives the same UserStake PDA twice", async () => {
    expect(await userStakePda(user)).toBe(await userStakePda(user));
  });

  it("stake instruction lists payer as the only signer and user as a non-signer", async () => {
    const ix = await buildStakeIx({ payer: createNoopSigner(payerAddress), user, amountRaw: 1_000_000n });
    const signers = ix.accounts!.filter((a) => isSigner(a.role)).map((a) => a.address);
    expect(signers).toEqual([payerAddress]);
    const addresses = ix.accounts!.map((a) => a.address);
    expect(addresses).toContain(user);
    expect(addresses).toContain(STAKE_CONFIG);
    expect(addresses).toContain(GUARDIAN_POOL);
    expect(ix.programAddress).toBe(SKR_STAKING_PROGRAM);
  });

  it("withdraw instruction has no signer at all", async () => {
    const ix = await buildWithdrawIx({ user });
    expect(ix.accounts!.some((a) => isSigner(a.role))).toBe(false);
    expect(ix.accounts!.map((a) => a.address)).toContain(user);
  });
});
