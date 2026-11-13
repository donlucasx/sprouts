import { describe, it, expect, beforeEach } from "vitest";
import { MemoryRepo } from "@/db/memory";
import { setRepoForTests } from "@/db/repo";
import { issueSession } from "@/lib/session";
import { withAppErrorLog } from "@/lib/failure-log";
import { founderAlertFor, alertAllowed } from "@/lib/founder-alert";

const USER = "4wiD3N7FrBNJSmZUQDkGHM4CsvDrvyvx7G1FApLGEbJ1";
let repo: MemoryRepo;
beforeEach(() => {
  repo = new MemoryRepo();
  setRepoForTests(repo);
});
const post = (headers: Record<string, string> = {}) => new Request("http://x/api/withdraw/confirm", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify({ email: "a@b.co", signedTransaction: "SECRETTX" }) });
const appErrors = () => repo.events.filter((e) => e.kind === "app_error");

describe("withAppErrorLog", () => {
  it("a thrown error is recorded (step, 500, redacted text, session user) and rethrown", async () => {
    const token = await issueSession(USER, "dev");
    const h = withAppErrorLog("withdraw/confirm", async () => { throw new Error("rpc exploded"); });
    await expect(h(post({ authorization: `Bearer ${token}` }))).rejects.toThrow("rpc exploded");
    expect(appErrors()).toHaveLength(1);
    expect(appErrors()[0]).toMatchObject({ userPubkey: USER, walletPubkey: null, detail: { step: "withdraw/confirm", status: 500, error: "rpc exploded" } });
    expect(JSON.stringify(appErrors()[0])).not.toMatch(/SECRETTX|a@b\.co|Bearer|authorization/i);
  });

  it("a 5xx response is recorded; the response is untouched", async () => {
    const h = withAppErrorLog("topup/confirm", async () => Response.json({ error: "Could not send." }, { status: 502 }));
    const res = await h(post());
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "Could not send." });
    expect(appErrors()[0]).toMatchObject({ userPubkey: null, detail: { step: "topup/confirm", status: 502, error: "Could not send." } });
  });

  it.each([200, 400, 401, 409, 429])("a %i answer is not recorded", async (status) => {
    const h = withAppErrorLog("pause", async () => Response.json({ error: "no" }, { status }));
    expect((await h(post())).status).toBe(status);
    expect(appErrors()).toEqual([]);
  });

  it("a failed event write never changes the answer", async () => {
    repo.addEvent = async () => { throw new Error("db down"); };
    const ok = withAppErrorLog("pause", async () => Response.json({}, { status: 500 }));
    expect((await ok(post())).status).toBe(500);
    const boom = withAppErrorLog("pause", async () => { throw new Error("original"); });
    await expect(boom(post())).rejects.toThrow("original");
  });

  it("passes route context through and can name a wallet via a who override", async () => {
    const h = withAppErrorLog("revoke/wallet", async (_req: Request, ctx: { params: Promise<{ wallet: string }> }) => { await ctx.params; throw new Error("x"); },
      async (_req, _f, ctx) => ({ userPubkey: null, walletPubkey: (await ctx.params).wallet }));
    await expect(h(post(), { params: Promise.resolve({ wallet: USER }) })).rejects.toThrow("x");
    expect(appErrors()[0]).toMatchObject({ walletPubkey: USER });
  });

  it("founder alert: only for a signed-in user, throttled per user", () => {
    const e = { kind: "app_error" as const, userPubkey: USER, walletPubkey: null, detail: { step: "withdraw/confirm", status: 500, error: "boom" } };
    expect(founderAlertFor(e)).toMatch(/withdraw\/confirm/);
    expect(founderAlertFor({ ...e, userPubkey: null })).toBeNull();
    expect(alertAllowed(e, 1_000)).toBe(true);
    expect(alertAllowed(e, 2_000)).toBe(false);
  });
});
