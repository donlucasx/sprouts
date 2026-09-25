import { describe, it, expect } from "vitest";
import { address, AccountRole, createNoopSigner } from "@solana/kit";
import { buildApproveOnceIxs, buildTransferRecurringIx, delegationPda, usdcAta } from "@/lib/subscriptions";
import { SUBSCRIPTIONS_PROGRAM } from "@/lib/constants";
import { UNKNOWN_INIT_ID, getCreateRecurringDelegationInstructionDataDecoder } from "@solana/subscriptions";

const delegator = address("9H7ChDC2o32wC8jcpVDjLGQhwyx1hmLW1fiCjsjUuzFm");
const delegatee = address("4wiD3N7FrBNJSmZUQDkGHM4CsvDrvyvx7G1FApLGEbJ1");
const isSigner = (role: AccountRole) => role === AccountRole.READONLY_SIGNER || role === AccountRole.WRITABLE_SIGNER;

describe("subscriptions builders", () => {
  it("approve-once is two instructions on the Subscriptions program, delegator signs both", async () => {
    const ixs = await buildApproveOnceIxs({ delegator, delegatee, capRaw: 5_000_000n, nonce: 7n });
    expect(ixs.length).toBe(2);
    for (const ix of ixs) {
      expect(ix.programAddress).toBe(SUBSCRIPTIONS_PROGRAM);
      expect(ix.accounts!.some((a) => a.address === delegator && isSigner(a.role))).toBe(true);
    }
    // One-transaction signup: the authority is initialised in the same slot, so the create carries the SDK's sentinel,
    // not 0 (0 fails on chain with STALE_SUBSCRIPTION_AUTHORITY, error 136; Spike 3a, 2026-09-25).
    const data = getCreateRecurringDelegationInstructionDataDecoder().decode(ixs[1].data!);
    expect(data.recurringDelegation.expectedSubscriptionAuthorityInitId).toBe(UNKNOWN_INIT_ID);
  });

  it("the delegation address is deterministic for a delegator, delegatee and nonce", async () => {
    expect(await delegationPda({ delegator, delegatee, nonce: 7n })).toBe(await delegationPda({ delegator, delegatee, nonce: 7n }));
    expect(await delegationPda({ delegator, delegatee, nonce: 7n })).not.toBe(await delegationPda({ delegator, delegatee, nonce: 8n }));
  });

  it("transfer recurring has nine accounts, delegatee signs, delegator does not", async () => {
    const pda = await delegationPda({ delegator, delegatee, nonce: 7n });
    const delegateeSigner = createNoopSigner(delegatee);
    const ix = await buildTransferRecurringIx({ delegator, delegatee: delegateeSigner, delegationPda: pda, amountRaw: 217_000n });
    expect(ix.accounts!.length).toBe(9);
    expect(ix.accounts!.some((a) => a.address === delegatee && isSigner(a.role))).toBe(true);
    // the caller's signer instance rides on the account, so the fee payer and this account are one signer (kit refuses two per address)
    expect(ix.accounts!.some((a) => a.address === delegatee && (a as { signer?: unknown }).signer === delegateeSigner)).toBe(true);
    expect(ix.accounts!.some((a) => a.address === delegator && isSigner(a.role))).toBe(false);
    const addresses = ix.accounts!.map((a) => a.address);
    expect(addresses).toContain(await usdcAta(delegator));
    expect(addresses).toContain(await usdcAta(delegatee));
    expect(addresses).toContain(pda);
  });
});
