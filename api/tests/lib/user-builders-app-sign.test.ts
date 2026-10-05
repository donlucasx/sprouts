import { describe, it, expect, vi } from "vitest";
import { address, getBase64Encoder, getTransactionDecoder, getCompiledTransactionMessageDecoder, type Address, type Instruction } from "@solana/kit";
import { buildLendWithdraw, buildMove, buildRelink } from "@/lib/venues/user-builders";
import { buildUserTransaction } from "@/lib/user-tx";
import { delegationPda } from "@/lib/subscriptions";
import { leashPda } from "@/lib/leash";
import { receiptBalanceRaw, readLendingPositions } from "@/lib/holdings";
// The APP's verifier (app/src/lib/sign.ts, vendored verbatim but for its coins import): what the Seed Vault refuses, run on our output.
import { checkBeforeSigning, SignRefused, type SignFlow } from "../fixtures/app/sign";

const asked: { one: string[]; many: string[] } = { one: [], many: [] };
vi.mock("@/lib/rpc", () => ({ rpc: () => ({
  getLatestBlockhash: () => ({ send: async () => ({ value: { blockhash: "GHtXQBsoZHVnNFa9YevAzFr17DJjgHXk3ycTKD5xD3Zi", lastValidBlockHeight: 1n } }) }),
  // The receipt reads: which accounts each asks for (no account on chain: both answer 0 / no position).
  getAccountInfo: (a: string) => ({ send: async () => { asked.one.push(a); return { value: null }; } }),
  getMultipleAccounts: (as: string[]) => ({ send: async () => { asked.many.push(...as); return { value: as.map(() => null) }; } }),
}) }));

const USER = address("52vzF8A1qEL7qTY7HiRnvTrXSMN4FkTANZ1DYKQBiF6e");
const COMPUTE_BUDGET = "ComputeBudget111111111111111111111111111111";
const ASSETS = ["USDC_LEND", "SOL_LEND"] as const;
const VENUES = ["kamino_klend", "jupiter_lend"] as const;
const RECEIPT = 1_661_072n;

/** The exact wire the build route answers (buildUserTransaction), decoded as the phone decodes it. */
const wire = async (ixs: Instruction[]) => getTransactionDecoder().decode(getBase64Encoder().encode(await buildUserTransaction(USER, ixs)));
const programsOf = (tx: Awaited<ReturnType<typeof wire>>) => {
  const m = getCompiledTransactionMessageDecoder().decode(tx.messageBytes) as unknown as { staticAccounts: string[]; instructions: { programAddressIndex: number }[] };
  return m.instructions.map((ix) => m.staticAccounts[ix.programAddressIndex]);
};
const withdrawFlow = (asset: (typeof ASSETS)[number], venue: (typeof VENUES)[number], receiptRaw: bigint): SignFlow =>
  ({ kind: venue === "kamino_klend" ? "withdraw_klend" : "withdraw_jlend", user: USER, asset, receiptRaw: receiptRaw.toString() });

describe("the app's sign.ts accepts what the API builds (contracts 6; AMEND s20 no ComputeBudget)", () => {
  for (const asset of ASSETS) for (const venue of VENUES) {
    it(`withdraw ${asset} from ${venue}: accepted; no ComputeBudget; a different position is refused`, async () => {
      const tx = await wire(await buildLendWithdraw({ user: USER, asset, venue, receiptRaw: RECEIPT }));
      await expect(checkBeforeSigning(tx, withdrawFlow(asset, venue, RECEIPT))).resolves.toBeUndefined();
      expect(programsOf(tx)).not.toContain(COMPUTE_BUDGET);
      // The check is not vacuous: the screen's position one unit off, or the other venue's flow, refuses.
      await expect(checkBeforeSigning(tx, withdrawFlow(asset, venue, RECEIPT + 1n))).rejects.toBeInstanceOf(SignRefused);
      await expect(checkBeforeSigning(tx, withdrawFlow(asset, venue === "kamino_klend" ? "jupiter_lend" : "kamino_klend", RECEIPT))).rejects.toBeInstanceOf(SignRefused);
    });
  }

  for (const asset of ASSETS) for (const from of VENUES) for (const part of ["redeem", "deposit", "whole"] as const) {
    const to = from === "kamino_klend" ? "jupiter_lend" : "kamino_klend";
    it(`move ${asset} ${from} -> ${to}, part ${part}: accepted, no ComputeBudget`, async () => {
      const tx = await wire(await buildMove({ user: USER, asset, from, to, receiptRaw: RECEIPT, depositRaw: 2_000_000n, part }));
      const flow: SignFlow = { kind: from === "kamino_klend" ? "move_klend_to_jlend" : "move_jlend_to_klend", user: USER, asset, receiptRaw: RECEIPT.toString(), depositRaw: "2000000", depositCapRaw: "2001591", part };
      await expect(checkBeforeSigning(tx, flow)).resolves.toBeUndefined();
      expect(programsOf(tx)).not.toContain(COMPUTE_BUDGET);
    });
  }

  it("relink (both shapes): accepted, no ComputeBudget; the puller as delegatee would be refused", async () => {
    const old = await delegationPda({ delegator: USER, delegatee: address("HJCJKRQLV2HVKfe3sFdTF5jjBY1xfWgnK8cLcjH7qnHd"), nonce: 1n });
    for (const ixs of [
      await buildRelink({ user: USER, nonce: 7n, startTs: 1_791_200_000n, existingDelegationPda: old, existingInitId: 3n, createAta: false }),
      await buildRelink({ user: USER, nonce: 8n, startTs: 1_791_200_000n, existingDelegationPda: null, createAta: true }),
    ]) {
      const tx = await wire(ixs);
      await expect(checkBeforeSigning(tx, { kind: "relink", user: USER })).resolves.toBeUndefined();
      expect(programsOf(tx)).not.toContain(COMPUTE_BUDGET);
    }
    expect(await leashPda(USER, USER)).not.toBe("HJCJKRQLV2HVKfe3sFdTF5jjBY1xfWgnK8cLcjH7qnHd" as Address);
  });

  it("a ComputeBudget instruction in a withdraw is refused by the app (why the builders never add one)", async () => {
    const ixs = await buildLendWithdraw({ user: USER, asset: "USDC_LEND", venue: "kamino_klend", receiptRaw: RECEIPT });
    const cu: Instruction = { programAddress: address(COMPUTE_BUDGET), data: new Uint8Array([2, 0x40, 0x0d, 0x03, 0]) };
    await expect(checkBeforeSigning(await wire([cu, ...ixs]), withdrawFlow("USDC_LEND", "kamino_klend", RECEIPT))).rejects.toBeInstanceOf(SignRefused);
  });

  it("the build's receiptRaw reads the same account /api/me's positions read (the app stops when they differ)", async () => {
    await readLendingPositions(USER);
    for (const asset of ASSETS) for (const venue of VENUES) {
      asked.one.length = 0;
      expect(await receiptBalanceRaw(USER, asset, venue)).toBe(0n);
      expect(asked.one).toHaveLength(1);
      expect(asked.many).toContain(asked.one[0]);
    }
    expect(new Set(asked.many).size).toBe(4);
  });
});
