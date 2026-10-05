import { describe, it, expect, beforeEach, beforeAll, vi } from "vitest";
import { generateKeyPairSigner, getBase64Encoder, getTransactionDecoder, getCompiledTransactionMessageDecoder, decompileTransactionMessage, compileTransaction, signTransaction, getBase64EncodedWireTransaction, type KeyPairSigner, type Instruction } from "@solana/kit";
import { MemoryRepo } from "@/db/memory";
import { setRepoForTests } from "@/db/repo";
import { issueSession } from "@/lib/session";
import { checkBeforeSigning } from "../fixtures/app/sign";

let receipt = 1_661_072n;
let available = 10n ** 12n;
vi.mock("@/lib/rpc", () => ({ rpc: () => ({ getLatestBlockhash: () => ({ send: async () => ({ value: { blockhash: "GHtXQBsoZHVnNFa9YevAzFr17DJjgHXk3ycTKD5xD3Zi", lastValidBlockHeight: 1n } }) }) }) }));
vi.mock("@/lib/holdings", async (orig) => ({ ...(await orig<object>()), receiptBalanceRaw: vi.fn(async () => receipt) }));
vi.mock("@/lib/venues/klend", async (orig) => ({ ...(await orig<object>()), klendRate: vi.fn(async () => ({ rn: 12_050n, rd: 10_000n, availableRaw: available })) }));
let jlAvailable = 10n ** 12n;
vi.mock("@/lib/venues/jlend", async (orig) => ({ ...(await orig<object>()), jlendRate: vi.fn(async () => ({ rn: 11n, rd: 10n })) }));
vi.mock("@/lib/venues/withdrawable", () => ({ jupiterWithdrawableRaw: vi.fn(async () => jlAvailable) }));
vi.mock("@/lib/user-tx", async (orig) => ({ ...(await orig<object>()), sendPosted: vi.fn(async () => {}), waitConfirmed: vi.fn(async () => "confirmed") }));

import { POST as build } from "@/app/api/lend/withdraw/build/route";
import { POST as confirm } from "@/app/api/lend/withdraw/confirm/route";

let user: KeyPairSigner;
beforeAll(async () => { process.env.SESSION_SECRET ??= "test-secret-test-secret-test-secret"; user = await generateKeyPairSigner(); });

describe("Withdraw a lending position (contracts 5.3, R264)", () => {
  let repo: MemoryRepo;
  beforeEach(async () => { repo = new MemoryRepo(); setRepoForTests(repo); await repo.upsertUser({ seedVaultPubkey: user.address, sgtMint: "M", skrName: null }); receipt = 1_661_072n; available = 10n ** 12n; jlAvailable = 10n ** 12n; });
  const call = async (fn: typeof build, body: unknown) => fn(new Request("http://x", { method: "POST", headers: { authorization: `Bearer ${await issueSession(user.address, "M")}` }, body: JSON.stringify(body) }));
  const sign = async (b64: string) => getBase64EncodedWireTransaction(await signTransaction([user.keyPair], getTransactionDecoder().decode(getBase64Encoder().encode(b64))));

  it("builds the whole position's redeem, unsigned, the user paying, no lookup table", async () => {
    const res = await call(build, { asset: "USDC_LEND", venue: "kamino_klend" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ receiptRaw: "1661072", expectedOutRaw: "2001591" });   // 1_661_072 x 12_050 / 10_000
    const msg = getCompiledTransactionMessageDecoder().decode(getTransactionDecoder().decode(getBase64Encoder().encode(body.transaction)).messageBytes);
    expect(msg.staticAccounts[0]).toBe(user.address);
    expect("addressTableLookups" in msg ? msg.addressTableLookups?.length ?? 0 : 0).toBe(0);
  });
  it("409s: nothing to withdraw; a full pool says so plainly", async () => {
    receipt = 0n;
    expect((await call(build, { asset: "USDC_LEND", venue: "kamino_klend" })).status).toBe(409);
    receipt = 1_661_072n; available = 1n;
    const res = await call(build, { asset: "USDC_LEND", venue: "kamino_klend" });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "A venue can pause withdrawals when its pool is fully lent out; your money stays yours.", poolFull: true });
  });
  it("confirm sends the user's signed redeem, records it with the underlying amount", async () => {
    const built = await (await call(build, { asset: "USDC_LEND", venue: "kamino_klend" })).json();
    const res = await call(confirm, { signedTransaction: await sign(built.transaction), asset: "USDC_LEND", venue: "kamino_klend" });
    expect(res.status).toBe(200);
    expect((await res.json()).withdrawn).toMatchObject({ asset: "USDC_LEND", venue: "kamino_klend", receiptRaw: "1661072", underlyingRaw: "2001591" });
    expect(repo.events.find((e) => e.kind === "lend_withdrawn")?.detail).toMatchObject({ receiptRaw: "1661072", underlyingRaw: "2001591" });
  });
  it("confirm refuses a redeem into another account (rebuilt and compared)", async () => {
    const built = await (await call(build, { asset: "USDC_LEND", venue: "kamino_klend" })).json();
    const t = getTransactionDecoder().decode(getBase64Encoder().encode(built.transaction));
    const m = decompileTransactionMessage(getCompiledTransactionMessageDecoder().decode(t.messageBytes));
    const other = (await generateKeyPairSigner()).address;
    const tampered = { ...m, instructions: (m.instructions as readonly Instruction[]).map((ix, i) => (i === 2 ? { ...ix, accounts: ix.accounts!.map((a, j) => (j === 8 ? { ...a, address: other } : a)) } : ix)) };
    const wire = getBase64EncodedWireTransaction(await signTransaction([user.keyPair], compileTransaction(tampered as typeof m)));
    expect((await call(confirm, { signedTransaction: wire, asset: "USDC_LEND", venue: "kamino_klend" })).status).toBe(400);
  });

  it("the route's transaction passes the app's own check with the receiptRaw it answers (USDC and SOL, both venues)", async () => {
    for (const asset of ["USDC_LEND", "SOL_LEND"] as const) for (const venue of ["kamino_klend", "jupiter_lend"] as const) {
      const body = await (await call(build, { asset, venue })).json();
      const tx = getTransactionDecoder().decode(getBase64Encoder().encode(body.transaction));
      await expect(checkBeforeSigning(tx, { kind: venue === "kamino_klend" ? "withdraw_klend" : "withdraw_jlend", user: user.address, asset, receiptRaw: body.receiptRaw })).resolves.toBeUndefined();
    }
  });
  it("Jupiter Lend: the pool-full check reads its withdrawable", async () => {
    jlAvailable = 1_827_178n;   // 1_661_072 x 11 / 10 = 1_827_179: one short
    const res = await call(build, { asset: "USDC_LEND", venue: "jupiter_lend" });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "A venue can pause withdrawals when its pool is fully lent out; your money stays yours.", poolFull: true });
    jlAvailable = 1_827_179n;
    expect((await call(build, { asset: "USDC_LEND", venue: "jupiter_lend" })).status).toBe(200);
  });
});
