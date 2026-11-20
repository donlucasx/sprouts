import { describe, it, expect, beforeEach, vi } from "vitest";
import { address, getBase64Encoder, getBase64Decoder, getTransactionDecoder, getTransactionEncoder, getCompiledTransactionMessageDecoder, type Instruction, type Transaction } from "@solana/kit";
import { findAssociatedTokenPda, TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import { MemoryRepo } from "@/db/memory";
import { setRepoForTests } from "@/db/repo";
import { issueSession } from "@/lib/session";
import fixture from "../fixtures/jupiter-topup-exactout.json";
import plain from "../fixtures/jupiter-topup-exactout-plain.json";
import whirlpool from "../fixtures/jupiter-topup-exactout-whirlpool.json";
import token from "../fixtures/jupiter-topup-exactout-token.json";

/** Task 17a (user rent, design 3, 5, 7): the top-up's opt-in setup. The fake chain is topup.test.ts's plus which accounts exist. */
const { chain, simulateMock } = vi.hoisted(() => ({
  chain: { lamports: 200_000_000n, existing: new Set<string>(), multiReads: 0, sent: 0 },
  simulateMock: vi.fn(async (..._a: unknown[]) => ({ value: { err: null as unknown, logs: [] as string[] } })),
}));
vi.mock("@/lib/rpc", () => ({ rpc: () => ({
  getBalance: () => ({ send: async () => ({ value: chain.lamports }) }),
  getTokenAccountBalance: () => ({ send: async () => ({ value: { amount: "100000000", decimals: 6 } }) }),
  getLatestBlockhash: () => ({ send: async () => ({ value: { blockhash: "GHtXQBsoZHVnNFa9YevAzFr17DJjgHXk3ycTKD5xD3Zi", lastValidBlockHeight: 1n } }) }),
  getMultipleAccounts: (as: string[]) => ({ send: async () => { chain.multiReads++; return { value: as.map((a) => (chain.existing.has(a) ? { lamports: 1n } : null)) }; } }),
  simulateTransaction: (tx: string) => ({ send: () => simulateMock(tx) }),
  sendTransaction: () => ({ send: async () => { chain.sent++; return "sig"; } }),
  getSignatureStatuses: () => ({ send: async () => ({ value: [{ err: null, confirmationStatus: "confirmed" }] }) }),
  isBlockhashValid: () => ({ send: async () => ({ value: true }) }),
}) }));
vi.mock("@/lib/user-tx", async (orig) => {
  const real = await orig<typeof import("@/lib/user-tx")>();
  return { ...real, waitConfirmed: (sig: string) => real.waitConfirmed(sig, 2, 0) };
});

import { POST as build } from "@/app/api/topup/build/route";
import { POST as confirm } from "@/app/api/topup/confirm/route";
import { buildUserTransaction } from "@/lib/user-tx";
import { parseSwapInstructions } from "@/lib/jupiter";
import { checkTopUp, topUpAccounts, topUpSourceAccounts, withSetupCreates } from "@/lib/topup";
import { setupCreates, takeSetupPrefix, wireBytes } from "@/lib/user-setup";

const USER = fixture.user;
const JUP_MINT = token.quote.inputMint;
const ATA = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
const CB = "ComputeBudget111111111111111111111111111111";
const STORE = "storenSbvkfzircixnaosc5CbzNZVrHJ6S3EKrS1yqR";
const HSOL = "he1iusmfkpAdwvxLNGV8Y1iSbj4rUy6yMhEA3fotn9A";
const CBBTC = "cbbtcf3aa214zXHbiAZQwf4122FBYbraNdFqgw4iMij";
const KUSDC = "B8V6WVjPxW1UGwVDfxH2d2r8SyT4cqn7dQRK6XneVa7D";
const FUSDC = "9BEcn9aPEmhSPbPQeFGjidRiEKki46fVQDyPpSQXPA2D";
const RENT = 2_039_280n;
const fetchMock = vi.fn(async (url: string, init?: { body?: string }) => {
  const isToken = new URL(url).searchParams.get("inputMint") === JUP_MINT;
  if (url.includes("/swap/v1/quote")) return new Response(JSON.stringify(isToken ? token.quote : fixture.quote));
  if (url.includes("/swap/v1/swap-instructions")) {
    const asked = JSON.parse(String(init?.body ?? "{}"));
    return new Response(JSON.stringify(asked.quoteResponse?.inputMint === JUP_MINT ? token.swapInstructions : fixture.swapInstructions));
  }
  if (url.includes("/price/v3")) return new Response(JSON.stringify({ [JUP_MINT]: { usdPrice: 0.25, decimals: 6 } }));
  if (url.includes("/tokens/v2/search")) return new Response(JSON.stringify([{ id: JUP_MINT, symbol: "JUP", decimals: 6, tokenProgram: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", isVerified: true }]));
  return new Response("not found", { status: 404 });
});
const call = async (fn: typeof build, body: unknown) =>
  fn(new Request("http://x", { method: "POST", headers: { authorization: `Bearer ${await issueSession(USER, "M")}` }, body: JSON.stringify(body) }));
const decode = (b64: string) => getTransactionDecoder().decode(getBase64Encoder().encode(b64));
const signed = (b64: string) => {
  const t = decode(b64);
  const tx: Transaction = { ...t, signatures: { ...t.signatures, [USER]: new Uint8Array(64).fill(7) } as Transaction["signatures"] };
  return getBase64Decoder().decode(getTransactionEncoder().encode(tx));
};
/** The instructions as the confirm route reads them. */
function ixsOf(b64: string) {
  const m = getCompiledTransactionMessageDecoder().decode(decode(b64).messageBytes);
  if (m.version !== 0) throw new Error("not v0");
  const keys = m.staticAccounts as readonly string[];
  return m.instructions.map((ix) => ({ program: keys[ix.programAddressIndex], accounts: (ix.accountIndices ?? []).map((i) => keys[i]), data: new Uint8Array(ix.data ?? []) }));
}
const leadingMints = (b64: string) => { const out: string[] = []; for (const ix of ixsOf(b64)) { if (ix.program !== ATA || ![STORE, HSOL, CBBTC, KUSDC, FUSDC].includes(ix.accounts[3])) break; out.push(ix.accounts[3]); } return out; };
const cuLimits = (b64: string) => ixsOf(b64).filter((ix) => ix.program === CB && ix.data[0] === 2).map((ix) => new DataView(ix.data.buffer, ix.data.byteOffset).getUint32(1, true));
const jupLimit = (f: typeof fixture) => Buffer.from(f.swapInstructions.computeBudgetInstructions[0].data, "base64").readUInt32LE(1);
const ataOf = async (owner: string, mint: string) => (await findAssociatedTokenPda({ owner: address(owner), mint: address(mint), tokenProgram: TOKEN_PROGRAM_ADDRESS }))[0] as string;

let repo: MemoryRepo;
beforeEach(async () => {
  repo = new MemoryRepo();
  setRepoForTests(repo);
  await repo.upsertUser({ seedVaultPubkey: USER, sgtMint: "M", skrName: null });
  // USDC lending 20 (two receipts), then stORE, hSOL, cbBTC, SOL lending at 10.
  await repo.saveRules(USER, { allocation: { SKR: 40, stORE: 10, USDC_LEND: 20, SOL_LEND: 10, hSOL: 10, cbBTC: 10 } as never });
  process.env.JUPITER_API_KEY ??= "test";
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockClear();
  simulateMock.mockReset();
  simulateMock.mockImplementation(async () => ({ value: { err: null, logs: [] } }));
  Object.assign(chain, { lamports: 200_000_000n, multiReads: 0, sent: 0 });
  chain.existing.clear();
});

describe("POST /api/topup/build with setupMax (Task 17a)", () => {
  it("no setupMax (0.1.11 / 0.1.12): today's bytes, no setup read, same as setupMax 0", async () => {
    const old = await (await call(build, {})).json();
    const zero = await (await call(build, { setupMax: 0 })).json();
    expect(zero.transaction).toBe(old.transaction);
    expect(chain.multiReads).toBe(0);
    expect(leadingMints(old.transaction)).toEqual([]);
    expect(cuLimits(old.transaction)).toEqual([jupLimit(fixture)]);
  });

  it("the body schema is not strict: an unknown key is ignored; setupMax outside 0..3 is a 400", async () => {
    expect((await call(build, { cents: 500, somethingNew: 1 })).status).toBe(200);
    expect((await call(build, { setupMax: 4 })).status).toBe(400);
    expect((await call(build, { setupMax: 1.5 })).status).toBe(400);
  });

  it("SOL top-up, setupMax 2: two leading creates BEFORE the compute budget, Jupiter's ONE limit rewritten in place (+25k each, at most 1.4M), and the confirm's own check passes", async () => {
    const res = await call(build, { setupMax: 2 });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(leadingMints(body.transaction)).toEqual([KUSDC, FUSDC]);
    expect(cuLimits(body.transaction)).toEqual([Math.min(jupLimit(fixture) + 50_000, 1_400_000)]);
    expect(wireBytes(body.transaction)).toBeLessThanOrEqual(1232);
    const rest = await takeSetupPrefix(ixsOf(body.transaction), USER, 3);
    expect(() => checkTopUp(rest, { user: USER, ...(topUpAccountsSync()), outRaw: 5_000_000n })).not.toThrow();
  });

  it("withSetupCreates: the creates lead; a limit under the maximum is raised by 25k per create IN PLACE (still one limit, price untouched); none = unchanged", async () => {
    const limit = (n: number) => { const d = new Uint8Array(5); d[0] = 2; new DataView(d.buffer).setUint32(1, n, true); return { programAddress: address(CB), data: d } as Instruction; };
    const price = { programAddress: address(CB), data: new Uint8Array([3, 1, 0, 0, 0, 0, 0, 0, 0]) } as Instruction;
    const swap = { programAddress: address("JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4"), data: new Uint8Array([9]) } as Instruction;
    const creates = await setupCreates(address(USER), [address(STORE), address(HSOL)]);
    const out = withSetupCreates([limit(300_000), price, swap], creates);
    expect(out.slice(0, 2)).toEqual(creates);
    expect(out.slice(2).map((ix) => [...(ix.data ?? [])])).toEqual([[...limit(350_000).data!], [...price.data!], [9]]);
    expect([...withSetupCreates([limit(1_390_000)], creates)[2].data!]).toEqual([...limit(1_400_000).data!]);
    expect(withSetupCreates([limit(300_000), price, swap], [])).toEqual([limit(300_000), price, swap]);
  });

  it("setupMax above what fits: drops creates from the END until the wire fits (never refuses)", async () => {
    const res = await call(build, { setupMax: 3 });
    expect(res.status).toBe(200);
    const body = await res.json();
    // Measured: this route's wire with 3 creates is 1230 bytes, so all 3 fit (lib/user-setup.test.ts tests the drop itself).
    expect(leadingMints(body.transaction)).toEqual([KUSDC, FUSDC, STORE]);
    expect(wireBytes(body.transaction)).toBeLessThanOrEqual(1232);
  });

  it("SOL short for the setup (maxIn + n x rent + 0.01 SOL reserve + 0.001 SOL): none at all, today's bytes", async () => {
    const old = (await (await call(build, {})).json()).transaction;
    const maxIn = BigInt(fixture.quote.otherAmountThreshold);
    chain.lamports = maxIn + 2n * RENT + 10_000_000n + 1_000_000n - 1n;
    expect((await (await call(build, { setupMax: 2 })).json()).transaction).toBe(old);
    chain.lamports += 1n;
    expect(leadingMints((await (await call(build, { setupMax: 2 })).json()).transaction)).toEqual([KUSDC, FUSDC]);
  });

  it("existing accounts are skipped; nothing missing: today's bytes", async () => {
    chain.existing.add(await ataOf(USER, KUSDC));
    expect(leadingMints((await (await call(build, { setupMax: 2 })).json()).transaction)).toEqual([FUSDC, STORE]);
    for (const m of [FUSDC, STORE, HSOL, CBBTC, "2UywZrUdyqs5vDchy7fKQJKau2RVyuzBev2XKGPDSiX1", "2uQsyo1fXXQkDtcpXnLofWy88PxcvnfH2L8FPSE62FVU"]) chain.existing.add(await ataOf(USER, m));
    const old = (await (await call(build, {})).json()).transaction;
    expect((await (await call(build, { setupMax: 2 })).json()).transaction).toBe(old);
  });

  it("the simulation fails with the setup: rebuilt and simulated without it", async () => {
    simulateMock.mockResolvedValueOnce({ value: { err: { InstructionError: [0, "Custom"] }, logs: [] } });
    const body = await (await call(build, { setupMax: 2 })).json();
    expect(simulateMock).toHaveBeenCalledTimes(2);
    expect(leadingMints(body.transaction)).toEqual([]);
  });

  it("a failed setup read (no rules row, or the chain) never blocks the top-up", async () => {
    setRepoForTests(new MemoryRepo()); // no user: the rules read throws
    expect((await call(build, { setupMax: 2 })).status).toBe(200);
  });

  it("token top-up, setupMax 2: leading creates, one limit, SOL rule = 0.003 SOL reserve + n x rent + 0.01 SOL", async () => {
    const body = await (await call(build, { cents: 500, inputMint: JUP_MINT, setupMax: 2 })).json();
    const used = leadingMints(body.transaction);
    expect(used.length).toBeGreaterThan(0);
    expect(cuLimits(body.transaction)).toHaveLength(1);
    const rest = await takeSetupPrefix(ixsOf(body.transaction), USER, 3);
    const source = await topUpSourceAccounts(address(USER), address(JUP_MINT));
    expect(() => checkTopUp(rest, { user: USER, ...(topUpAccountsSync()), outRaw: 5_000_000n, source })).not.toThrow();
    chain.lamports = 3_000_000n + 2n * RENT + 10_000_000n - 1n;
    expect(leadingMints((await (await call(build, { cents: 500, inputMint: JUP_MINT, setupMax: 2 })).json()).transaction)).toEqual([]);
  });
});

describe("POST /api/topup/confirm strips the setup prefix (Kimi HIGH)", () => {
  it("sends a signed top-up that carries a setup prefix (SOL and token)", async () => {
    const sol = (await (await call(build, { setupMax: 2 })).json()).transaction;
    expect(leadingMints(sol).length).toBe(2);
    let res = await call(confirm, { signedTransaction: signed(sol) });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "confirmed", usdcRaw: "5000000" });
    const tok = (await (await call(build, { cents: 500, inputMint: JUP_MINT, setupMax: 1 })).json()).transaction;
    expect(leadingMints(tok).length).toBe(1);
    res = await call(confirm, { signedTransaction: signed(tok) });
    expect(res.status).toBe(200);
    expect(chain.sent).toBe(2);
  });

  const jupIxs = (f: typeof fixture) => { const p = parseSwapInstructions(f.swapInstructions as never); return { cb: p.computeBudget, setup: p.setup, swap: p.swap, cleanup: p.cleanup ? [p.cleanup] : [] }; };
  const send = async (ixs: Instruction[]) => call(confirm, { signedTransaction: signed(await buildUserTransaction(address(USER), ixs)) });

  it("refuses (sends nothing) a prefix of 4, a setup create anywhere but the lead, and a leading create that is not the wallet's own", async () => {
    const j = jupIxs(fixture);
    const four = await setupCreates(address(USER), [STORE, HSOL, CBBTC, KUSDC].map(address));
    const [one] = await setupCreates(address(USER), [address(STORE)]);
    const otherOwner = { ...one, accounts: one.accounts!.map((a, k) => (k === 2 ? { ...a, address: address("8KiTtZXjcpxUGuH93G12iMVNcTYteTbRvaovdeQdfjc6") } : a)) } as Instruction;
    for (const ixs of [
      [...four, ...j.cb, ...j.setup, j.swap, ...j.cleanup],
      [...j.cb, one, ...j.setup, j.swap, ...j.cleanup],
      [...j.cb, ...j.setup, j.swap, ...j.cleanup, one],
      [otherOwner, ...j.cb, ...j.setup, j.swap, ...j.cleanup],
    ]) expect((await send(ixs)).status).toBe(400);
    expect(chain.sent).toBe(0);
    // Not vacuous: the same with a lead of 3 is sent.
    expect((await send([...four.slice(0, 3), ...j.cb, ...j.setup, j.swap, ...j.cleanup])).status).toBe(200);
  });
});

describe("measured top-up sizes (design 5)", () => {
  it("SOL (three Jupiter fixtures) and token top-ups with 0..3 leading creates", async () => {
    const mints = [KUSDC, FUSDC, STORE].map(address);
    const lines: string[] = [];
    for (const [name, f] of Object.entries({ "SOL shared (exactout)": fixture, "SOL plain": plain, "SOL whirlpool": whirlpool, "token JUP": token })) {
      const p = parseSwapInstructions(f.swapInstructions as never);
      const ixs = [...p.computeBudget, ...p.setup, p.swap, ...(p.cleanup ? [p.cleanup] : [])];
      const sizes: number[] = [];
      for (let n = 0; n <= 3; n++) sizes.push(wireBytes(await buildUserTransaction(address(USER), [...(await setupCreates(address(USER), mints.slice(0, n))), ...ixs])));
      lines.push(`${name}: ${sizes.join(", ")}`);
    }
    console.info(`TOPUP SIZES (wire bytes, 0..3 creates)\n${lines.join("\n")}`);
  });
});

/** topUpAccounts, awaited once (the check is sync). */
let accounts: Awaited<ReturnType<typeof topUpAccounts>>;
beforeEach(async () => { accounts = await topUpAccounts(address(USER)); });
const topUpAccountsSync = () => accounts;
