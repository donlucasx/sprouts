import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Dashboard } from "@/app/ops/dashboard";
import type { OpsSnapshot } from "@/lib/ops/gather";

const AT = "2026-11-12T12:00:00.000Z";
const NOW = new Date(AT).getTime() + 4 * 60_000;
// Fake values only.
const snap = (over: Partial<OpsSnapshot> = {}): OpsSnapshot => ({
  at: AT,
  lights: [
    { key: "dailyRun", label: "Daily savings job", state: "green", fact: "Ran 3 h ago, everything fine" },
    { key: "firstPlanting", label: "First savings for new users", state: "amber", fact: "Last ran 3 h ago; it should run every hour", action: "Ask Claude if it is still amber later today." },
    { key: "moneyOps", label: "Withdrawals and failures", state: "red", fact: "One withdrawal has been waiting 4 d (it should finish within 60 hours)", action: "Ask Claude to look at it today." },
    { key: "prices", label: "Price feeds", state: "green", fact: "SOL, SKR all up to date; Free price data ends in 49 days (Dec 31)" },
    { key: "support", label: "Support inbox", state: "info", fact: "2 support messages this week, newest 5 h ago" },
  ],
  numbers: {
    now: { linkedNow: 5, active7d: 3 },
    funnel: { d1: { signIns: 1, triedLink: 1, linkedEver: 0 }, d7: { signIns: 12, triedLink: 6, linkedEver: 4 }, all: { signIns: 40, triedLink: 20, linkedEver: 9 } },
    linkFailures7d: { "app:dropped": 2, "server:approval": 1 },
    activity7d: { swaps: 10, unpriced7d: 2, usdSwappedCents: 10000, roundupCents: 500, feeCents: 7, byCoin: { SKR: { plantings: 1, usdCents: 300 }, stORE: { plantings: 1, usdCents: 400 } } },
    recentSwaps: [{ at: "2026-11-12T10:00:00Z", wallet: "Fake…xyz", usdCents: 100, status: "saved at next daily run" }],
    recentPlantings: [{ at: "2026-11-12T09:00:00Z", wallet: "Fake…abc", coin: "SKR", usdCents: 300, status: "confirmed" }],
  },
  numbersAt: AT,
  blindSpots: ["one blind spot"],
  liveOff: false,
  ...over,
});
const html = (s: OpsSnapshot) => renderToStaticMarkup(createElement(Dashboard, { snap: s, nowMs: NOW }));

describe("ops Dashboard markup", () => {
  it("leads with the needs-attention box, red before amber, each with its Do line and a state word", () => {
    const h = html(snap());
    expect(h).toContain("Needs attention: 2");
    expect(h.indexOf("Red: Withdrawals and failures")).toBeGreaterThan(-1);
    expect(h.indexOf("Red: Withdrawals and failures")).toBeLessThan(h.indexOf("Amber: First savings for new users"));
    expect(h).toContain("Do: Ask Claude to look at it today.");
    expect(h).toContain("Updated 4 min ago (12:00 UTC)");
  });
  it("says all good when nothing is red, amber or unknown", () => {
    const h = html(snap({ lights: snap().lights.filter((l) => l.state === "green" || l.state === "info") }));
    expect(h).toContain("All good. Nothing needs you.");
    expect(h).not.toContain("Needs attention");
  });
  it("shows the plain-English headline numbers and footnotes", () => {
    const h = html(snap());
    for (const t of ["Active savers", "Wallets linked now", "New users", "Round-ups collected", "Saved into coins", "$7.00", "Counts exclude Sprouts test wallets.", "Swaps without a dollar value are left out of dollar totals."]) expect(h).toContain(t);
    expect(html(snap({ numbers: { ...snap().numbers!, activity7d: { ...snap().numbers!.activity7d, unpriced7d: 0 } } }))).not.toContain("without a dollar value");
  });
  it("has the four folds, with Pyth countdown and plain link-problem names inside them", () => {
    const h = html(snap());
    expect(h.match(/<details>/g)).toHaveLength(4);
    for (const t of ["All 5 system checks", "Full numbers", "Recent swaps and savings", "What this page can&#x27;t see", "Started linking", "Finished linking", "wallet connection dropped", "approval step failed", "Sprouts fees collected", "Last 24 h", "Free price data ends in 49 days (Dec 31)"]) expect(h).toContain(t);
  });
  it("shows no wallet at all, and never the old jargon", () => {
    const h = html(snap());
    expect(h).not.toContain("Wallet</th>");
    expect(h).not.toMatch(/Fake…|[1-9A-HJ-NP-Za-km-z]{32,44}/);
    expect(h).not.toMatch(/Signed in|Tried to link|Linked ever|Active 7 d|Plantings/);
  });
  it("live switch off: note under the fine line on the main view; absent when on", () => {
    const off = html(snap({ liveOff: true }));
    expect(off).toContain("The live savings switch is off.");
    expect(off.indexOf("The live savings switch is off.")).toBeGreaterThan(off.indexOf("Everything else is fine"));
    expect(html(snap())).not.toContain("live savings switch");
  });
  it("null numbers degrade to a message", () => {
    expect(html(snap({ numbers: null, numbersAt: null }))).toContain("Numbers unavailable");
  });
});
