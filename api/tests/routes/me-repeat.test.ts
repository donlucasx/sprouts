import { describe, expect, it, beforeEach, vi } from "vitest";
import { forgetOwnerReads, rememberAnswer, repeatAnswer, REPEAT_MS, clearSharedReads, setRepeatMsForTests } from "@/lib/memo";

// 11-25 (Home refresh loop): a repeat of the same Home read inside REPEAT_MS gets the last answer; a write clears it.
describe("Home answer repeat guard", () => {
  beforeEach(() => { clearSharedReads(); vi.useRealTimers(); setRepeatMsForTests(REPEAT_MS); });
  it("repeats inside the window, per owner and key, and expires after it", () => {
    vi.useFakeTimers();
    rememberAnswer("A", "me|-", { n: 1 });
    expect(repeatAnswer("A", "me|-")).toEqual({ n: 1 });
    expect(repeatAnswer("A", "usdc?sources=1|-")).toBeUndefined();
    expect(repeatAnswer("B", "me|-")).toBeUndefined();
    vi.advanceTimersByTime(REPEAT_MS);
    expect(repeatAnswer("A", "me|-")).toBeUndefined();
  });
  it("forgetOwnerReads clears that owner only", () => {
    rememberAnswer("A", "me|-", 1);
    rememberAnswer("B", "me|-", 2);
    forgetOwnerReads("A");
    expect(repeatAnswer("A", "me|-")).toBeUndefined();
    expect(repeatAnswer("B", "me|-")).toBe(2);
  });
  it("any non-GET request through requireSession clears the caller's answers; a GET does not", async () => {
    vi.resetModules();
    vi.doMock("@/lib/session", () => ({ readSession: async () => ({ pubkey: "A" }) }));
    const memo = await import("@/lib/memo");
    memo.setRepeatMsForTests(memo.REPEAT_MS);
    const { requireSession } = await import("@/lib/auth-guard");
    memo.rememberAnswer("A", "me|-", 1);
    await requireSession(new Request("http://x/api/me", { headers: { authorization: "Bearer t" } }));
    expect(memo.repeatAnswer("A", "me|-")).toBe(1);
    await requireSession(new Request("http://x/api/water", { method: "POST", headers: { authorization: "Bearer t" } }));
    expect(memo.repeatAnswer("A", "me|-")).toBeUndefined();
    vi.doUnmock("@/lib/session");
  });
});
