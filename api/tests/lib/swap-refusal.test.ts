import { describe, it, expect, vi, afterEach } from "vitest";
import { MemoryRepo } from "@/db/memory";
import { refusalReason, recordSwapRefusal, REFUSAL_WAIT_MS } from "@/lib/swap-refusal";

afterEach(() => vi.useRealTimers());

describe("refusalReason", () => {
  it("maps each verify-swap refusal to a short enum, never the text", () => {
    expect(refusalReason("not found on chain")).toBe("not_found");
    expect(refusalReason("failed on chain")).toBe("failed_on_chain");
    expect(refusalReason("the wallet did not sign it")).toBe("not_signer");
    expect(refusalReason("no block time")).toBe("no_block_time");
    expect(refusalReason("the event's time 1 is not the block's 9")).toBe("time_mismatch");
    expect(refusalReason("the block time 1758800000 is not recent")).toBe("not_recent");
    expect(refusalReason("the in-leg 2 is more than the wallet spent (1)")).toBe("in_leg_over");
    expect(refusalReason("the out-leg 2 is more than the wallet received (1)")).toBe("out_leg_over");
    expect(refusalReason("the chain could not be read: fetch failed https://x?api-key=SECRET")).toBe("chain_read_error");
    expect(refusalReason("something new")).toBe("other");
  });
});

describe("recordSwapRefusal", () => {
  const SIG = "5xSwapSig1111111111111111111111111111111111111111111111111111111111111111111111111111";

  it("writes one swap_refused event: reason enum, 8-character signature, the wallet; nothing else", async () => {
    const repo = new MemoryRepo();
    await recordSwapRefusal(repo, { signature: SIG, walletPubkey: "WALLET", reason: "not_recent" });
    expect(repo.events).toHaveLength(1);
    expect(repo.events[0]).toMatchObject({ kind: "swap_refused", walletPubkey: "WALLET", userPubkey: null, detail: { reason: "not_recent", sig: "5xSwapSi" } });
    expect(Object.keys(repo.events[0].detail as object).sort()).toEqual(["reason", "sig"]);
  });

  it("keeps only base58 characters of a posted signature", async () => {
    const repo = new MemoryRepo();
    await recordSwapRefusal(repo, { signature: "<b>\"x0O1", walletPubkey: null, reason: "error" });
    expect((repo.events[0].detail as { sig: string }).sig).toBe("bx1");
  });

  it("never throws when the write fails", async () => {
    const repo = new MemoryRepo();
    repo.addEvent = async () => { throw new Error("db down"); };
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(recordSwapRefusal(repo, { signature: SIG, walletPubkey: "WALLET", reason: "other" })).resolves.toBeUndefined();
    err.mockRestore();
  });

  it("a hung write is given up on after REFUSAL_WAIT_MS (the next webhook item is not held)", async () => {
    vi.useFakeTimers();
    const repo = new MemoryRepo();
    repo.addEvent = () => new Promise(() => {});
    let done = false;
    const p = recordSwapRefusal(repo, { signature: SIG, walletPubkey: "WALLET", reason: "other" }).then(() => { done = true; });
    await vi.advanceTimersByTimeAsync(REFUSAL_WAIT_MS - 1);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(2);
    await p;
    expect(done).toBe(true);
  });
});
