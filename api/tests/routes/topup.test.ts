import { describe, it, expect, beforeEach, vi } from "vitest";
import { getBase64Encoder, getBase64Decoder, getTransactionDecoder, getTransactionEncoder, getCompiledTransactionMessageDecoder, type Transaction } from "@solana/kit";
import { MemoryRepo } from "@/db/memory";
import { setRepoForTests } from "@/db/repo";
import { issueSession } from "@/lib/session";
import fixture from "../fixtures/jupiter-topup-exactout.json";
import plain from "../fixtures/jupiter-topup-exactout-plain.json";
import token from "../fixtures/jupiter-topup-exactout-token.json";

/** A fake chain for the SOL top-up: the wallet's lamports, the simulation, the send and the signature's status. */
const { chain, simulateMock } = vi.hoisted(() => ({
  chain: { lamports: 200_000_000n, tokenRaw: 100_000_000n as bigint | null | "down", jupUsd: 0.25, sent: 0, status: "confirmed" as "confirmed" | "failed" | "pending", blockhashValid: true },
  simulateMock: vi.fn(async () => ({ value: { err: null as unknown, logs: [] as string[] } })),
}));
vi.mock("@/lib/rpc", () => ({ rpc: () => ({
  getBalance: () => ({ send: async () => ({ value: chain.lamports }) }),
  getTokenAccountBalance: () => ({ send: async () => {
    if (chain.tokenRaw === null) throw new Error("Invalid param: could not find account");
    if (chain.tokenRaw === "down") throw new Error("fetch failed");
    return { value: { amount: chain.tokenRaw.toString(), decimals: 6 } };
  } }),
  getLatestBlockhash: () => ({ send: async () => ({ value: { blockhash: "GHtXQBsoZHVnNFa9YevAzFr17DJjgHXk3ycTKD5xD3Zi", lastValidBlockHeight: 1n } }) }),
  simulateTransaction: () => ({ send: simulateMock }),
  sendTransaction: () => ({ send: async () => { chain.sent++; return "sig"; } }),
  getSignatureStatuses: () => ({ send: async () => ({ value: [chain.status === "pending" ? null : { err: chain.status === "failed" ? { InstructionError: [0, "x"] } : null, confirmationStatus: "confirmed" }] }) }),
  isBlockhashValid: () => ({ send: async () => ({ value: chain.blockhashValid }) }),
}) }));
vi.mock("@/lib/user-tx", async (orig) => {
  const real = await orig<typeof import("@/lib/user-tx")>();
  // The poll's 20 x 1.5 s becomes 2 x 0 ms.
  return { ...real, waitConfirmed: (sig: string) => real.waitConfirmed(sig, 2, 0) };
});

import { POST as build } from "@/app/api/topup/build/route";
import { POST as confirm } from "@/app/api/topup/confirm/route";

const USER = fixture.user;
const JUP_MINT = token.quote.inputMint;
const UNVERIFIED = "4wiD3N7FrBNJSmZUQDkGHM4CsvDrvyvx7G1FApLGEbJ1";
const fetchMock = vi.fn(async (url: string, _init?: { body?: string }) => {
  const token_ = new URL(url).searchParams.get("inputMint") === JUP_MINT;
  if (url.includes("/swap/v1/quote")) return new Response(JSON.stringify(token_ ? token.quote : fixture.quote));
  if (url.includes("/swap/v1/swap-instructions")) {
    const asked = JSON.parse(String(_init?.body ?? "{}"));
    return new Response(JSON.stringify(asked.quoteResponse?.inputMint === JUP_MINT ? token.swapInstructions : fixture.swapInstructions));
  }
  if (url.includes("/price/v3")) return new Response(JSON.stringify({ [JUP_MINT]: { usdPrice: chain.jupUsd, decimals: 6 } }));
  if (url.includes("/tokens/v2/search")) {
    const q = new URL(url).searchParams.get("query");
    return new Response(JSON.stringify(q === JUP_MINT ? [{ id: JUP_MINT, symbol: "JUP", decimals: 6, tokenProgram: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", isVerified: true }] : q === UNVERIFIED ? [{ id: UNVERIFIED, symbol: "FAKE", decimals: 6, tokenProgram: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", isVerified: false }] : []));
  }
  return new Response("not found", { status: 404 });
});
const call = async (fn: typeof build, body: unknown) =>
  fn(new Request("http://x", { method: "POST", headers: { authorization: `Bearer ${await issueSession(USER, "M")}` }, body: JSON.stringify(body) }));
const decode = (b64: string) => getTransactionDecoder().decode(getBase64Encoder().encode(b64));
/** The wallet's signature, faked (the API never checks it; the chain does): 64 non-zero bytes in the user's slot. */
const signed = (b64: string) => {
  const t = decode(b64);
  const tx: Transaction = { ...t, signatures: { ...t.signatures, [USER]: new Uint8Array(64).fill(7) } as Transaction["signatures"] };
  return getBase64Decoder().decode(getTransactionEncoder().encode(tx));
};

describe("POST /api/topup/build (the SOL top-up's unsigned transaction)", () => {
  beforeEach(() => {
    setRepoForTests(new MemoryRepo());
    process.env.JUPITER_API_KEY ??= "test";
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockClear();
    simulateMock.mockClear();
    Object.assign(chain, { lamports: 200_000_000n, tokenRaw: 100_000_000n, jupUsd: 0.25, sent: 0, status: "confirmed", blockhashValid: true });
  });

  it("asks Jupiter for ExactOut $5 of USDC from SOL, and answers a simulated v0 transaction the wallet pays and alone signs, no lookup table", async () => {
    const res = await call(build, {});
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ usdcRaw: "5000000", maxLamports: fixture.quote.otherAmountThreshold, inputMint: "So11111111111111111111111111111111111111112", maxInRaw: fixture.quote.otherAmountThreshold });
    const quoteUrl = String(fetchMock.mock.calls[0][0]);
    expect(quoteUrl).toContain("swapMode=ExactOut");
    expect(quoteUrl).toContain("amount=5000000");
    expect(quoteUrl).toContain("inputMint=So11111111111111111111111111111111111111112");
    expect(quoteUrl).not.toContain("platformFeeBps");
    expect(new URL(quoteUrl).searchParams.get("dexes")).toBe("Raydium CLMM,Whirlpool"); // the dexes whose swap the app can parse
    const swapBody = JSON.parse(String(fetchMock.mock.calls[1][1]?.body));
    expect(swapBody).toMatchObject({ userPublicKey: USER, wrapAndUnwrapSol: true, useSharedAccounts: true });
    expect(swapBody.feeAccount).toBeUndefined();
    const m = getCompiledTransactionMessageDecoder().decode(decode(body.transaction).messageBytes);
    expect(m.version).toBe(0);
    expect(m.staticAccounts[0]).toBe(USER);
    expect(m.header.numSignerAccounts).toBe(1);
    expect("addressTableLookups" in m ? (m.addressTableLookups ?? []).length : 0).toBe(0);
    expect(getBase64Encoder().encode(body.transaction).length).toBeLessThanOrEqual(1232);
    expect(simulateMock).toHaveBeenCalledTimes(1);
  });

  it("takes an amount from $2 to $25 and refuses one outside", async () => {
    expect((await call(build, { cents: 199 })).status).toBe(400);
    expect((await call(build, { cents: 2_501 })).status).toBe(400);
    fetchMock.mockClear();
    await call(build, { cents: 500 });
    expect(String(fetchMock.mock.calls[0][0])).toContain("amount=5000000");
  });

  it("refuses with a plain sentence when the SOL cannot cover the swap's maximum plus 0.01 SOL", async () => {
    chain.lamports = BigInt(fixture.quote.otherAmountThreshold) + 9_999_999n;
    const res = await call(build, {});
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("Not enough SOL. Adding $5.00 of USDC needs about 0.049 SOL plus 0.01 SOL kept for fees, and this wallet has 0.059 SOL.");
    expect(fetchMock).toHaveBeenCalledTimes(1); // no swap was built
  });

  it("asks nothing of the wallet when the simulation fails", async () => {
    simulateMock.mockResolvedValueOnce({ value: { err: "InsufficientFundsForFee", logs: [] } });
    const res = await call(build, {});
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/would fail on chain/);
  });

  it("refuses Jupiter's answer when it pays someone else, before building anything", async () => {
    const bad = JSON.parse(JSON.stringify(fixture.swapInstructions));
    bad.cleanupInstruction.accounts[1].pubkey = "4wiD3N7FrBNJSmZUQDkGHM4CsvDrvyvx7G1FApLGEbJ1";
    fetchMock.mockImplementationOnce(async () => new Response(JSON.stringify(fixture.quote))).mockImplementationOnce(async () => new Response(JSON.stringify(bad)));
    const res = await call(build, {});
    expect(res.status).toBe(503);
    expect(simulateMock).not.toHaveBeenCalled();
  });

  it("a Jupiter 429 on the quote (after retries) is the usual 'no route' 503, nothing asked of the wallet", async () => {
    const st = vi.spyOn(globalThis, "setTimeout").mockImplementation(((fn: () => void) => { fn(); return 0 as never; }) as never);
    try {
      fetchMock.mockImplementationOnce(async () => new Response("limit", { status: 429 })).mockImplementationOnce(async () => new Response("limit", { status: 429 })).mockImplementationOnce(async () => new Response("limit", { status: 429 }));
      const res = await call(build, {});
      expect(res.status).toBe(503);
      expect((await res.json()).error).toMatch(/can't swap SOL to USDC right now\. Nothing was asked of your wallet\. Try again in a few minutes\./);
      expect(simulateMock).not.toHaveBeenCalled();
    } finally { st.mockRestore(); }
  });

  it("refuses Jupiter's plain ExactOut route (the wallet among the AMM's accounts), before building anything", async () => {
    fetchMock.mockImplementationOnce(async () => new Response(JSON.stringify(plain.quote))).mockImplementationOnce(async () => new Response(JSON.stringify(plain.swapInstructions)));
    const res = await call(build, {});
    expect(res.status).toBe(503);
    expect(simulateMock).not.toHaveBeenCalled();
  });

  it("requires a session", async () => {
    expect((await build(new Request("http://x", { method: "POST", body: "{}" }))).status).toBe(401);
  });

  // Task 7: any coin. An old app sends no inputMint (above, unchanged); the wSOL mint is the same SOL path.
  it("takes the wSOL mint as the SOL top-up, unchanged", async () => {
    const res = await call(build, { cents: 500, inputMint: "So11111111111111111111111111111111111111112" });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ maxLamports: fixture.quote.otherAmountThreshold, inputMint: "So11111111111111111111111111111111111111112" });
  });

  it("refuses a garden coin, USDC or an unverified coin with 400 before any quote", async () => {
    for (const inputMint of ["he1iusmfkpAdwvxLNGV8Y1iSbj4rUy6yMhEA3fotn9A", "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", UNVERIFIED, "not a mint"]) {
      fetchMock.mockClear();
      const res = await call(build, { cents: 500, inputMint });
      expect(res.status).toBe(400);
      expect(fetchMock.mock.calls.some((c) => String(c[0]).includes("/swap/v1/"))).toBe(false);
    }
  });

  it("builds a token top-up: ExactOut JUP to USDC through the pinned dexes, nothing wrapped, inputMint echoed, the quote's maximum as maxInRaw", async () => {
    const res = await call(build, { cents: 500, inputMint: JUP_MINT });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ usdcRaw: "5000000", inputMint: JUP_MINT, maxInRaw: token.quote.otherAmountThreshold });
    expect(body.maxLamports).toBeUndefined();
    const quoteUrl = new URL(String(fetchMock.mock.calls.find((c) => String(c[0]).includes("/swap/v1/quote"))![0]));
    expect(quoteUrl.searchParams.get("inputMint")).toBe(JUP_MINT);
    expect(quoteUrl.searchParams.get("swapMode")).toBe("ExactOut");
    expect(quoteUrl.searchParams.get("dexes")).toBe("Raydium CLMM,Whirlpool");
    expect(quoteUrl.searchParams.get("platformFeeBps")).toBeNull();
    const swapBody = JSON.parse(String(fetchMock.mock.calls.find((c) => String(c[0]).includes("swap-instructions"))![1]?.body));
    expect(swapBody).toMatchObject({ userPublicKey: USER, wrapAndUnwrapSol: false, useSharedAccounts: true });
    expect(swapBody.feeAccount).toBeUndefined();
    const m = getCompiledTransactionMessageDecoder().decode(decode(body.transaction).messageBytes);
    expect(m.header.numSignerAccounts).toBe(1);
    expect("addressTableLookups" in m ? (m.addressTableLookups ?? []).length : 0).toBe(0);
    expect(getBase64Encoder().encode(body.transaction).length).toBeLessThanOrEqual(1232);
    expect(simulateMock).toHaveBeenCalledTimes(1);
  });

  it("refuses with a plain sentence when the wallet holds too little of the coin, or too little SOL for the fee", async () => {
    chain.tokenRaw = BigInt(token.quote.otherAmountThreshold) - 1n;
    let res = await call(build, { cents: 500, inputMint: JUP_MINT });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("Not enough JUP. Adding $5.00 of USDC needs more than this wallet holds.");
    chain.tokenRaw = BigInt(token.quote.otherAmountThreshold);
    chain.lamports = 2_999_999n;
    res = await call(build, { cents: 500, inputMint: JUP_MINT });
    expect(res.status).toBe(409);
    expect(simulateMock).not.toHaveBeenCalled();
  });

  // Task 7 review: the chain before Jupiter; an RPC outage is not "not enough"; the phone's price bound applied here too.
  it("refuses a coin the wallet does not hold with 409 before any Jupiter call", async () => {
    for (const tokenRaw of [null, 0n]) {
      chain.tokenRaw = tokenRaw;
      fetchMock.mockClear();
      const res = await call(build, { cents: 500, inputMint: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263" });
      expect(res.status).toBe(409);
      expect((await res.json()).error).toBe("This wallet holds none of this coin. Pick another coin.");
      expect(fetchMock).not.toHaveBeenCalled();
    }
  });

  it("answers 503 'try again', not 409, when the token balance cannot be read", async () => {
    chain.tokenRaw = "down";
    fetchMock.mockClear();
    const res = await call(build, { cents: 500, inputMint: JUP_MINT });
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe("Sprouts could not build the top-up just now. Nothing was asked of your wallet. Try again in a minute.");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses a quote the phone would call overpriced (its maximum above the USDC plus 3% at Jupiter's price), before any swap is built", async () => {
    chain.jupUsd = 0.26; // 20.138838 JUP x $0.26 = $5.24 > $5.15
    const res = await call(build, { cents: 500, inputMint: JUP_MINT });
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe("Sprouts could not get a fair JUP to USDC price right now. Nothing was asked of your wallet. Try again later.");
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes("swap-instructions"))).toBe(false);
    expect(simulateMock).not.toHaveBeenCalled();
  });

  // Kimi review (Task 7, 1a): the bound is applied again to the maximum parsed out of the built swap, not only to the quote's threshold.
  it("refuses a built swap whose own maximum is above the price bound even when the quote's threshold passed it", async () => {
    const M = BigInt(token.quote.otherAmountThreshold);
    const limit = 5_000_000n * 1_000_000n * 10n ** 6n * 10_300n;           // usdcRaw x 1e6 x 10^decimals x (10000 + margin)
    const pico = limit / (10_000n * M) + 1n;                                // M x pico is just over the limit, (M - 1) x pico is not
    chain.jupUsd = Number(pico) / 1e12;
    const orig = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (url: string, init?: { body?: string }) => {
      if (url.includes("/swap/v1/quote") && new URL(url).searchParams.get("inputMint") === JUP_MINT) {
        return new Response(JSON.stringify({ ...token.quote, otherAmountThreshold: (M - 1n).toString() }));
      }
      return orig(url, init);
    });
    try {
      const res = await call(build, { cents: 500, inputMint: JUP_MINT });
      expect(res.status).toBe(503);
      expect((await res.json()).error).toBe("Sprouts could not get a fair JUP to USDC price right now. Nothing was asked of your wallet. Try again later.");
      expect(fetchMock.mock.calls.some((c) => String(c[0]).includes("swap-instructions"))).toBe(true);   // it got past the quote-level bound
      expect(simulateMock).not.toHaveBeenCalled();
    } finally {
      fetchMock.mockImplementation(orig);
    }
  });

  it("names the coin when there is no route", async () => {
    fetchMock.mockImplementationOnce(async (url: string) => (url.includes("/tokens/v2/search") ? new Response(JSON.stringify([{ id: JUP_MINT, symbol: "JUP", decimals: 6, tokenProgram: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", isVerified: true }])) : new Response("x", { status: 500 })));
    fetchMock.mockImplementationOnce(async () => new Response("no route", { status: 400 }));
    const res = await call(build, { cents: 500, inputMint: JUP_MINT });
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe("Sprouts can't swap JUP to USDC right now. Nothing was asked of your wallet. Try SOL, or try again later.");
  });
});

describe("POST /api/topup/confirm (sends the signed top-up)", () => {
  beforeEach(() => {
    setRepoForTests(new MemoryRepo());
    process.env.JUPITER_API_KEY ??= "test";
    vi.stubGlobal("fetch", fetchMock);
    Object.assign(chain, { lamports: 200_000_000n, tokenRaw: 100_000_000n, jupUsd: 0.25, sent: 0, status: "confirmed", blockhashValid: true });
  });
  const built = async () => (await (await call(build, {})).json()).transaction as string;

  it("sends a signed top-up and answers confirmed with the USDC added", async () => {
    const res = await call(confirm, { signedTransaction: signed(await built()) });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "confirmed", usdcRaw: "5000000" });
    expect(chain.sent).toBe(1);
  });

  it("sends a signed token top-up (the swap's source mint is JUP) and records it as a top-up", async () => {
    const built = await (await call(build, { cents: 500, inputMint: JUP_MINT })).json();
    expect(built.inputMint).toBe(JUP_MINT);
    const res = await call(confirm, { signedTransaction: signed(built.transaction) });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "confirmed", usdcRaw: "5000000" });
    expect(chain.sent).toBe(1);
  });

  it("refuses a swap whose source mint is a garden coin, and sends nothing", async () => {
    const hsol = "he1iusmfkpAdwvxLNGV8Y1iSbj4rUy6yMhEA3fotn9A";
    const bad = JSON.parse(JSON.stringify(token.swapInstructions).replaceAll(JUP_MINT, hsol));
    const { buildUserTransaction } = await import("@/lib/user-tx");
    const { parseSwapInstructions } = await import("@/lib/jupiter");
    const p = parseSwapInstructions(bad);
    const { address } = await import("@solana/kit");
    const tx = await buildUserTransaction(address(USER), [...p.computeBudget, ...p.setup, p.swap]);
    const res = await call(confirm, { signedTransaction: signed(tx) });
    expect(res.status).toBe(400);
    expect(chain.sent).toBe(0);
  });

  it("refuses an unsigned transaction and sends nothing", async () => {
    expect((await call(confirm, { signedTransaction: await built() })).status).toBe(400);
    expect(chain.sent).toBe(0);
  });

  it("a failure on chain is 400, an expired send 409 (nothing moved), an unknown one 202", async () => {
    const tx = signed(await built());
    chain.status = "failed";
    expect((await call(confirm, { signedTransaction: tx })).status).toBe(400);
    chain.status = "pending";
    chain.blockhashValid = false;
    const expired = await call(confirm, { signedTransaction: tx });
    expect(expired.status).toBe(409);
    expect((await expired.json()).error).toBe("The top-up did not go through. Nothing moved. Try again.");
    chain.blockhashValid = true;
    expect((await call(confirm, { signedTransaction: tx })).status).toBe(202);
  });
});

// 10-27 (his rulings: a top-up is not a swap; top-ups show in Activity): the mark before the send, the row once it landed.
describe("POST /api/topup/confirm records the top-up", () => {
  let repo: MemoryRepo;
  beforeEach(() => {
    repo = new MemoryRepo();
    setRepoForTests(repo);
    process.env.JUPITER_API_KEY ??= "test";
    vi.stubGlobal("fetch", fetchMock);
    Object.assign(chain, { lamports: 200_000_000n, tokenRaw: 100_000_000n, jupUsd: 0.25, sent: 0, status: "confirmed", blockhashValid: true });
  });
  const built = async () => (await (await call(build, {})).json()).transaction as string;
  const kinds = () => repo.events.map((e) => e.kind);

  it("writes topup_sent before the send and topped_up once it confirmed, both carrying the signature and the exact USDC", async () => {
    const sentWhenMarked: number[] = [];
    const write = repo.addEvent.bind(repo);
    repo.addEvent = async (e) => { if (e.kind === "topup_sent") sentWhenMarked.push(chain.sent); await write(e); };
    const res = await call(confirm, { signedTransaction: signed(await built()) });
    const { signature } = await res.json();
    expect(sentWhenMarked).toEqual([0]);
    expect(kinds()).toEqual(["topup_sent", "topped_up"]);
    expect(repo.events.map((e) => e.detail)).toEqual([{ signature, usdcRaw: "5000000", inputMint: "So11111111111111111111111111111111111111112", coin: "SOL" }, { signature, usdcRaw: "5000000", inputMint: "So11111111111111111111111111111111111111112", coin: "SOL", sentAt: expect.any(String) }]);   // 11-24: what paid
    expect(repo.events.every((e) => e.userPubkey === USER && e.walletPubkey === USER)).toBe(true);
  });

  it("a token top-up writes topup_sent then topped_up the same way", async () => {
    const tx = (await (await call(build, { cents: 500, inputMint: JUP_MINT })).json()).transaction as string;
    const res = await call(confirm, { signedTransaction: signed(tx) });
    expect(res.status).toBe(200);
    expect(kinds()).toEqual(["topup_sent", "topped_up"]);
    expect(repo.events[1].detail).toMatchObject({ usdcRaw: "5000000" });
  });

  it("a mark that cannot be written sends nothing and answers 400 'nothing moved' (the app shows a 400's words as they are)", async () => {
    repo.addEvent = async () => { throw new Error("db down"); };
    const res = await call(confirm, { signedTransaction: signed(await built()) });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Could not start the top-up. Nothing moved. Try again.");
    expect(chain.sent).toBe(0);
  });

  it("the same top-up confirmed twice keeps one mark and one row", async () => {
    const tx = signed(await built());
    await call(confirm, { signedTransaction: tx });
    await call(confirm, { signedTransaction: tx });
    expect(kinds()).toEqual(["topup_sent", "topped_up"]);
  });

  it("an unknown (202), failed or expired send keeps only the mark", async () => {
    const tx = signed(await built());
    chain.status = "pending";
    expect((await call(confirm, { signedTransaction: tx })).status).toBe(202);
    chain.status = "failed";
    expect((await call(confirm, { signedTransaction: tx })).status).toBe(400);
    chain.status = "pending";
    chain.blockhashValid = false;
    expect((await call(confirm, { signedTransaction: tx })).status).toBe(409);
    expect(kinds()).toEqual(["topup_sent"]);
  });
});
