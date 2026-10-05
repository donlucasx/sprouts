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
      { kind: "withdrawals", title: "Withdrawal delivered", body: "5.00 SKR ($0.10) is in your Seeker's wallet." },
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
});
