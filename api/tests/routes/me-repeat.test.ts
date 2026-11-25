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

describe("Home read cap (11-25, his ruling): 30 reads a minute per user, then 429", () => {
  it("the 31st /api/me read in a minute for one user is refused; another user is not", async () => {
    vi.resetModules();
    const { setRepoForTests } = await import("@/db/repo");
    const { MemoryRepo } = await import("@/db/memory");
    const { issueSession } = await import("@/lib/session");
    const { GET } = await import("@/app/api/me/route");
    (await import("@/lib/memo")).setHomeReadCapForTests(true);
    setRepoForTests(new MemoryRepo());
    const tokenA = await issueSession("HJCJKRQLV2HVKfe3sFdTF5jjBY1xfWgnK8cLcjH7qnHd", "M");
    const tokenB = await issueSession("4wiD3N7FrBNJSmZUQDkGHM4CsvDrvyvx7G1FApLGEbJ1", "M2");
    const read = (t: string) => GET(new Request("http://x/api/me", { headers: { authorization: `Bearer ${t}` } }));
    for (let i = 0; i < 30; i++) expect((await read(tokenA)).status).not.toBe(429);
    const refused = await read(tokenA);
    expect(refused.status).toBe(429);
    expect(refused.headers.get("Retry-After")).toBe("30");
    expect((await read(tokenB)).status).not.toBe(429);
  });
});
