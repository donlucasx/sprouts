import { describe, it, expect } from "vitest";
import { address, createNoopSigner, AccountRole } from "@solana/kit";
import { userStakePda, buildStakeIx, buildWithdrawIx, buildUnstakeIx, buildCancelUnstakeIx } from "@/lib/staking";
import { getUnstakeInstructionDataDecoder, UNSTAKE_DISCRIMINATOR, CANCEL_UNSTAKE_DISCRIMINATOR } from "@/generated/staking";
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

  // Task 7: the unstake is the one act only the Seeker's key can do; its shares are read back from the data the wallet signs.
  it("unstake instruction lists the user as the only signer and carries the shares in its data", async () => {
    const ix = await buildUnstakeIx({ user: createNoopSigner(user), shares: 80_279_232n });
    expect(ix.accounts!.filter((a) => isSigner(a.role)).map((a) => a.address)).toEqual([user]);
    expect(ix.accounts!.map((a) => a.address)).toContain(await userStakePda(user));
    expect(getUnstakeInstructionDataDecoder().decode(ix.data!).shares).toBe(80_279_232n);
    expect(ix.programAddress).toBe(SKR_STAKING_PROGRAM);
  });

  it("cancel-unstake instruction lists the user as the only signer and decodes as a cancel", async () => {
    const ix = await buildCancelUnstakeIx({ user: createNoopSigner(user) });
    expect(ix.accounts!.filter((a) => isSigner(a.role)).map((a) => a.address)).toEqual([user]);
    expect(ix.data!.slice(0, 8)).toEqual(CANCEL_UNSTAKE_DISCRIMINATOR);
    expect(ix.data!.slice(0, 8)).not.toEqual(UNSTAKE_DISCRIMINATOR);
  });
});
