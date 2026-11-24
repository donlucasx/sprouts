import { describe, it, expect } from "vitest";
import { ConfirmError, sendAndConfirmByPolling, CONFIRM_CAP_MS, type ConfirmDeps } from "@/lib/confirm";
import { generateKeyPairSigner, pipe, createTransactionMessage, setTransactionMessageFeePayerSigner, setTransactionMessageLifetimeUsingBlockhash, signTransactionMessageWithSigners, blockhash as bh } from "@solana/kit";

// 11-24 (Kimi audit idea 1): confirmation by HTTP polling, never a websocket (8190004 left transactions unknown for a day).
async function tx(lastValidBlockHeight = 100n) {
  const payer = await generateKeyPairSigner();
  const m = pipe(createTransactionMessage({ version: 0 }), (x) => setTransactionMessageFeePayerSigner(payer, x),
    (x) => setTransactionMessageLifetimeUsingBlockhash({ blockhash: bh("11111111111111111111111111111111"), lastValidBlockHeight }, x));
  return signTransactionMessageWithSigners(m) as unknown as Promise<Parameters<typeof sendAndConfirmByPolling>[0]>;
}
function deps(statuses: ({ err: unknown; confirmationStatus: string | null } | null)[], heights: bigint[] = [], over: Partial<ConfirmDeps> = {}) {
  let t = 0; const calls = { send: 0, status: 0, height: 0 };
  const d: ConfirmDeps = {
    send: async () => { calls.send++; },
    status: async () => statuses[Math.min(calls.status++, statuses.length - 1)],
    blockHeight: async () => heights[Math.min(calls.height++, Math.max(heights.length - 1, 0))] ?? 0n,
    sleep: async (ms) => { t += ms; },
    now: () => t,
    ...over,
  };
  return { d, calls };
}

describe("sendAndConfirmByPolling", () => {
  it("sends once and returns when the status reads confirmed", async () => {
    const { d, calls } = deps([null, { err: null, confirmationStatus: "processed" }, { err: null, confirmationStatus: "confirmed" }]);
    await expect(sendAndConfirmByPolling(await tx(), d)).resolves.toBeTypeOf("string");
    expect(calls.send).toBe(1);
    expect(calls.status).toBe(3);
  });
  it("a refused preflight throws from the send, unchanged, and polls nothing", async () => {
    const pre = Object.assign(new Error("Solana error #-32002"), { context: { __code: -32002 } });
    const { d, calls } = deps([null], [], { send: async () => { throw pre; } });
    await expect(sendAndConfirmByPolling(await tx(), d)).rejects.toBe(pre);
    expect(calls.status).toBe(0);
  });
  it("landed with an error throws ConfirmError failed", async () => {
    const { d } = deps([{ err: { InstructionError: [0, { Custom: 6008 }] }, confirmationStatus: "confirmed" }]);
    await expect(sendAndConfirmByPolling(await tx(), d)).rejects.toMatchObject({ name: "ConfirmError", kind: "failed" });
  });
  it("expired: block height past lastValidBlockHeight and still unseen throws expired; seen on the last read returns", async () => {
    const a = deps([null], [101n]);
    const e = await sendAndConfirmByPolling(await tx(100n), a.d).catch((x) => x);
    expect(e).toBeInstanceOf(ConfirmError);
    expect((e as ConfirmError).kind).toBe("expired");
    expect(a.calls.status).toBe(4);   // 3 polls + the last read
    const b = deps([null, null, null, { err: null, confirmationStatus: "finalized" }], [101n]);
    await expect(sendAndConfirmByPolling(await tx(100n), b.d)).resolves.toBeTypeOf("string");
  });
  it("gives up as unconfirmed at the cap while the blockhash is still valid", async () => {
    const { d } = deps([null], [50n]);
    const e = await sendAndConfirmByPolling(await tx(100n), d).catch((x) => x);
    expect((e as ConfirmError).kind).toBe("unconfirmed");
    expect(CONFIRM_CAP_MS).toBe(90_000);
  });
});
