import { describe, it, expect } from "vitest";
import { verdict, needsAttention, relativeAgo, linkFailureName, savedIntoCoinsCents } from "@/lib/ops/view";
import type { Light } from "@/lib/ops/lights";

const L = (key: string, state: Light["state"]): Light => ({ key: key as Light["key"], label: key, state, fact: "f" });

describe("verdict", () => {
  it("orders red, then amber, then unknown, stable within a state; drops green and info", () => {
    const v = verdict([L("dailyRun", "amber"), L("firstPlanting", "unknown"), L("swapWatching", "green"), L("swapsArriving", "red"), L("prices", "amber"), L("gas", "red"), L("support", "info")]);
    expect(v.attention.map((l) => l.key)).toEqual(["swapsArriving", "gas", "dailyRun", "prices", "firstPlanting"]);
    expect(v.headline).toBe("Needs attention: 5");
    expect(v.fine.map((l) => l.key)).toEqual(["swapWatching"]);
  });
  it("all good when nothing is red, amber or unknown", () => {
    const v = verdict([L("dailyRun", "green"), L("support", "info")]);
    expect(v.headline).toBe("All good. Nothing needs you.");
    expect(v.attention).toEqual([]);
  });
  it("needsAttention does not mutate its input", () => {
    const ls = [L("a", "amber"), L("b", "red")];
    needsAttention(ls);
    expect(ls.map((l) => l.key)).toEqual(["a", "b"]);
  });
});

describe("helpers", () => {
  const now = new Date("2026-11-12T12:00:00Z").getTime();
  it("relativeAgo", () => {
    expect(relativeAgo("2026-11-12T11:56:00Z", now)).toBe("4 min ago");
    expect(relativeAgo("2026-11-12T09:00:00Z", now)).toBe("3 h ago");
    expect(relativeAgo("2026-11-12T11:59:50Z", now)).toBe("just now");
  });
  it("link failure keys get plain names, never the raw key", () => {
    expect(linkFailureName("app:dropped")).toBe("wallet connection dropped");
    expect(linkFailureName("app:refused")).toBe("blocked by Sprouts' safety check");
    expect(linkFailureName("server:new")).toBe("other step failed");
    expect(linkFailureName("server:sign")).toBe("other step failed");
    expect(linkFailureName("server:approval")).toBe("approval step failed");
    expect(linkFailureName("server:weird")).not.toContain("weird");
  });
  it("saved into coins sums every coin", () => expect(savedIntoCoinsCents({ SKR: { usdCents: 567 }, stORE: { usdCents: 946 } })).toBe(1513));
});
