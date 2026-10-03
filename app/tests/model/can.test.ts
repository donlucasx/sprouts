import { describe, it, expect } from "vitest";
import { BAR_GAP, CAN_GROW, ROW_GAP, canScale, canHit, canRoomBelow, canSeat, canSlot, clampDrag, overlayToCanvas, dropSize, roseAt, DRIP } from "@/model/can";
import { plantUnder } from "@/model/layout";
import { SPRITE_META } from "@/garden/sprite-meta";

const REST = SPRITE_META["can"];
const ZOOMS = [0.5, 1, 1.25, 1.5, 2];
describe("the can's size and seat (R175; R180; R184; R188: 2.6x the first can, tucked under the soil's bottom-right corner)", () => {
  it("is drawn 2.6x G11's proportion (can11 at a third of the frame's zoom), never under 2.6 x 32 px wide", () => {
    expect(CAN_GROW).toBe(2.6);
    expect(REST.w * canScale(1)).toBeCloseTo(2.6 * 32, 9);              // at zoom 1 the 32 px floor: 83.2 px
    expect(REST.w * canScale(2)).toBeCloseTo(2.6 * REST.w * 2 / 3, 9);   // at the cap: 127.7 px
  });
});

// R186: the can sits at the right end of the Next planting row, the bar running into it, in an overlay over the garden and the row
// (the overlay's origin is the garden's top-left). A row under a garden GARDEN_H tall, ROW_GAP below it, its bar's centre BAR_Y down it.
const GARDEN_H = 148.71, BAR_H = 12, BAR_Y = 32;
const rowH = (s: number) => BAR_Y + BAR_H / 2 + canRoomBelow(s, BAR_H);
const overlayH = (s: number) => GARDEN_H + ROW_GAP + rowH(s);
describe("the can at the end of the bar (R186)", () => {
  for (const z of ZOOMS) it(`at zoom ${z}: its right edge 4 px in, its drawn box centred on the bar, the bar stopping just before it`, () => {
    const s = canScale(z), bar = GARDEN_H + ROW_GAP + BAR_Y, seat = canSeat(320, bar, s);
    expect(seat.x + (REST.w - REST.ax) * s).toBeCloseTo(316, 9);
    expect((seat.y - REST.ay * s + seat.y + (REST.h - REST.ay) * s) / 2).toBeCloseTo(bar, 9);
    const barRight = 320 - canSlot(s), canLeft = seat.x - REST.ax * s;
    expect(canLeft - barRight).toBeCloseTo(BAR_GAP, 9); expect(BAR_GAP).toBeGreaterThan(0); expect(BAR_GAP).toBeLessThanOrEqual(8);
  });
});

describe("the can's touch box (R184 item 5, R188): at least 48 dp, all of it inside the overlay that holds it, holding the whole can", () => {
  for (const z of ZOOMS) it(`at zoom ${z}`, () => {
    const s = canScale(z), width = 320, seat = canSeat(width, GARDEN_H + ROW_GAP + BAR_Y, s), hit = canHit(s);
    const box = { x0: seat.x - hit.ox, y0: seat.y - hit.oy, x1: seat.x - hit.ox + hit.w, y1: seat.y - hit.oy + hit.h };
    expect(hit.w).toBeGreaterThanOrEqual(48); expect(hit.h).toBeGreaterThanOrEqual(48);
    // inside the overlay: the garden's width, from the garden's top to the row's bottom (Android drops touches outside a parent's bounds)
    expect(box.x0).toBeGreaterThanOrEqual(0); expect(box.x1).toBeLessThanOrEqual(width + 1e-9);
    expect(box.y0).toBeGreaterThanOrEqual(0); expect(box.y1).toBeLessThanOrEqual(overlayH(s) + 1e-9);
    // the row's room below its bar is exactly what the box needs (the row grows with the can, no more)
    expect(box.y1).toBeCloseTo(overlayH(s), 9);
    // it holds the drawn rest can
    expect(box.x0).toBeLessThanOrEqual(seat.x - REST.ax * s); expect(box.x1).toBeGreaterThanOrEqual(seat.x + (REST.w - REST.ax) * s - 1e-9);
    expect(box.y0).toBeLessThanOrEqual(seat.y - REST.ay * s); expect(box.y1).toBeGreaterThanOrEqual(seat.y + (REST.h - REST.ay) * s - 1e-9);
  });
});

describe("the drag stays inside the overlay (Android drops touches outside a parent's bounds)", () => {
  const s = canScale(1.3), width = 320, seat = canSeat(width, GARDEN_H + ROW_GAP + BAR_Y, s), hit = canHit(s), bounds = { w: width, h: overlayH(s) };
  /** The touch box, lifted `lift` about its centre, after a drag of (dx, dy). */
  const boxAt = (d: { dx: number; dy: number }, lift: number) => {
    const cx = seat.x - hit.ox + hit.w / 2 + d.dx, cy = seat.y - hit.oy + hit.h / 2 + d.dy;
    return { x0: cx - (lift * hit.w) / 2, x1: cx + (lift * hit.w) / 2, y0: cy - (lift * hit.h) / 2, y1: cy + (lift * hit.h) / 2 };
  };
  it("a drag inside passes through unchanged", () => {
    expect(clampDrag(-120, -90, seat, hit, bounds, 1.08)).toEqual({ dx: -120, dy: -90 });
  });
  it("past any edge it stops with the whole lifted box inside, the garden's top included", () => {
    for (const [tx, ty] of [[-1000, 0], [1000, 0], [0, -1000], [0, 1000], [-1000, -1000], [40, 60]]) for (const lift of [1, 1.08]) {
      const b = boxAt(clampDrag(tx, ty, seat, hit, bounds, lift), lift);
      expect(b.x0).toBeGreaterThanOrEqual(-1e-9); expect(b.x1).toBeLessThanOrEqual(width + 1e-9);
      expect(b.y0).toBeGreaterThanOrEqual(-1e-9); expect(b.y1).toBeLessThanOrEqual(bounds.h + 1e-9);
    }
  });
  it("the rose still reaches over every slot's plant: the left-most slot (hSOL at .09) and the garden's top band", () => {
    const far = clampDrag(-1000, -1000, seat, hit, bounds, 1.08), r = roseAt(-40, s);
    const rose = { x: seat.x + far.dx + r.x, y: seat.y + far.dy + r.y };
    expect(rose.x).toBeLessThanOrEqual(0.09 * width + 40);   // within plantUnder's 40 px of hSOL's foot
    expect(rose.y).toBeLessThan(GARDEN_H / 2);
  });
});

describe("the tap's slide is held inside the overlay too (fix round 1)", () => {
  it("toward hSOL at the far left, the lifted box stays inside and the rose still lands over hSOL's slot", () => {
    for (const z of ZOOMS) {
      const s = canScale(z), width = 320, seat = canSeat(width, GARDEN_H + ROW_GAP + BAR_Y, s), hit = canHit(s), r = roseAt(-40, s);
      const spot = { x: 0.09 * width, y: 40 };   // the tap's rose spot over hSOL (Garden spotOf: the foot's x, 10 px over the tip)
      const d = clampDrag(spot.x - r.x - seat.x, spot.y - r.y - seat.y, seat, hit, { w: width, h: overlayH(s) }, 1.08);
      const cx = seat.x - hit.ox + hit.w / 2 + d.dx, cy = seat.y - hit.oy + hit.h / 2 + d.dy;
      expect(cx - (1.08 * hit.w) / 2).toBeGreaterThanOrEqual(-1e-9); expect(cy - (1.08 * hit.h) / 2).toBeGreaterThanOrEqual(-1e-9);
      expect(Math.abs(seat.x + d.dx + r.x - spot.x)).toBeLessThan(40);   // plantUnder's 40 px
    }
  });
});

describe("the drop hit-test, from the overlay's coordinates into the garden's canvas (R186)", () => {
  const frame = { x: 20, y: 120, zoom: 1.5 };   // a zoomed garden: canvas p lands at (p - frame) * zoom on the garden's view
  const slots = { skr: 0.3, jitosol: 0.5 };
  it("the overlay's origin is the garden's top-left, so a point over the garden maps through the frame", () => {
    expect(overlayToCanvas({ x: 0, y: 0 }, frame)).toEqual({ x: 20, y: 120 });
    expect(overlayToCanvas({ x: 120, y: 60 }, frame)).toEqual({ x: 100, y: 160 });
  });
  it("a rose over a budded plant pours there; over the row, or between plants, nothing", () => {
    const over = (x: number, y: number) => { const c = overlayToCanvas({ x, y }, frame); return plantUnder(c.x, c.y, slots, 320); };
    expect(over((0.3 * 320 - 20) * 1.5, 100)).toBe("skr");
    expect(over((0.5 * 320 - 20) * 1.5, 100)).toBe("jitosol");
    // the row lies under the garden's view: (260 - 120) * 1.5 = 210 px tall; the bar's end and below map past the front feet
    expect(over((0.3 * 320 - 20) * 1.5, 210 + ROW_GAP + BAR_Y)).toBeNull();
    expect(over((220 - 20) * 1.5, 100)).toBeNull();   // canvas x 220: 60 px from JitoSOL's foot, past plantUnder's 40
  });
});

describe("the drip (R184 item 3): one drop at the rose every 4 s while a bud waits", () => {
  it("forms at the rose of the can at rest and falls a short way", () => {
    expect(DRIP.everyMs).toBe(4000);
    expect(DRIP.formMs + DRIP.fallMs).toBeLessThan(DRIP.everyMs);
    const r = roseAt(0, 1); expect(r).toEqual({ x: -38, y: -22 });   // gen11_motion.py:123, sprite units
    expect(DRIP.fallPx).toBeGreaterThan(0); expect(DRIP.fallPx).toBeLessThanOrEqual(16);
  });
  it("the drops keep the garden's scale, not the can's", () => expect(dropSize(canScale(1.5))).toBeCloseTo(1.5, 9));
});
