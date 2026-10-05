import { existsSync, readFileSync } from "node:fs";
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
vi.mock("@/lib/venues/rates", () => ({ jupiterWithdrawableRaw: vi.fn(async () => jlAvailable) }));
vi.mock("@/lib/user-tx", async (orig) => ({ ...(await orig<object>()), sendPosted: vi.fn(async () => {}), waitConfirmed: vi.fn(async () => "confirmed"), settleUnconfirmed: vi.fn(async () => "pending") }));

import { sendPosted, waitConfirmed, settleUnconfirmed, STILL_WAITING } from "@/lib/user-tx";
import { klendRate } from "@/lib/venues/klend";
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

  // ---- Task 18 carries ----
  const built = async (asset = "USDC_LEND", venue = "kamino_klend") => (await call(build, { asset, venue })).json();
  const confirmBody = async (b: { transaction: string }, asset = "USDC_LEND", venue = "kamino_klend") => ({ signedTransaction: await sign(b.transaction), asset, venue });

  it("a replayed confirm (same signature) books one event, answers with the recorded one", async () => {
    const body = await confirmBody(await built());
    const first = await call(confirm, body);
    const second = await call(confirm, body);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual(await first.json());
    expect(repo.events.filter((e) => e.kind === "lend_withdrawn").length).toBe(1);
  });
  it("build: a venue read that fails is a plain 503, no stack, no 'Nothing moved'", async () => {
    vi.mocked(klendRate).mockRejectedValueOnce(new Error("rpc 500 at /secret/path.ts:12"));
    const res = await call(build, { asset: "USDC_LEND", venue: "kamino_klend" });
    expect(res.status).toBe(503);
    const { error } = await res.json();
    expect(error).toBe("Could not read the venue just now. Try again in a minute.");
    expect(error).not.toMatch(/Nothing moved|secret|rpc/);
  });
  it("build: the Jupiter Lend read failing (rate or withdrawable) is the same plain 503", async () => {
    const { jlendRate } = await import("@/lib/venues/jlend");
    const { jupiterWithdrawableRaw } = await import("@/lib/venues/rates");
    vi.mocked(jlendRate).mockRejectedValueOnce(new Error("jup 500 at /secret/path.ts:9"));
    let res = await call(build, { asset: "USDC_LEND", venue: "jupiter_lend" });
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe("Could not read the venue just now. Try again in a minute.");
    vi.mocked(jupiterWithdrawableRaw).mockRejectedValueOnce(new Error("earn answered 429"));
    res = await call(build, { asset: "SOL_LEND", venue: "jupiter_lend" });
    expect(res.status).toBe(503);
    expect(JSON.stringify(await res.json())).not.toMatch(/429|secret|Nothing moved/);
  });
  it("confirm: a withdrawal larger than the position is refused (400), nothing sent", async () => {
    const body = await confirmBody(await built());
    receipt = 1_000n;
    vi.mocked(sendPosted).mockClear();
    expect((await call(confirm, body)).status).toBe(400);
    expect(sendPosted).not.toHaveBeenCalled();
    expect(repo.events.some((e) => e.kind === "lend_withdrawn")).toBe(false);
  });
  it("confirm: a transaction with no redeem of the venue's program is not a withdrawal (400)", async () => {
    const b = await built();
    const t = getTransactionDecoder().decode(getBase64Encoder().encode(b.transaction));
    const m = decompileTransactionMessage(getCompiledTransactionMessageDecoder().decode(t.messageBytes));
    const onlyAta = { ...m, instructions: (m.instructions as readonly Instruction[]).slice(0, 1) };
    const wire = getBase64EncodedWireTransaction(await signTransaction([user.keyPair], compileTransaction(onlyAta as typeof m)));
    const res = await call(confirm, { signedTransaction: wire, asset: "USDC_LEND", venue: "kamino_klend" });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("That is not a withdrawal.");
  });
  it("confirm: a failed rate read records the withdrawal with a null underlyingRaw (the money moved)", async () => {
    const body = await confirmBody(await built());
    vi.mocked(klendRate).mockRejectedValueOnce(new Error("rate down"));
    const res = await call(confirm, body);
    expect(res.status).toBe(200);
    expect((await res.json()).withdrawn).toMatchObject({ receiptRaw: "1661072", underlyingRaw: null });
    expect(repo.events.find((e) => e.kind === "lend_withdrawn")?.detail).toMatchObject({ underlyingRaw: null });
  });
  it("confirm: unsettled sends are 409 with the plain sentences and record nothing (failed, expired, still pending)", async () => {
    const body = await confirmBody(await built());
    const cases: [string, string][] = [["failed", "The withdrawal failed on chain. Nothing moved."], ["expired", "It did not go through. Nothing moved. Try again."], ["pending", STILL_WAITING.withdraw]];
    for (const [state, sentence] of cases) {
      vi.mocked(waitConfirmed).mockResolvedValueOnce(state === "failed" ? "failed" : "pending");
      if (state !== "failed") vi.mocked(settleUnconfirmed).mockResolvedValueOnce(state === "expired" ? "expired" : "pending");
      const res = await call(confirm, body);
      expect(res.status).toBe(409);
      expect((await res.json()).error).toBe(sentence);
    }
    expect(repo.events.some((e) => e.kind === "lend_withdrawn")).toBe(false);
  });
  it("confirm: a throw while sending or confirming is the 'may still go through' 409, never a 500", async () => {
    const body = await confirmBody(await built());
    vi.mocked(sendPosted).mockRejectedValueOnce(new Error("socket hang up"));
    vi.mocked(waitConfirmed).mockRejectedValueOnce(new Error("rpc down"));
    const res = await call(confirm, body);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe(STILL_WAITING.withdraw);
  });
  it("confirm: an event write that throws after the withdrawal confirmed is still a 200 with the withdrawn body, and logged", async () => {
    const body = await confirmBody(await built());
    vi.spyOn(repo, "addEvent").mockRejectedValueOnce(new Error("db down"));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await call(confirm, body);
    expect(res.status).toBe(200);
    expect((await res.json()).withdrawn).toMatchObject({ asset: "USDC_LEND", venue: "kamino_klend", receiptRaw: "1661072" });
    expect(log.mock.calls.some((c) => String(c[0]).includes("event was not written") && String(c[0]).includes("db down"))).toBe(true);
    log.mockRestore();
  });
  const appSign = "/Users/lucasgarzoli/Documents/claude/seekerhackathon/build/sprouts-lend-app/app/src/lib/sign.ts";
  // Skipped (shown as skipped in the run) when the app worktree is not on this machine: the vendored copy was then not compared.
  it.skipIf(!existsSync(appSign))("the vendored copy of the app's sign.ts equals the app's file byte for byte, bar the one documented import edit (skipped: app worktree sprouts-lend-app absent)", () => {
    // The vendored header says what was changed: the app's `import { isLend, type LendAsset } from './coins'` is inlined as two lines
    // (and a comment). Undo exactly that edit, then every other byte must match.
    const vendored = readFileSync(new URL("../fixtures/app/sign.ts", import.meta.url), "utf8");
    const edit = /\/\/ VENDORED \(API Task 18\)[^\n]*\n\/\/ except this import[^\n]*\ntype LendAsset = [^\n]*\nconst isLend = [^\n]*\n/;
    expect(edit.test(vendored)).toBe(true);
    expect(vendored.replace(edit, "import { isLend, type LendAsset } from './coins'\n")).toBe(readFileSync(appSign, "utf8"));
  });
});
