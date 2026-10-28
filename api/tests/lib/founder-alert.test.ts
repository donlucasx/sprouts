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
    await alertFounder("Paused");
    expect(JSON.parse((f.mock.calls[0] as unknown as [string, RequestInit])[1].body as string)).toEqual({ content: "Paused", text: "Paused" });
    vi.stubEnv("ALERT_WEBHOOK_URL", "https://ntfy.sh/some-topic");
    await alertFounder("Paused");
    expect((f.mock.calls[1] as unknown as [string, RequestInit])[1].body).toBe("Paused");
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
});
