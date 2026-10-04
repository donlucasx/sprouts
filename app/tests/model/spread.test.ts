import { describe, it, expect } from "vitest";
import { buildScene, type GardenInput, type Scene } from "@/model/garden";
import { plantLayouts } from "@/model/scene-to-layout";
import { frameFor } from "@/model/layout";
import { previewInputAt } from "@/model/fixtures/median-year";
import { packScene, clearIn } from "@/model/spread";

const now = new Date("2026-10-02T14:30:00-07:00"), d = (id: string, asset: GardenInput["plantings"][number]["asset"], iso: string, c: number) => ({ id, ts: new Date(iso), asset, amountOutRaw: 1n, usdcInCents: c });
const saga = buildScene({ ...previewInputAt(1), now, wateredAt: now, pendingCents: 0, earned: {}, plantings: [d("s", "SKR", "2026-09-29T14:00:00-07:00", 65), d("o", "stORE", "2026-09-30T11:40:00-07:00", 10), d("h", "hSOL", "2026-10-01T19:00:00-07:00", 103), d("j", "JitoSOL", "2026-10-01T16:00:00-07:00", 25), d("u", "JupSOL", "2026-10-01T16:30:00-07:00", 25), d("c", "cbBTC", "2026-10-01T17:00:00-07:00", 25)] });
const slots = (s: Scene) => s.parts.flatMap((q) => (q.kind === "plant" || q.kind === "sign" ? [[q.kind, q.plant, q.x] as const] : []));
const zoom = (s: Scene) => frameFor(s, plantLayouts(s), 320).zoom;

describe("R234: adaptive spacing, the young garden packed together", () => {
  it("the Saga's six young plants pack, the frame zooms in about 1.3x (R235), and no row touches", () => {
    const p = packScene(saga);
    expect(zoom(p)).toBeGreaterThan(zoom(saga) * 1.15); expect(zoom(p)).toBeLessThan(zoom(saga) * 1.5);
    expect(clearIn(p)).toBe(true);
  });
  it("the composition's order and rhythm hold: same left-to-right order, every gap at most its locked width and at least 30 percent of it", () => {
    const a = slots(saga).filter((q) => q[0] === "plant").sort((x, y) => x[2] - y[2]), b = slots(packScene(saga)).filter((q) => q[0] === "plant");
    const pos = new Map(b.map((q) => [q[1], q[2]]));
    for (let i = 1; i < a.length; i++) {
      const g0 = a[i][2] - a[i - 1][2], g = pos.get(a[i][1])! - pos.get(a[i - 1][1])!;
      expect(g).toBeGreaterThan(0); expect(g).toBeLessThanOrEqual(g0 + 1e-9); expect(g).toBeGreaterThanOrEqual(0.3 * g0 - 1e-9);
    }
  });
  it("part order is kept and a plant and its stake share a slot", () => {
    const p = packScene(saga);
    expect(p.parts.map((q) => q.kind)).toEqual(saga.parts.map((q) => q.kind));
    for (const [k, plant, x] of slots(p)) if (k === "plant") expect(slots(p).find((q) => q[0] === "sign" && q[1] === plant)![2]).toBe(x);
  });
  it("the grown year never zooms out for it, and nothing is packed past the locked composition", () => {
    for (const day of [120, 240, 365]) { const s = buildScene(previewInputAt(day)); expect(zoom(packScene(s))).toBeGreaterThanOrEqual(zoom(s) - 1e-9); }
  });
  it("one occupant is left where it is", () => {
    const lone = buildScene({ ...previewInputAt(1), now, wateredAt: now, pendingCents: 0, earned: {}, allocation: { SKR: 100, stORE: 0, hSOL: 0, JitoSOL: 0, JupSOL: 0, cbBTC: 0 }, plantings: [d("s", "SKR", "2026-09-29T14:00:00-07:00", 65)] });
    expect(packScene(lone)).toBe(lone);
  });
});
