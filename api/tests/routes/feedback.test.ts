import { describe, it, expect, beforeEach, vi } from "vitest";
import { MemoryRepo } from "@/db/memory";
import { setRepoForTests } from "@/db/repo";
import { issueSession } from "@/lib/session";

const { limited } = vi.hoisted(() => ({ limited: { on: false } }));
vi.mock("@/lib/auth-guard", async (orig) => ({ ...(await orig<object>()), rateLimited: () => limited.on }));

import { POST as feedback } from "@/app/api/feedback/route";
import { FEEDBACK_OPTIONS, askFor, removedRef } from "@/domain/asks";
import { alertAllowed, founderAlertFor } from "@/lib/founder-alert";

const U = "U5555555555555555555555555555555";
const WALLET = "4wiD3N7FrBNJSmZUQDkGHM4CsvDrvyvx7G1FApLGEbJ1";
const post = (body: unknown, token?: string) =>
  feedback(new Request("http://x/api/feedback", { method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) }));

let repo: MemoryRepo;
let token: string;
beforeEach(async () => {
  repo = new MemoryRepo();
  setRepoForTests(repo);
  limited.on = false;
  token = await issueSession(U, "M");
});
const answers = () => repo.events.filter((e) => e.kind === "feedback_answer");

describe("POST /api/feedback", () => {
  it("401 without a session", async () => {
    expect((await post({ question: "brought_you", choice: "looking" })).status).toBe(401);
    expect(answers()).toHaveLength(0);
  });

  it("the options are the approved values", () => {
    expect(FEEDBACK_OPTIONS).toEqual({
      link_failed: ["backed_out", "closed_itself", "warning_worried", "other"],
      wallet_removed: ["testing", "approval", "not_planting", "need_usdc", "other"],
      brought_you: ["skr_staking", "roundups", "looking", "other"],
    });
  });

  it("400 on an unknown choice, an unknown question, or another question's choice", async () => {
    for (const body of [
      { question: "brought_you", choice: "nope" },
      { question: "brought_you", choice: "testing" },
      { question: "other_q", choice: "other" },
      { question: "brought_you" },
    ]) {
      const res = await post(body, token);
      expect(res.status).toBe(400);
    }
    expect((await (await post({ question: "brought_you", choice: "nope" }, token)).json())).toEqual({ error: "Pick one of the answers." });
    expect(answers()).toHaveLength(0);
  });

  it("200 writes exactly one feedback_answer with the detail", async () => {
    const res = await post({ question: "wallet_removed", ref: "abc:2026-11-08", choice: "approval", text: "  it asked twice  " }, token);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(answers()).toHaveLength(1);
    expect(answers()[0]).toMatchObject({ userPubkey: U, walletPubkey: null, detail: { question: "wallet_removed", ref: "abc:2026-11-08", choice: "approval", text: "it asked twice" } });
  });

  it("ref and text are optional", async () => {
    expect((await post({ question: "link_failed", choice: "backed_out" }, token)).status).toBe(200);
    expect(answers()[0].detail).toMatchObject({ question: "link_failed", choice: "backed_out" });
  });

  it("refuses text over 500 characters and a ref over 120", async () => {
    expect((await post({ question: "brought_you", choice: "other", text: "x".repeat(501) }, token)).status).toBe(400);
    expect((await post({ question: "brought_you", choice: "other", text: "x".repeat(500) }, token)).status).toBe(200);
    expect((await post({ question: "brought_you", choice: "other", ref: "r".repeat(121) }, token)).status).toBe(400);
    expect(answers()).toHaveLength(1);
  });

  it("the 11th answer in a day is 429", async () => {
    for (let i = 0; i < 10; i++) expect((await post({ question: "brought_you", choice: "looking" }, token)).status).toBe(200);
    expect((await post({ question: "brought_you", choice: "looking" }, token)).status).toBe(429);
    expect(answers()).toHaveLength(10);
  });

  it("answers older than a day do not count toward the cap", async () => {
    for (let i = 0; i < 10; i++) await repo.addEvent({ kind: "feedback_answer", userPubkey: U, walletPubkey: null, detail: { question: "brought_you", ref: "r", choice: "looking" } });
    for (const e of repo.events) e.ts = new Date(Date.now() - 25 * 3600_000);
    expect((await post({ question: "brought_you", choice: "looking" }, token)).status).toBe(200);
  });

  it("429 when the per-minute limiter trips", async () => {
    limited.on = true;
    expect((await post({ question: "brought_you", choice: "looking" }, token)).status).toBe(429);
  });

  it("round trip: an answered wallet_removed ref makes askFor stop asking", async () => {
    const at = new Date("2026-11-07T10:00:00Z");
    const ref = removedRef(WALLET, at);
    const input = (answered: { question: string; ref: string }[]) => ({ walletsEver: 1, withdrawals: 0, removedWallets: [{ wallet: WALLET, at }], linkedNow: [], answered, now: new Date("2026-11-08T00:00:00Z") });
    expect(askFor(input([]))).toEqual({ question: "wallet_removed", ref });
    expect((await post({ question: "wallet_removed", ref, choice: "testing" }, token)).status).toBe(200);
    const answered = answers().map((e) => e.detail as { question: string; ref: string });
    expect(askFor(input(answered))).toBeNull();
  });
});

describe("founder alert for feedback_answer", () => {
  it("names the question, the choice and the text length, never the text or a wallet key", () => {
    const line = founderAlertFor({ kind: "feedback_answer", userPubkey: U, walletPubkey: null, detail: { question: "wallet_removed", ref: `${WALLET}:2026-11-08`, choice: "approval", text: "secret words here" } });
    expect(line).toContain("wallet_removed");
    expect(line).toContain("approval");
    expect(line).toContain("17");
    expect(line).not.toContain("secret");
    expect(line).not.toContain(WALLET);
    expect(line).not.toContain(WALLET.slice(0, 4) + "...");
  });

  it("falls back to ? for values outside the options", () => {
    const line = founderAlertFor({ kind: "feedback_answer", userPubkey: U, walletPubkey: null, detail: { question: "<!channel>", choice: "x".repeat(300) } });
    expect(line).not.toContain("channel");
    expect(line!.length).toBeLessThan(200);
  });

  it("the webhook gets one answer alert a minute per user; another user is not held back", () => {
    const a = { kind: "feedback_answer" as const, userPubkey: "Uburst111111111111111111111111111" };
    const b = { kind: "feedback_answer" as const, userPubkey: "Uother111111111111111111111111111" };
    expect(alertAllowed(a, 1_000)).toBe(true);
    expect(alertAllowed(a, 30_000)).toBe(false);
    expect(alertAllowed(b, 30_000)).toBe(true);
    expect(alertAllowed(a, 62_000)).toBe(true);
  });
});
