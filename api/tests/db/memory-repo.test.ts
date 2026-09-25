import { describe, it, expect } from "vitest";
import { MemoryRepo } from "@/db/memory";

async function withWallet() {
  const r = new MemoryRepo();
  await r.upsertUser({ seedVaultPubkey: "U", sgtMint: "M", skrName: null });
  await r.addWallet({ pubkey: "W", userPubkey: "U", delegationPda: "D", dailyCapCents: 500 });
  return r;
}

const swap = (signature: string, roundupCents = 83) => ({
  signature, walletPubkey: "W", ts: new Date(), inMint: "a", inAmount: 1, outMint: "b", outAmount: 1,
  usdSizeCents: 117, class: "memecoin" as const, roundupCents,
});

describe("MemoryRepo", () => {
  it("insertSwap rejects a duplicate signature", async () => {
    const r = await withWallet();
    expect(await r.insertSwap(swap("sig1"))).toBe(true);
    expect(await r.insertSwap(swap("sig1"))).toBe(false);
    expect((await r.unplantedSwaps("W")).length).toBe(1);
  });

  it("useNonce works once and refuses expired", async () => {
    const r = new MemoryRepo();
    await r.putNonce({ nonce: "n1", expiresAt: new Date(Date.now() + 60_000) });
    expect(await r.useNonce("n1", "p")).toBe(true);
    expect(await r.useNonce("n1", "p")).toBe(false);
    await r.putNonce({ nonce: "n2", expiresAt: new Date(Date.now() - 1) });
    expect(await r.useNonce("n2", "p")).toBe(false);
  });

  it("getRules creates defaults and saveRules changes them", async () => {
    const r = new MemoryRepo();
    expect((await r.getRules("U")).dailyCapCents).toBe(500);
    await r.saveRules("U", { roundupOn: false });
    expect((await r.getRules("U")).roundupOn).toBe(false);
  });

  it("markPlanted removes swaps from the unplanted set", async () => {
    const r = await withWallet();
    await r.insertSwap(swap("s", 100));
    const p = await r.insertPlanting(
      { userPubkey: "U", walletPubkey: "W", signature: null, usdcPulledCents: 103, networkFeeCents: 3, status: "sent", aiLine: null },
      [{ asset: "SKR", usdcInCents: 100, amountOutRaw: 4_800_000n, staked: true, feeAmountRaw: 24_000n }],
    );
    await r.markPlanted(["s"], p.id);
    expect((await r.unplantedSwaps("W")).length).toBe(0);
  });

  it("link codes: peek, bind, take; a taken code cannot be peeked again", async () => {
    const r = new MemoryRepo();
    await r.putLinkCode({ code: "ABC234", userPubkey: "U", expiresAt: new Date(Date.now() + 60_000), nonce: 7n });
    expect((await r.peekLinkCode("ABC234"))?.nonce).toBe(7n);
    await r.bindLinkCode("ABC234", "W", "PDA");
    expect((await r.peekLinkCode("ABC234"))?.walletPubkey).toBe("W");
    expect(await r.takeLinkCode("ABC234", "OTHER")).toBeNull();
    expect((await r.takeLinkCode("ABC234", "W"))?.delegationPda).toBe("PDA");
    expect(await r.peekLinkCode("ABC234")).toBeNull();
    expect(await r.takeLinkCode("ABC234", "W")).toBeNull();
  });

  it("wallet status and the ledger", async () => {
    const r = await withWallet();
    expect((await r.listActiveWallets()).length).toBe(1);
    await r.setWalletStatus("W", "paused");
    expect((await r.listActiveWallets()).length).toBe(0);
    expect((await r.listPausedWallets()).length).toBe(1);
    await r.bumpLedger("W", "SKR", 215);
    expect((await r.getWallet("W"))?.ledgerSkrCents).toBe(215);
  });
});
