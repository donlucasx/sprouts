import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const { gather } = vi.hoisted(() => ({ gather: vi.fn() }));
vi.mock("@/lib/ops/gather", () => ({ gatherOps: gather }));

import { GET } from "@/app/api/ops/health/route";
import type { OpsSnapshot } from "@/lib/ops/gather";

const TOKEN = "ops-token-for-tests";
const get = (auth: string | null = `Bearer ${TOKEN}`, qs = "") => GET(new Request(`http://x/api/ops/health${qs}`, auth ? { headers: { authorization: auth } } : {}));
const saved = process.env.OPS_TOKEN;

// Fake wallets, already shortened first4…last3 as the sources emit them.
const snap: OpsSnapshot = {
  at: "2026-11-12T00:00:00.000Z",
  lights: [{ key: "dailyRun", label: "Daily savings job", state: "red", fact: "The daily job has never run", action: "Ask Claude to check the daily job." }],
  numbers: {
    now: { linkedNow: 2, active7d: 2 },
    funnel: { d1: { signIns: 1, triedLink: 1, linkedEver: 1 }, d7: { signIns: 2, triedLink: 2, linkedEver: 2 }, all: { signIns: 3, triedLink: 3, linkedEver: 3 } },
    signInFailures24h: 4, linkFailures7d: { "no usdc": 1 },
    activity7d: { swaps: 1, unpriced7d: 0, usdSwappedCents: 100, roundupCents: 10, feeCents: 1, byCoin: { SKR: { plantings: 1, usdCents: 10 } } },
    recentSwaps: [{ at: "2026-11-11T00:00:00.000Z", wallet: "7xKX…9ab", usdCents: 100, status: "ok" }],
    recentPlantings: [{ at: "2026-11-11T00:00:00.000Z", wallet: "Fk3q…z2P", coin: "SKR", usdCents: 10, status: "ok" }],
  },
  numbersAt: "2026-11-12T00:00:00.000Z",
  blindSpots: ["one blind spot"],
  liveOff: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  process.env.OPS_TOKEN = TOKEN;
  gather.mockResolvedValue(snap);
});
afterEach(() => (saved === undefined ? delete process.env.OPS_TOKEN : (process.env.OPS_TOKEN = saved)));

describe("GET /api/ops/health", () => {
  it("404 without a header, wrong token, or OPS_TOKEN unset, before gathering", async () => {
    for (const r of [await get(null), await get("Bearer nope")]) {
      expect(r.status).toBe(404);
      expect(await r.json()).toEqual({ error: "Not found.", code: "not_found" });
    }
    delete process.env.OPS_TOKEN;
    const r = await get("Bearer undefined");
    expect(r.status).toBe(404);
    expect(await r.json()).toEqual({ error: "Not found.", code: "not_found" });
    expect(gather).not.toHaveBeenCalled();
  });
  it("200 + no-store with the right token; body has no full-length wallet", async () => {
    const r = await get();
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toBe("no-store");
    const text = await r.text();
    expect(text).not.toMatch(/[1-9A-HJ-NP-Za-km-z]{32,44}/);
    expect(JSON.parse(text).lights[0].key).toBe("dailyRun");
    expect(JSON.parse(text).lights[0].action).toBe("Ask Claude to check the daily job.");
    expect(JSON.parse(text).numbers.now.linkedNow).toBe(2);
  });
  it("?fresh=1 bypasses the cache", async () => {
    await get();
    expect(gather).toHaveBeenLastCalledWith({ fresh: false });
    await get(`Bearer ${TOKEN}`, "?fresh=1");
    expect(gather).toHaveBeenLastCalledWith({ fresh: true });
  });
  it("500 with no detail when gatherOps throws", async () => {
    gather.mockRejectedValue(new Error("secret detail"));
    const r = await get();
    expect(r.status).toBe(500);
    expect(await r.json()).toEqual({ error: "Could not build the snapshot.", code: "internal" });
  });
});
