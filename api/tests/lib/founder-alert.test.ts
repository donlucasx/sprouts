import { describe, it, expect, vi, afterEach } from "vitest";
import { alertFounder, founderAlertFor } from "@/lib/founder-alert";

const W = "9H7ChDC2o32wC8jcpVDjLGQhwyx1hmLW1fiCjsjUuzFm";
const U = "8KiTtZXjcpxUGuH93G12iMVNcTYteTbRvaovdeQdfjc6";
const ev = (kind: Parameters<typeof founderAlertFor>[0]["kind"], detail: unknown = null) => ({ userPubkey: U, walletPubkey: W, kind, detail });

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("founderAlertFor", () => {
  it("names the wallet, the user and the amount on a no-USDC pause", () => {
    expect(founderAlertFor(ev("paused_no_usdc", { needCents: 50 }))).toBe(
      `Paused for no USDC: wallet ${W.slice(0, 4)}...${W.slice(-4)} (user ${U.slice(0, 4)}...${U.slice(-4)}), needs $0.50. Plantings resume on their own once USDC is there.`,
    );
  });

  it("alerts on the events someone should act on", () => {
    for (const kind of ["revoke_seen", "pull_failed", "withdraw_failed", "move_failed", "run_stopped"] as const)
      expect(founderAlertFor(ev(kind, { err: "boom", stage: "simulate", after: 3 })), kind).toMatch(/\S/);
    expect(founderAlertFor(ev("pull_failed", { stage: "send", err: "blockhash expired" }))).toContain("at send");
    expect(founderAlertFor(ev("pull_failed", { stage: "send", err: "blockhash expired" }))).toContain("blockhash expired");
  });

  it("10-27: a simulation error object reads as JSON, never [object Object]; a removed USDC approval says so", () => {
    const line = founderAlertFor(ev("pull_failed", { stage: "simulate", err: { InstructionError: [2, { Custom: 4 }] } }));
    expect(line).toContain('{"InstructionError":[2,{"Custom":4}]}');
    expect(line).not.toContain("[object Object]");
    expect(founderAlertFor(ev("revoke_seen", { by: "token_revoke" }))).toContain("No USDC approval on this wallet");
  });

  it("alerts on a link only when the wallet missed the webhook (its swaps are not counted)", () => {
    expect(founderAlertFor(ev("wallet_linked", { webhookAdded: true, linkModel: "leash" }))).toBeNull();
    expect(founderAlertFor(ev("wallet_linked", { webhookAdded: false, linkModel: "leash" }))).toContain("NOT on the Helius webhook");
  });

  it("stays quiet on everyday events", () => {
    for (const kind of ["split_changed", "resumed", "terms_accepted", "leg_skipped", "venue_fallback", "move_done", "lend_withdrawn"] as const)
      expect(founderAlertFor(ev(kind, {})), kind).toBeNull();
  });
});

describe("alertFounder", () => {
  it("sends nothing when no webhook is set", async () => {
    vi.stubEnv("ALERT_WEBHOOK_URL", "");
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    await alertFounder("hi");
    expect(f).not.toHaveBeenCalled();
  });

  it("posts Discord/Slack JSON to a webhook, plain text to ntfy", async () => {
    const f = vi.fn(async () => new Response("ok"));
    vi.stubGlobal("fetch", f);
    vi.stubEnv("ALERT_WEBHOOK_URL", "https://discord.com/api/webhooks/1/abc");
    await alertFounder("Paused", { mention: false });
    expect(JSON.parse((f.mock.calls[0] as unknown as [string, RequestInit])[1].body as string)).toEqual({ content: "Paused", text: "Paused", allowed_mentions: { parse: [] } });
    vi.stubEnv("ALERT_WEBHOOK_URL", "https://ntfy.sh/some-topic");
    await alertFounder("Paused");
    expect((f.mock.calls[1] as unknown as [string, RequestInit])[1].body).toBe("Paused");
  });

  it("every alert mentions the founder on Discord, and only him (his 11-08 ask: 'every/any important message should tag me'); other hosts never mention", async () => {
    const f = vi.fn(async () => new Response("ok"));
    vi.stubGlobal("fetch", f);
    const body = (i: number) => (f.mock.calls[i] as unknown as [string, RequestInit])[1].body as string;
    vi.stubEnv("ALERT_WEBHOOK_URL", "https://discord.com/api/webhooks/1/abc");
    await alertFounder("Message from x", { mention: true });
    expect(JSON.parse(body(0))).toEqual({ content: "<@459534488825888769> Message from x", text: "Message from x", allowed_mentions: { parse: [], users: ["459534488825888769"] } });
    await alertFounder("Paused");
    expect(JSON.parse(body(1))).toEqual({ content: "<@459534488825888769> Paused", text: "Paused", allowed_mentions: { parse: [], users: ["459534488825888769"] } });
    vi.stubEnv("ALERT_WEBHOOK_URL", "https://hooks.slack.com/services/x");
    await alertFounder("Message from x", { mention: true });
    expect(JSON.parse(body(2))).toMatchObject({ text: "Message from x", allowed_mentions: { parse: [] } });
    vi.stubEnv("ALERT_WEBHOOK_URL", "https://ntfy.sh/t");
    await alertFounder("Message from x", { mention: true });
    expect(body(3)).toBe("Message from x");
  });

  it("never throws and never logs the webhook URL when delivery fails", async () => {
    vi.stubEnv("ALERT_WEBHOOK_URL", "https://discord.com/api/webhooks/1/SECRET");
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("fetch failed https://discord.com/api/webhooks/1/SECRET"); }));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(alertFounder("x")).resolves.toBeUndefined();
    expect(log.mock.calls.flat().join(" ")).not.toContain("SECRET");
    log.mockRestore();
  });
});

describe("11-11 channels and cards", () => {
  const sent = (f: ReturnType<typeof vi.fn>, i = 0) => {
    const [url, init] = f.mock.calls[i] as unknown as [string, RequestInit];
    return { url, body: JSON.parse(init.body as string) };
  };
  const hooks = () => {
    vi.stubEnv("ALERT_WEBHOOK_URL", "https://discord.com/api/webhooks/0/old");
    vi.stubEnv("ALERT_WEBHOOK_SUPPORT", "https://discord.com/api/webhooks/1/sup");
    vi.stubEnv("ALERT_WEBHOOK_FRICTION", "https://discord.com/api/webhooks/2/fri");
    vi.stubEnv("ALERT_WEBHOOK_OPS", "https://discord.com/api/webhooks/3/ops");
  };

  it("routes each kind to its channel: support, friction, ops", async () => {
    const { founderCardFor } = await import("@/lib/founder-alert");
    const ch = (kind: Parameters<typeof founderCardFor>[0]["kind"], detail: unknown = {}) => founderCardFor({ ...ev(kind, detail) })?.channel;
    expect(ch("support_message", { message: "help", email: "a@b.co" })).toBe("support");
    expect(ch("feedback_answer", { question: "link_failed", choice: "other", text: "it hung" })).toBe("support");
    expect(ch("feedback_answer", { question: "link_failed", choice: "other" })).toBe("friction");
    expect(ch("link_failed", { step: "confirm", error: "x" })).toBe("friction");
    expect(ch("signin_failed", { status: 403, error: "x" })).toBe("friction");
    expect(ch("paused_no_usdc", { needCents: 50 })).toBe("friction");
    expect(ch("revoke_seen", { by: "user" })).toBe("friction");
    for (const kind of ["pull_failed", "withdraw_failed", "move_failed", "run_stopped"] as const) expect(ch(kind, { err: "e" }), kind).toBe("ops");
    expect(ch("wallet_linked", { webhookAdded: false })).toBe("ops");
    expect(founderCardFor(ev("split_changed", {}))).toBeNull();
  });

  it("a card carries a plain title, who it is about (clean .skr name), and the next step", async () => {
    const { founderCardFor } = await import("@/lib/founder-alert");
    const c = founderCardFor(ev("link_failed", { step: "confirm", error: "no delegation" }), { skrName: "alice.skr<@1>" })!;
    expect(c.title).toBe("Wallet link failed");
    expect(c.fields).toEqual([["User", "alice.skr1"], ["Wallet", `${W.slice(0, 4)}...${W.slice(-4)}`]]);
    expect(c.todo).toMatch(/retry/);
    expect(c.text).toContain("Link failed at confirm");
  });

  it("sends each card to its own channel's webhook as a Discord embed; support and ops ping him, friction does not", async () => {
    const { alertFounder } = await import("@/lib/founder-alert");
    hooks();
    const f = vi.fn(async () => new Response("ok"));
    vi.stubGlobal("fetch", f);
    await alertFounder({ channel: "support", title: "New message", text: "hi" });
    await alertFounder({ channel: "friction", title: "Wallet link failed", text: "x", todo: "Nothing yet" });
    await alertFounder({ channel: "ops", title: "Planting failed", text: "y" });
    expect(sent(f, 0).url).toContain("/1/sup");
    expect(sent(f, 1).url).toContain("/2/fri");
    expect(sent(f, 2).url).toContain("/3/ops");
    expect(sent(f, 0).body.content).toBe("<@459534488825888769>");
    expect(sent(f, 1).body.content).toBe("");
    expect(sent(f, 1).body.allowed_mentions).toEqual({ parse: [] });
    expect(sent(f, 2).body.allowed_mentions).toEqual({ parse: [], users: ["459534488825888769"] });
    expect(sent(f, 1).body.embeds[0]).toMatchObject({ title: "🧗 Wallet link failed", description: "x", footer: { text: "What to do: Nothing yet" } });
  });

  it("without its own webhook a card falls back to the old feed, the channel named in the title", async () => {
    const { alertFounder } = await import("@/lib/founder-alert");
    vi.stubEnv("ALERT_WEBHOOK_URL", "https://discord.com/api/webhooks/0/old");
    vi.stubEnv("ALERT_WEBHOOK_FRICTION", "");
    const f = vi.fn(async () => new Response("ok"));
    vi.stubGlobal("fetch", f);
    await alertFounder({ channel: "friction", title: "Sign-in failed", text: "x" });
    expect(sent(f).url).toContain("/0/old");
    expect(sent(f).body.embeds[0].title).toBe("🧗 [friction] Sign-in failed");
  });

  it("a user's message stays fenced in the card and can ping nobody else", async () => {
    const { alertFounder, founderCardFor } = await import("@/lib/founder-alert");
    hooks();
    const f = vi.fn(async () => new Response("ok"));
    vi.stubGlobal("fetch", f);
    await alertFounder(founderCardFor({ kind: "support_message", userPubkey: U, walletPubkey: null, detail: { message: "@everyone <@123> [x](https://evil.example)", email: "a@b.co", ref: "S-ABCD" } })!);
    const b = sent(f).body;
    expect(b.embeds[0].title).toBe("💬 New message (S-ABCD)");
    expect(b.embeds[0].description).toContain("```");
    expect(b.allowed_mentions).toEqual({ parse: [], users: ["459534488825888769"] });
  });

  it("Slack and ntfy get the card as plain lines", async () => {
    const { alertFounder, cardText } = await import("@/lib/founder-alert");
    const card = { channel: "ops" as const, title: "Planting failed", text: "boom", fields: [["Wallet", "abcd...wxyz"]] as [string, string][], todo: "Retried next run" };
    expect(cardText(card)).toBe("Planting failed\nboom\nWallet: abcd...wxyz\nWhat to do: Retried next run");
    vi.stubEnv("ALERT_WEBHOOK_OPS", "https://ntfy.sh/t");
    const f = vi.fn(async () => new Response("ok"));
    vi.stubGlobal("fetch", f);
    await alertFounder(card);
    expect((f.mock.calls[0] as unknown as [string, RequestInit])[1].body).toBe(cardText(card));
  });
});

describe("checkWebhookCoverage", () => {
  it("alerts on active and paused wallets the webhook does not watch, never on revoked ones", async () => {
    const { MemoryRepo } = await import("@/db/memory");
    const { checkWebhookCoverage } = await import("@/lib/founder-alert");
    const repo = new MemoryRepo();
    const add = (pubkey: string) => repo.addWallet({ pubkey, userPubkey: U, delegationPda: "P", dailyCapCents: 500, webhookAdded: true });
    await add("watched1111"); await add("activeMissing"); await add("pausedMissing"); await add("revokedMissing");
    await repo.setWalletStatus("pausedMissing", "paused");
    await repo.setWalletStatus("revokedMissing", "revoked");
    const alert = vi.fn(async () => {});
    const r = await checkWebhookCoverage({ repo, watched: async () => ["watched1111"], alert });
    expect(r.missing.sort()).toEqual(["activeMissing", "pausedMissing"]);
    expect(alert).toHaveBeenCalledOnce();
    expect((alert.mock.calls[0] as unknown as [string])[0]).toContain("2 linked wallet(s)");
    alert.mockClear();
    expect((await checkWebhookCoverage({ repo, watched: async () => ["watched1111", "activeMissing", "pausedMissing"], alert })).missing).toEqual([]);
    expect(alert).not.toHaveBeenCalled();
  });

  it("11-10: repairs what it can, and the alert says which were re-added and which are still off", async () => {
    const { MemoryRepo } = await import("@/db/memory");
    const { checkWebhookCoverage } = await import("@/lib/founder-alert");
    const repo = new MemoryRepo();
    const add = (pubkey: string) => repo.addWallet({ pubkey, userPubkey: U, delegationPda: "P", dailyCapCents: 500, webhookAdded: true });
    await add("watched1111"); await add("fixedAAAA"); await add("stuckBBBB");
    const alert = vi.fn(async () => {});
    const repair = vi.fn(async (missing: string[]) => missing.filter((k) => k === "stuckBBBB"));
    const r = await checkWebhookCoverage({ repo, watched: async () => ["watched1111"], repair, alert });
    expect(repair).toHaveBeenCalledWith(expect.arrayContaining(["fixedAAAA", "stuckBBBB"]));
    expect(r).toEqual({ missing: ["stuckBBBB"], repaired: ["fixedAAAA"] });
    const text = (alert.mock.calls[0] as unknown as [string])[0];
    expect(text).toContain("Re-added 1 linked wallet(s)");
    expect(text).toContain("were not counted");
    expect(text).toContain("NOT being counted: 1 linked wallet(s)");
  });

  it("11-10: a full repair still alerts (the gap's swaps were missed); a throwing repair counts as none", async () => {
    const { MemoryRepo } = await import("@/db/memory");
    const { checkWebhookCoverage } = await import("@/lib/founder-alert");
    const repo = new MemoryRepo();
    await repo.addWallet({ pubkey: "goneCCCC", userPubkey: U, delegationPda: "P", dailyCapCents: 500, webhookAdded: true });
    const alert = vi.fn(async () => {});
    const ok = await checkWebhookCoverage({ repo, watched: async () => [], repair: async () => [], alert });
    expect(ok).toEqual({ missing: [], repaired: ["goneCCCC"] });
    expect((alert.mock.calls[0] as unknown as [string])[0]).not.toContain("NOT being counted");
    alert.mockClear();
    const bad = await checkWebhookCoverage({ repo, watched: async () => [], repair: async () => { throw new Error("helius down"); }, alert });
    expect(bad).toEqual({ missing: ["goneCCCC"], repaired: [] });
    expect((alert.mock.calls[0] as unknown as [string])[0]).toContain("NOT being counted: 1 linked wallet(s)");
  });
});
