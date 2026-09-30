import { describe, it, expect, beforeEach, beforeAll, vi } from "vitest";
import { MemoryRepo } from "@/db/memory";
import { setRepoForTests } from "@/db/repo";
import { issueSession } from "@/lib/session";
import { generateKeyPairSigner } from "@solana/kit";

// The model behind the route is a mock: the route's own job is the session, the text's bounds, the budget and the record.
const { callToolMock } = vi.hoisted(() => ({
  callToolMock: vi.fn(async () => ({ input: { dailyCapCents: 300, understood: "Your daily limit is $3.00." }, usage: { inputTokens: 300, outputTokens: 40 } })),
}));
vi.mock("@/lib/anthropic", () => ({ callTool: callToolMock }));

import { POST as compile } from "@/app/api/watcher/compile/route";

let U: string;
let auth: Record<string, string>;
const post = (body: unknown, headers: Record<string, string> = auth) =>
  compile(new Request("http://x/api/watcher/compile", { method: "POST", headers, body: JSON.stringify(body) }));

beforeAll(async () => {
  process.env.APP_ORIGIN ??= "https://sprouts.money";
  U = (await generateKeyPairSigner()).address;
});

describe("POST /api/watcher/compile", () => {
  let repo: MemoryRepo;
  beforeEach(async () => {
    repo = new MemoryRepo();
    setRepoForTests(repo);
    await repo.upsertUser({ seedVaultPubkey: U, sgtMint: "M", skrName: null });
    auth = { authorization: `Bearer ${await issueSession(U, "M")}`, "content-type": "application/json" };
    callToolMock.mockClear();
  });

  it("needs a session", async () => {
    expect((await post({ text: "limit $3 a day" }, { "content-type": "application/json" })).status).toBe(401);
  });

  it("refuses empty or oversized text without calling the model", async () => {
    expect((await post({ text: "" })).status).toBe(400);
    expect((await post({ text: "x".repeat(301) })).status).toBe(400);
    expect((await post({})).status).toBe(400);
    expect(callToolMock).not.toHaveBeenCalled();
  });

  it("answers the patch, the sentence and the notes, and records the call's cost", async () => {
    const res = await post({ text: "limit $3 a day" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ patch: { dailyCapCents: 300 }, understood: "Your daily limit is $3.00.", notes: [] });
    const calls = await repo.listWatcherCalls();
    expect(calls.length).toBe(1);
    expect(calls[0]).toMatchObject({ userPubkey: U, kind: "compile", inputTokens: 300, outputTokens: 40, costMicrocents: 30_000 + 20_000 });
  });

  it("rests for the month at $10 and says so, without calling the model", async () => {
    await repo.addWatcherCall({ userPubkey: "someone", kind: "compile", inputTokens: 1, outputTokens: 1, costMicrocents: 1_000_000_000 });
    const res = await post({ text: "limit $3 a day" });
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe("The watcher is resting this month. The controls below still work.");
    expect(callToolMock).not.toHaveBeenCalled();
  });

  it("stops a user after 30 calls in a day", async () => {
    for (let i = 0; i < 30; i++) await repo.addWatcherCall({ userPubkey: U, kind: "compile", inputTokens: 1, outputTokens: 1, costMicrocents: 1 });
    const res = await post({ text: "limit $3 a day" });
    expect(res.status).toBe(429);
    expect((await res.json()).error).toBe("That is enough for today. The controls below still work.");
  });

  it("a model failure is a plain sentence, and nothing is recorded as spent", async () => {
    callToolMock.mockRejectedValueOnce(new Error("upstream"));
    const res = await post({ text: "limit $3 a day" });
    expect(res.status).toBe(502);
    expect((await res.json()).error).toBe("The watcher could not read that. Use the controls below.");
    expect((await repo.listWatcherCalls()).length).toBe(0);
  });
});
