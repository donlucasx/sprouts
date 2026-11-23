import { describe, expect, it, vi } from "vitest";
import {
  appendTransactionMessageInstructions, createTransactionMessage, generateKeyPairSigner, getSignatureFromTransaction, pipe, SolanaError,
  SOLANA_ERROR__JSON_RPC__SERVER_ERROR_SEND_TRANSACTION_PREFLIGHT_FAILURE, SOLANA_ERROR__BLOCK_HEIGHT_EXCEEDED, setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash, signTransactionMessageWithSigners, type Blockhash,
} from "@solana/kit";
import { getSetComputeUnitLimitInstruction } from "@solana-program/compute-budget";
import { PREFLIGHT_RETRIES, PREFLIGHT_WAIT_MS, sendPriceTxs, type PriceTxDeps, type SignedTx } from "@/lib/pyth";

vi.mock("@/lib/config", () => ({ config: () => ({ heliusRpcUrl: "https://x" }) }));

async function signed(units: number): Promise<SignedTx> {
  const payer = await generateKeyPairSigner();
  return signTransactionMessageWithSigners(pipe(createTransactionMessage({ version: 0 }), (m) => setTransactionMessageFeePayerSigner(payer, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash({ blockhash: "11111111111111111111111111111111" as Blockhash, lastValidBlockHeight: 1n }, m),
    (m) => appendTransactionMessageInstructions([getSetComputeUnitLimitInstruction({ units })], m)));
}
// The 10-29 shape: the receiver's WrongVaaOwner in the preflight's simulation logs.
const preflight = () => new SolanaError(SOLANA_ERROR__JSON_RPC__SERVER_ERROR_SEND_TRANSACTION_PREFLIGHT_FAILURE, { logs: ["Program log: AnchorError caused by account: encoded_vaa. Error Code: WrongVaaOwner."] } as never);

function deps(script: Record<string, ("ok" | "preflight" | "expired")[]>, landedSigs = new Set<string>()) {
  const sent: string[] = [];
  const waits: number[] = [];
  const d: PriceTxDeps = {
    send: vi.fn(async (tx: SignedTx) => {
      const sig = getSignatureFromTransaction(tx);
      sent.push(sig);
      const next = script[sig].shift() ?? "ok";
      if (next === "preflight") throw preflight();
      if (next === "expired") throw new SolanaError(SOLANA_ERROR__BLOCK_HEIGHT_EXCEEDED, { currentBlockHeight: 2n, lastValidBlockHeight: 1n });
    }),
    landed: vi.fn(async (sig) => landedSigs.has(sig)),
    sleep: vi.fn(async (ms: number) => { waits.push(ms); }),
  };
  return { d, sent, waits };
}

describe("sendPriceTxs: a refused preflight (a node behind the previous pre-tx) is retried, nothing else is", () => {
  it("retries pre-tx 2 after a WrongVaaOwner preflight and sends it again, in order, waiting 1 s then 2 s", async () => {
    const [a, b] = [await signed(1), await signed(2)];
    const [sa, sb] = [a, b].map(getSignatureFromTransaction);
    const { d, sent, waits } = deps({ [sa]: ["ok"], [sb]: ["preflight", "preflight", "ok"] });
    await sendPriceTxs([a, b], d);
    expect(sent).toEqual([sa, sb, sb, sb]);
    expect(waits).toEqual([PREFLIGHT_WAIT_MS, 2 * PREFLIGHT_WAIT_MS]);
  });

  it("gives up after PREFLIGHT_RETRIES and throws the preflight error (the caller's rescue then runs)", async () => {
    const a = await signed(1);
    const sa = getSignatureFromTransaction(a);
    const { d, sent } = deps({ [sa]: Array(PREFLIGHT_RETRIES + 5).fill("preflight") });
    await expect(sendPriceTxs([a], d)).rejects.toSatisfy((e) => e instanceof SolanaError && e.context.__code === SOLANA_ERROR__JSON_RPC__SERVER_ERROR_SEND_TRANSACTION_PREFLIGHT_FAILURE);
    expect(sent).toHaveLength(PREFLIGHT_RETRIES + 1);
  });

  it("a refused preflight on a tx that already landed counts as sent (no resend, the next pre-tx follows)", async () => {
    const [a, b] = [await signed(1), await signed(2)];
    const [sa, sb] = [a, b].map(getSignatureFromTransaction);
    const { d, sent, waits } = deps({ [sa]: ["preflight"], [sb]: ["ok"] }, new Set([sa]));
    await sendPriceTxs([a, b], d);
    expect(sent).toEqual([sa, sb]);
    expect(waits).toEqual([]);
  });

  it("any other failure throws at once, with no retry and no later pre-tx", async () => {
    const [a, b] = [await signed(1), await signed(2)];
    const [sa, sb] = [a, b].map(getSignatureFromTransaction);
    const { d, sent } = deps({ [sa]: ["expired"], [sb]: ["ok"] });
    await expect(sendPriceTxs([a, b], d)).rejects.toThrow();
    expect(sent).toEqual([sa]);
    expect(d.landed).not.toHaveBeenCalled();
  });
});

import { SOLANA_ERROR__RPC__TRANSPORT_HTTP_ERROR } from "@solana/kit";
import { isTransportFailure, RPC_SUBSCRIPTIONS_TRANSPORT_FAILED_TO_CONNECT } from "@/lib/pyth";

// 11-23 (one SKR leg skipped on 11-21 and 11-23): the two transport failures are retried like a refused preflight, same signed tx.
const httpErr = () => new SolanaError(SOLANA_ERROR__RPC__TRANSPORT_HTTP_ERROR, { headers: new Headers(), message: "Bad Gateway", statusCode: 502 });
const wsErr = () => Object.assign(new Error("Solana error #8190004"), { name: "SolanaError" });
function tdeps(seq: Array<"ok" | "http" | "other">, landed: Array<boolean | "throw"> = []) {
  const sent: number[] = [];
  const waits: number[] = [];
  let n = 0;
  const d: PriceTxDeps = {
    send: vi.fn(async () => { sent.push(++n); const s = seq.shift() ?? "ok"; if (s === "http") throw httpErr(); if (s === "other") throw new Error("boom"); }),
    landed: vi.fn(async () => { const l = landed.shift() ?? false; if (l === "throw") throw httpErr(); return l; }),
    sleep: vi.fn(async (ms: number) => { waits.push(ms); }),
  };
  return { d, sent, waits };
}

describe("sendPriceTxs: transport failures (11-23)", () => {
  it("names only the two seen codes", () => {
    expect(isTransportFailure(httpErr())).toBe(true);
    expect(RPC_SUBSCRIPTIONS_TRANSPORT_FAILED_TO_CONNECT).toBe(8190004);
    expect(isTransportFailure(new SolanaError(SOLANA_ERROR__BLOCK_HEIGHT_EXCEEDED, { currentBlockHeight: 2n, lastValidBlockHeight: 1n }))).toBe(false);
    expect(isTransportFailure(new Error("boom"))).toBe(false);
    expect(isTransportFailure(wsErr())).toBe(false);   // named like one but carrying no context: never a crash, never a retry
    expect(isTransportFailure(new SolanaError(RPC_SUBSCRIPTIONS_TRANSPORT_FAILED_TO_CONNECT as never, {} as never))).toBe(true);
  });
  it("an HTTP transport error, then success: the same tx is sent twice, one wait", async () => {
    const { d, sent, waits } = tdeps(["http", "ok"]);
    await sendPriceTxs([await signed(1)], d);
    expect(sent.length).toBe(2);
    expect(waits).toEqual([PREFLIGHT_WAIT_MS]);
  });
  it("landed after a transport error: stops without sending again", async () => {
    const { d, sent } = tdeps(["http"], [true]);
    await sendPriceTxs([await signed(1)], d);
    expect(sent.length).toBe(1);
  });
  it("landed() itself failing on the transport counts as unknown: wait and send again", async () => {
    const { d, sent } = tdeps(["http", "ok"], ["throw"]);
    await sendPriceTxs([await signed(1)], d);
    expect(sent.length).toBe(2);
  });
  it("transport errors past PREFLIGHT_RETRIES throw", async () => {
    const { d, sent } = tdeps(["http", "http", "http", "http", "http"]);
    await expect(sendPriceTxs([await signed(1)], d)).rejects.toThrow();
    expect(sent.length).toBe(PREFLIGHT_RETRIES + 1);
  });
  it("an unlisted error still throws at once", async () => {
    const { d, sent } = tdeps(["other"]);
    await expect(sendPriceTxs([await signed(1)], d)).rejects.toThrow("boom");
    expect(sent.length).toBe(1);
  });
});
