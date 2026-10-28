import { describe, it, expect } from "vitest";
import { noticesFor, type NoticeKind } from "@/lib/notices";
import type { MeResponse } from "@/lib/api";

// R161: four local notices from two consecutive background reads, each behind its own switch.
const split = (skr: number, store: number) => ({ SKR: skr, stORE: store, hSOL: 0, USDC_LEND: 0, SOL_LEND: 0, cbBTC: 0 });
function me(o: { plantings?: string[]; basket?: boolean; picked?: boolean; changedDay?: string | null; why?: string | null; skr?: number; capLeft?: number; cap?: number; fee?: number } = {}): MeResponse {
  return {
    pot: { skrUsd: 0.02, storeUsd: 70 },
    history: { plantings: (o.plantings ?? []).map((id) => ({ id, ts: "", asset: "SKR", usdcInCents: 23, amountOutRaw: "12480000", feeCents: 0, signature: null })), picks: (o.picked ?? true) ? [{ ts: "2026-10-01T10:00:00Z", asset: "SKR", amountRaw: "5000000" }] : [] },
    basket: o.basket ? { id: "b", asset: "SKR", amountRaw: "5000000", unstakeTs: "2026-10-01T10:00:00Z", readyAt: "", delivered: false, deliveredSignature: null } : null,
    lastReceipt: { networkFeeCents: o.fee ?? 3 },
    manager: { managed: true, changedDay: o.changedDay ?? null, why: o.why ?? null },
    rules: { allocation: split(o.skr ?? 100, 100 - (o.skr ?? 100)), dailyCapCents: o.cap ?? 500 },
    nextPlanting: { capLeftCents: o.capLeft ?? 500 },
  } as unknown as MeResponse;
}
const all = () => true;
const titles = (b: MeResponse | null, a: MeResponse, on: (k: NoticeKind) => boolean = all) => noticesFor(b, a, on).map((n) => n.title);

describe("noticesFor (R161)", () => {
  it("says nothing on the first read, and nothing when nothing changed", () => {
    expect(titles(null, me({ plantings: ["p1"], changedDay: "2026-10-02", capLeft: 0 }))).toEqual([]);
    expect(titles(me({ plantings: ["p1"] }), me({ plantings: ["p1"] }))).toEqual([]);
  });
  it("a new planting lands", () => {
    expect(noticesFor(me(), me({ plantings: ["p1"] }), all)).toEqual([
      { kind: "plantings", title: "Planted", body: "Your change was planted: $0.23 became 12.48 SKR ($0.25)." },
    ]);
  });
  it("a withdrawal is delivered when the basket goes", () => {
    expect(noticesFor(me({ basket: true }), me(), all)).toEqual([
      { kind: "withdrawals", title: "Withdrawal delivered", body: "5.00 SKR ($0.10) is in your wallet." },
    ]);
  });
  it("a cancelled withdrawal (its pick gone) is not a delivery (review finding 4)", () => {
    expect(titles(me({ basket: true }), me({ picked: false }))).toEqual([]);
  });
  it("the manager moved the split: the new split, its reason, the undo", () => {
    expect(noticesFor(me(), me({ changedDay: "2026-10-02", skr: 60, why: "stORE is paying more this week." }), all)).toEqual([
      { kind: "manager", title: "Your split moved", body: "Your yield manager moved your split to 60% SKR, 40% stORE. stORE is paying more this week. You can undo it in Rules." },
    ]);
  });
  it("the manager notice fires once per move, and not when a save of yours clears the day", () => {
    expect(titles(me({ changedDay: "2026-10-02" }), me({ changedDay: "2026-10-02" }))).toEqual([]);
    expect(titles(me({ changedDay: "2026-10-02" }), me({ changedDay: null }))).toEqual([]);
    expect(titles(me({ changedDay: "2026-10-02" }), me({ changedDay: "2026-10-03" }))).toEqual(["Your split moved"]);
  });
  it("the daily limit: a planting landed and what is left no longer covers the network fee", () => {
    expect(noticesFor(me({ capLeft: 120 }), me({ plantings: ["p1"], capLeft: 0 }), (k) => k === "limit")).toEqual([
      { kind: "limit", title: "Daily limit reached", body: "Today's limit is used up. Your change keeps adding up and plants tomorrow." },
    ]);
    expect(titles(me({ capLeft: 120 }), me({ plantings: ["p1"], capLeft: 2, fee: 3 }))).toContain("Daily limit reached"); // finding 7
    expect(titles(me({ capLeft: 120 }), me({ plantings: ["p1"], capLeft: 4, fee: 3 }))).not.toContain("Daily limit reached");
  });
  it("no limit notice without a planting: a lowered cap, or the chain-read fallback flapping back (findings 1 and 3)", () => {
    expect(titles(me({ capLeft: 300 }), me({ capLeft: 0, cap: 100 }))).toEqual([]); // cap lowered under what was pulled
    expect(titles(me({ plantings: ["p1"], capLeft: 500 }), me({ plantings: ["p1"], capLeft: 0 }))).toEqual([]); // fallback full, then real 0
  });
  it("no limit notice when the cap is zero (finding: the guard was untested)", () => {
    expect(titles(me({ capLeft: 120 }), me({ plantings: ["p1"], capLeft: 0, cap: 0 }))).not.toContain("Daily limit reached");
  });
  it("each switch silences only its own notice", () => {
    const before = me({ basket: true, capLeft: 100 });
    const after = me({ plantings: ["p1"], changedDay: "2026-10-02", capLeft: 0 });
    expect(titles(before, after)).toEqual(["Planted", "Withdrawal delivered", "Your split moved", "Daily limit reached"]);
    for (const off of ["plantings", "withdrawals", "manager", "limit"] as NoticeKind[]) {
      expect(noticesFor(before, after, (k) => k !== off).map((n) => n.kind)).not.toContain(off);
      expect(noticesFor(before, after, (k) => k !== off)).toHaveLength(3);
    }
  });

  it("a wallet newly paused for want of USDC: once per pause, worded for this phone's wallet or another (10-22)", () => {
    const PHONE = "HJCJKRQLV2HVKfe3sFdTF5jjBY1xfWgnK8cLcjH7qnHd", WEB = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";
    const noUsdc = { reason: "no_usdc", needCents: 300, resumeAtCents: 201 };
    const at = (wallets: { pubkey: string; status: string; pause?: unknown }[]) => ({ ...me(), user: { pubkey: PHONE }, wallets }) as unknown as MeResponse;
    const active = at([{ pubkey: PHONE, status: "active" }, { pubkey: WEB, status: "active" }]);
    const paused = at([{ pubkey: PHONE, status: "paused", pause: noUsdc }, { pubkey: WEB, status: "paused", pause: noUsdc }]);
    expect(noticesFor(active, paused, all)).toEqual([
      { kind: "paused", title: "Seed Vault wallet needs USDC", body: "Plantings are paused and your round-ups wait. Open Sprouts to add USDC." },
      { kind: "paused", title: "7xKX...gAsU needs USDC", body: "Plantings from it are paused and your round-ups wait. Add USDC to 7xKX...gAsU to start again." },
    ]);
    // the next poll, still paused: nothing; the user's own pause: nothing; its switch off: nothing
    expect(noticesFor(paused, paused, all)).toEqual([]);
    expect(noticesFor(active, at([{ pubkey: PHONE, status: "paused", pause: { reason: "user" } }]), all)).toEqual([]);
    expect(noticesFor(active, paused, (k) => k !== "paused")).toEqual([]);
    // paused again after it had started again: a new pause, a new notice
    expect(titles(paused, active)).toEqual([]);
    expect(titles(active, at([{ pubkey: PHONE, status: "paused", pause: noUsdc }]))).toEqual(["Seed Vault wallet needs USDC"]);
  });

  // 10-27 (ikeonsol.skr): a wallet Sprouts stopped on its own was only hidden; now the phone hears it once
  it("a wallet newly stopped by Sprouts: once, by name; never for a wallet the user revoked", () => {
    const PHONE = "HJCJKRQLV2HVKfe3sFdTF5jjBY1xfWgnK8cLcjH7qnHd", WEB = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";
    const at = (wallets: { pubkey: string; status: string; stopped?: string | null }[]) => ({ ...me(), user: { pubkey: PHONE }, wallets }) as unknown as MeResponse;
    const active = at([{ pubkey: PHONE, status: "active" }, { pubkey: WEB, status: "active" }]);
    const stopped = at([{ pubkey: PHONE, status: "revoked", stopped: "approval" }, { pubkey: WEB, status: "revoked", stopped: "outside" }]);
    expect(noticesFor(active, stopped, all)).toEqual([
      { kind: "paused", title: "Sprouts stopped planting from your Seed Vault wallet", body: "Open Sprouts to link it again." },
      { kind: "paused", title: "Sprouts stopped planting from 7xKX...gAsU", body: "Open Sprouts to link it again." },
    ]);
    expect(noticesFor(stopped, stopped, all)).toEqual([]);
    expect(noticesFor(active, at([{ pubkey: PHONE, status: "revoked", stopped: null }]), all)).toEqual([]);
    expect(noticesFor(active, stopped, (k) => k !== "paused")).toEqual([]);
  });
});

// 10-27: this phone's wallet running low on USDC, from the background task, once per low spell
describe("lowUsdcNotice", async () => {
  const { lowUsdcNotice } = await import("@/lib/notices");
  it("says so once when the wallet drops under a week of round-ups, again only after it recovered", () => {
    const first = lowUsdcNotice(120, 35, false, false);
    expect(first).toEqual({ notice: { kind: "paused", title: "Seed Vault wallet is low on USDC", body: "$1.20 left. Open Sprouts to add more before plantings pause." }, low: true });
    expect(lowUsdcNotice(110, 35, true, false)).toEqual({ notice: null, low: true });
    expect(lowUsdcNotice(900, 35, true, false)).toEqual({ notice: null, low: false });
    expect(lowUsdcNotice(120, 35, false, false).notice).not.toBeNull();
  });
  it("an empty wallet says so even with no pace yet; a paused wallet is the paused notice's; an unread balance changes nothing", () => {
    expect(lowUsdcNotice(0, null, false, false).notice?.title).toBe("Seed Vault wallet has no USDC");
    expect(lowUsdcNotice(0, null, false, true)).toEqual({ notice: null, low: true });
    expect(lowUsdcNotice(null, 35, true, false)).toEqual({ notice: null, low: true });
    expect(lowUsdcNotice(500, null, false, false)).toEqual({ notice: null, low: false });
  });
});
