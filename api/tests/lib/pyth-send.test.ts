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
