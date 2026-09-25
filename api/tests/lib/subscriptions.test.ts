import { describe, it, expect } from "vitest";
import { address, AccountRole } from "@solana/kit";
import { buildApproveOnceIxs, buildTransferRecurringIx, delegationPda, usdcAta } from "@/lib/subscriptions";
import { SUBSCRIPTIONS_PROGRAM } from "@/lib/constants";

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
  });

  it("the delegation address is deterministic for a delegator, delegatee and nonce", async () => {
    expect(await delegationPda({ delegator, delegatee, nonce: 7n })).toBe(await delegationPda({ delegator, delegatee, nonce: 7n }));
    expect(await delegationPda({ delegator, delegatee, nonce: 7n })).not.toBe(await delegationPda({ delegator, delegatee, nonce: 8n }));
  });

  it("transfer recurring has nine accounts, delegatee signs, delegator does not", async () => {
    const pda = await delegationPda({ delegator, delegatee, nonce: 7n });
    const ix = await buildTransferRecurringIx({ delegator, delegatee, delegationPda: pda, amountRaw: 217_000n });
    expect(ix.accounts!.length).toBe(9);
    expect(ix.accounts!.some((a) => a.address === delegatee && isSigner(a.role))).toBe(true);
    expect(ix.accounts!.some((a) => a.address === delegator && isSigner(a.role))).toBe(false);
    const addresses = ix.accounts!.map((a) => a.address);
    expect(addresses).toContain(await usdcAta(delegator));
    expect(addresses).toContain(await usdcAta(delegatee));
    expect(addresses).toContain(pda);
  });
});
