import { describe, it, expect, beforeEach, vi } from "vitest";
import { MemoryRepo } from "@/db/memory";
import { setRepoForTests } from "@/db/repo";
import { issueSession } from "@/lib/session";

const { limited } = vi.hoisted(() => ({ limited: { on: false } }));
vi.mock("@/lib/auth-guard", async (orig) => ({ ...(await orig<object>()), rateLimited: () => limited.on }));

import { POST as support } from "@/app/api/support/route";
import { alertAllowed, founderAlertFor } from "@/lib/founder-alert";

const U = "U5555555555555555555555555555555";
const WALLET = "4wiD3N7FrBNJSmZUQDkGHM4CsvDrvyvx7G1FApLGEbJ1";
const post = (body: unknown, token?: string) =>
  support(new Request("http://x/api/support", { method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) }));
const ok = { topic: "link", message: "Phantom opened, I tapped approve and nothing happened.", email: "mo@proton.me", app: { version: "0.1.8", device: "Seeker" } };

let repo: MemoryRepo;
let token: string;
beforeEach(async () => {
  repo = new MemoryRepo();
  setRepoForTests(repo);
  limited.on = false;
  token = await issueSession(U, "M");
});
const messages = () => repo.events.filter((e) => e.kind === "support_message");

describe("POST /api/support", () => {
  it("stores the message with the email, the app line and what the server knows", async () => {
    await repo.upsertUser({ seedVaultPubkey: U, sgtMint: "G", skrName: "mo.skr" });
    await repo.addWallet({ pubkey: WALLET, userPubkey: U, delegationPda: "P", dailyCapCents: 500 });
    await repo.addEvent({ kind: "link_failed", userPubkey: U, walletPubkey: null, detail: { step: "sign", from: "app" } });
    const res = await post(ok, token);
    expect(res.status).toBe(200);
    const [m] = messages();
    expect(m).toMatchObject({
      userPubkey: U,
      detail: {
        topic: "link",
        message: ok.message,
        email: "mo@proton.me",
        app: { version: "0.1.8", device: "Seeker" },
        context: { skrName: "mo.skr", wallets: [{ pubkey: WALLET }], recent: [{ kind: "link_failed", step: "sign" }] },
      },
    });
  });

  it("the email is required and must look like one; the message must not be empty", async () => {
    expect((await post({ ...ok, email: undefined }, token)).status).toBe(400);
    expect((await post({ ...ok, email: "not an email" }, token)).status).toBe(400);
    expect((await post({ ...ok, message: "   " }, token)).status).toBe(400);
    expect((await post({ ...ok, message: "x".repeat(2001) }, token)).status).toBe(400);
    expect(messages()).toHaveLength(0);
  });

  it("the topic is optional", async () => {
    expect((await post({ ...ok, topic: undefined }, token)).status).toBe(200);
    expect((await post({ ...ok, topic: null }, token)).status).toBe(200);
    expect((await post({ ...ok, topic: "refund" }, token)).status).toBe(400);
  });

  it("signed out: 401, nothing stored", async () => {
    expect((await post(ok)).status).toBe(401);
    expect(messages()).toHaveLength(0);
  });

  it("five a day, then a 429 that says why", async () => {
    for (let i = 0; i < 5; i++) expect((await post(ok, token)).status).toBe(200);
    const res = await post(ok, token);
    expect(res.status).toBe(429);
    expect(((await res.json()) as { error: string }).error).toMatch(/5 messages today/);
    expect(messages()).toHaveLength(5);
  });

  it("the per-minute limit answers 429 too", async () => {
    limited.on = true;
    expect((await post(ok, token)).status).toBe(429);
    expect(messages()).toHaveLength(0);
  });

  it("the app line keeps plain characters only", async () => {
    await post({ ...ok, app: { version: "0.1.8`@everyone", device: "Seeker <b>" } }, token);
    expect(messages()[0].detail).toMatchObject({ app: { version: "0.1.8everyone", device: "Seeker b" } });
  });
});

describe("the Discord post", () => {
  it("reads like the draft: who, topic, the message fenced, reply address, wallets and recent failures", async () => {
    const text = founderAlertFor({
      kind: "support_message",
      userPubkey: U,
      walletPubkey: null,
      detail: {
        topic: "link",
        message: "nothing happened",
        email: "mo@proton.me",
        app: { version: "0.1.8", device: "Seeker" },
        context: { skrName: "mo.skr", wallets: [], recent: [{ kind: "link_failed", ts: "2026-11-01T13:33:00.000Z", step: "sign" }] },
      },
    })!;
    expect(text).toBe(
      [
        "Message from mo.skr (user U555...5555) | Linking a wallet",
        "```",
        "nothing happened",
        "```",
        "Reply to: mo@proton.me | app 0.1.8 | Seeker",
        "Wallets: none linked | recent (UTC): link_failed (sign) 13:33",
      ].join("\n"),
    );
  });

  it("a message cannot break out of its code block, and a long one is cut", () => {
    const text = founderAlertFor({ kind: "support_message", userPubkey: U, walletPubkey: null, detail: { message: "```\n@everyone [x](https://evil.example)\n```" + "y".repeat(2000), email: "a@b.co" } })!;
    expect(text.match(/```/g)).toHaveLength(2);
    expect(text).toContain("(cut: the full text is in the events table)");
    expect(text.length).toBeLessThan(1900);
  });

  it("Slack's link and mention markup is broken too", () => {
    const text = founderAlertFor({ kind: "support_message", userPubkey: U, walletPubkey: null, detail: { message: "<!channel> <https://evil.example|click>", email: "a@b.co" } })!;
    expect(text).not.toMatch(/[<>]/);
  });

  it("the webhook gets one post a minute per user; the next minute passes again", () => {
    const e = { kind: "support_message" as const, userPubkey: "Uburst111111111111111111111111111" };
    expect(alertAllowed(e, 1_000)).toBe(true);
    expect(alertAllowed(e, 30_000)).toBe(false);
    expect(alertAllowed(e, 62_000)).toBe(true);
  });
});
