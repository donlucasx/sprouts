import { describe, it, expect, beforeEach, vi } from "vitest";
import { MemoryRepo } from "@/db/memory";
import { setRepoForTests } from "@/db/repo";

const { afterMock } = vi.hoisted(() => ({ afterMock: vi.fn() }));
vi.mock("next/server", async (orig) => ({ ...(await orig<object>()), after: afterMock }));

import { withAppErrorLog, withFailureLog, LOG_WAIT_MS } from "@/lib/failure-log";

let repo: MemoryRepo;
beforeEach(() => {
  repo = new MemoryRepo();
  setRepoForTests(repo);
  afterMock.mockReset();
});
const post = () => new Request("http://x/api/withdraw/confirm", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });

describe("kimi M2: the failure log is handed to after()", () => {
  it("a 5xx hands the log write to after(), and the answer is untouched", async () => {
    const res = await withAppErrorLog("pause", async () => Response.json({ error: "x" }, { status: 500 }))(post());
    expect(res.status).toBe(500);
    expect(afterMock).toHaveBeenCalledTimes(1);
    expect(repo.events.filter((e) => e.kind === "app_error")).toHaveLength(1);
  });

  it("a hung write still delays the answer by LOG_WAIT_MS at most, with the write still handed to after()", async () => {
    repo.addEvent = () => new Promise(() => {});
    const t0 = Date.now();
    const res = await withFailureLog("link_failed", "confirm", async () => ({ userPubkey: null, walletPubkey: null }), async (_r: Request) => Response.json({ error: "no" }, { status: 409 }))(post());
    expect(res.status).toBe(409);
    expect(Date.now() - t0).toBeLessThan(LOG_WAIT_MS + 1500);
    expect(afterMock).toHaveBeenCalledTimes(1);
  }, 15_000);

  it("after() throwing (outside a request scope) falls back to the plain bounded wait", async () => {
    afterMock.mockImplementation(() => { throw new Error("`after` was called outside a request scope"); });
    const res = await withAppErrorLog("pause", async () => Response.json({ error: "x" }, { status: 502 }))(post());
    expect(res.status).toBe(502);
    expect(repo.events.filter((e) => e.kind === "app_error")).toHaveLength(1);
  });
});
