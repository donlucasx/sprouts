import { describe, it, expect } from "vitest";
import { reminderFor, type ReminderFacts } from "@/domain/reminders";

const H = 3_600_000;
const D = 24 * H;
const now = new Date("2026-11-08T15:00:00Z");
const ago = (ms: number) => new Date(now.getTime() - ms);

const facts = (over: Partial<ReminderFacts> = {}): ReminderFacts => ({
  now,
  signedUpAt: ago(30 * D),
  walletsEver: 1,
  activeWallets: 1,
  pausedNoUsdcSince: [],
  stoppedSince: [],
  lastSwapAt: ago(1 * D),
  firstActiveLinkAt: ago(25 * D),
  lastLinkFailAt: null,
  lastLinkAttemptAfterFail: false,
  ...over,
});

const noWallet = (over: Partial<ReminderFacts> = {}) => facts({ walletsEver: 0, activeWallets: 0, lastSwapAt: null, firstActiveLinkAt: null, ...over });

describe("reminderFor", () => {
  it("no reminder for a healthy user", () => {
    expect(reminderFor(facts())).toBeNull();
  });

  it("A1 on day 1, A2 on day 3, A3 on day 7 for a user with no wallet", () => {
    const a1 = reminderFor(noWallet({ signedUpAt: ago(1 * D) }))!;
    expect(a1.id).toBe("nolink-1");
    expect(a1.kind).toBe("link_new");
    expect(a1.route).toBe("/connect");
    expect(a1.title).toBe("Your garden is ready to plant");
    const a2 = reminderFor(noWallet({ signedUpAt: ago(3 * D) }))!;
    expect(a2.id).toBe("nolink-3");
    expect(a2.title).toBe("Round-ups start with a wallet");
    const a3 = reminderFor(noWallet({ signedUpAt: ago(30 * D) }))!;
    expect(a3.id).toBe("nolink-7");
    expect(a3.body).toBe("Link a wallet whenever you're ready. We won't remind you again.");
    expect(reminderFor(noWallet({ signedUpAt: ago(20 * H) }))).toBeNull();
  });

  it("A5 every 3 days of a no-USDC pause, never on the day it paused", () => {
    const p = (ms: number) => facts({ pausedNoUsdcSince: [{ wallet: "AbCdEfGh", since: ago(ms) }] });
    expect(reminderFor(p(2 * D))).toBeNull();
    const r1 = reminderFor(p(3 * D))!;
    expect(r1.kind).toBe("usdc_waiting");
    expect(r1.id.endsWith("-1")).toBe(true);
    expect(r1.id.startsWith("usdc-AbCd-")).toBe(true);
    expect(r1.route).toBe("/home");
    expect(r1.title).toBe("Your round-ups are still waiting");
    expect(r1.body).toBe("Add USDC to your wallet and plantings start again by themselves.");
    expect(reminderFor(p(7 * D))!.id.endsWith("-2")).toBe(true);
  });

  it("A5 uses the oldest paused wallet", () => {
    const r = reminderFor(facts({ pausedNoUsdcSince: [{ wallet: "NEWWxxxx", since: ago(4 * D) }, { wallet: "OLDDxxxx", since: ago(7 * D) }] }))!;
    expect(r.id.startsWith("usdc-OLDD-")).toBe(true);
    expect(r.id.endsWith("-2")).toBe(true);
  });

  it("a new pause gets new ids", () => {
    const a = reminderFor(facts({ pausedNoUsdcSince: [{ wallet: "AbCdEfGh", since: ago(4 * D) }] }))!;
    const b = reminderFor(facts({ pausedNoUsdcSince: [{ wallet: "AbCdEfGh", since: ago(10 * D) }] }))!;
    expect(a.id).not.toBe(b.id);
  });

  it("A7 seven days after Sprouts stopped a wallet, only with no active wallet", () => {
    const s = (ms: number, active: number) => facts({ activeWallets: active, stoppedSince: [{ wallet: "WxYzWxYz", since: ago(ms) }] });
    const r = reminderFor(s(7 * D, 0))!;
    expect(r.kind).toBe("relink");
    expect(r.id).toBe(`relink-WxYz-${new Date(now.getTime() - 7 * D).toISOString().slice(0, 10)}`);
    expect(r.route).toBe("/connect");
    expect(r.title).toBe("Your wallet is still unlinked");
    expect(r.body).toBe("Link your wallet again to pick up where you left off.");
    expect(reminderFor(s(6 * D, 0))).toBeNull();
    expect(reminderFor(s(7 * D, 1))).toBeNull();
  });

  it("A8 after 14 quiet days, once per quiet spell", () => {
    const at = ago(15 * D);
    const r = reminderFor(facts({ lastSwapAt: at }))!;
    expect(r.kind).toBe("idle");
    expect(r.id).toBe(`idle-${at.toISOString().slice(0, 10)}`);
    expect(r.route).toBe("/home");
    expect(r.title).toBe("Your garden is waiting");
    expect(reminderFor(facts({ lastSwapAt: ago(13 * D) }))).toBeNull();
    const never = reminderFor(facts({ lastSwapAt: null, firstActiveLinkAt: ago(15 * D) }))!;
    expect(never.id).toBe(`idle-${ago(15 * D).toISOString().slice(0, 10)}`);
  });

  it("A9 the day after a failed link, unless the user tried again or linked", () => {
    const failAt = ago(20 * H);
    // 22 h so A1 (day 1) has not fired yet; otherwise the null assertions below would see nolink-1.
    const base = noWallet({ lastLinkFailAt: failAt, signedUpAt: ago(22 * H) });
    const r = reminderFor(base)!;
    expect(r.kind).toBe("link_unfinished");
    expect(r.id).toBe(`unfinished-${failAt.toISOString().slice(0, 10)}`);
    expect(r.route).toBe("/connect");
    expect(r.title).toBe("Linking didn't finish");
    expect(reminderFor({ ...base, lastLinkAttemptAfterFail: true })).toBeNull();
    expect(reminderFor({ ...base, lastLinkFailAt: ago(2 * H), signedUpAt: ago(2 * H) })).toBeNull();
  });

  it("A9 stops after 7 days and falls through to link_new", () => {
    const r = reminderFor(noWallet({ signedUpAt: ago(30 * D), lastLinkFailAt: ago(8 * D) }))!;
    expect(r.kind).toBe("link_new");
    expect(r.id).toBe("nolink-7");
  });

  it("A9 is suppressed when the user has an active wallet", () => {
    expect(reminderFor(facts({ lastLinkFailAt: ago(20 * H) }))).toBeNull();
  });

  it("relink beats link_new for a user whose only wallet was stopped 8 days ago", () => {
    const since = ago(8 * D);
    const r = reminderFor(facts({ walletsEver: 1, activeWallets: 0, lastSwapAt: null, firstActiveLinkAt: null, signedUpAt: ago(30 * D), stoppedSince: [{ wallet: "WxYzWxYz", since }] }))!;
    expect(r.kind).toBe("relink");
    expect(r.id).toBe(`relink-WxYz-${since.toISOString().slice(0, 10)}`);
  });

  it("priority: one reminder when several apply", () => {
    const r = reminderFor(noWallet({
      signedUpAt: ago(30 * D),
      lastLinkFailAt: ago(20 * H),
      pausedNoUsdcSince: [{ wallet: "AbCdEfGh", since: ago(4 * D) }],
    }))!;
    expect(r.kind).toBe("link_unfinished");
    const r2 = reminderFor(facts({
      pausedNoUsdcSince: [{ wallet: "AbCdEfGh", since: ago(4 * D) }],
      lastSwapAt: ago(20 * D),
    }))!;
    expect(r2.kind).toBe("usdc_waiting");
  });

  it("every title is at most 40 characters and no copy has an em dash or a dollar sign", () => {
    const outs = [
      noWallet({ signedUpAt: ago(1 * D) }),
      noWallet({ signedUpAt: ago(3 * D) }),
      noWallet({ signedUpAt: ago(9 * D) }),
      facts({ pausedNoUsdcSince: [{ wallet: "AbCdEfGh", since: ago(4 * D) }] }),
      facts({ activeWallets: 0, stoppedSince: [{ wallet: "AbCdEfGh", since: ago(8 * D) }] }),
      facts({ lastSwapAt: ago(20 * D) }),
      noWallet({ lastLinkFailAt: ago(20 * H) }),
    ].map((f) => reminderFor(f)!);
    expect(new Set(outs.map((o) => o.kind)).size).toBe(5);
    for (const o of outs) {
      expect(o.title.length).toBeLessThanOrEqual(40);
      expect(o.title + o.body).not.toMatch(/[—$]/);
    }
  });
});
