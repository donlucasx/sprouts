import { describe, it, expect } from "vitest";
import { BAR_GAP, CAN_GROW, CAN_MS, POUR_SHARE, FINGER_IN, ROW_GAP, STREAM, WOBBLE_WAIT_MS, canScale, canHit, canRoomBelow, canSeat, canSlot, clampDrag, grabAt, overlayToCanvas, dropSize, roseAt, roseOnScreen, streamDrop, streamPiece, DRIP } from "@/model/can";
import { SIDE_GUTTER } from "@/model/layout";
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

describe("the drag holds the finger inside the overlay (R196; Android drops touches outside a parent's bounds)", () => {
  const s = canScale(1.3), width = 320, seat = canSeat(width, GARDEN_H + ROW_GAP + BAR_Y, s), hit = canHit(s);
  const bounds = { w: width + SIDE_GUTTER, h: overlayH(s) };   // the overlay reaches into the right gutter
  const centre = grabAt(seat, hit, { x: hit.w / 2, y: hit.h / 2 }), corner = grabAt(seat, hit, { x: hit.w - 2, y: hit.h - 2 });
  /** The touch box, lifted `lift` about its centre, after a drag of (dx, dy). */
  const boxAt = (d: { dx: number; dy: number }, lift: number) => {
    const cx = seat.x - hit.ox + hit.w / 2 + d.dx, cy = seat.y - hit.oy + hit.h / 2 + d.dy;
    return { x0: cx - (lift * hit.w) / 2, x1: cx + (lift * hit.w) / 2, y0: cy - (lift * hit.h) / 2, y1: cy + (lift * hit.h) / 2 };
  };
  it("the finger's point at rest is the seat's box plus the point in it", () => {
    expect(grabAt({ x: 100, y: 50 }, { ox: 30, oy: 20 }, { x: 5, y: 6 })).toEqual({ x: 75, y: 36 });
  });
  it("a drag inside passes through unchanged", () => {
    expect(clampDrag(-120, -90, seat, hit, bounds, 1.08, centre)).toEqual({ dx: -120, dy: -90 });
  });
  it("past the left, the top and the bottom it stops with the whole lifted box inside, and the finger too", () => {
    for (const [tx, ty] of [[-1000, 0], [0, -1000], [0, 1000], [-1000, -1000], [40, 60]]) for (const lift of [1, 1.08]) for (const g of [centre, corner]) {
      const d = clampDrag(tx, ty, seat, hit, bounds, lift, g), b = boxAt(d, lift);
      expect(b.x0).toBeGreaterThanOrEqual(-1e-9); expect(b.y0).toBeGreaterThanOrEqual(-1e-9); expect(b.y1).toBeLessThanOrEqual(bounds.h + 1e-9);
      expect(g.x + d.dx).toBeGreaterThanOrEqual(FINGER_IN - 1e-9); expect(g.y + d.dy).toBeGreaterThanOrEqual(FINGER_IN - 1e-9);
      expect(g.y + d.dy).toBeLessThanOrEqual(bounds.h - FINGER_IN + 1e-9);
    }
  });
  it("past the right only the finger is held, FINGER_IN inside the overlay; the can's art hangs past the edge", () => {
    for (const g of [centre, corner]) {
      const d = clampDrag(1000, -60, seat, hit, bounds, 1.08, g);
      expect(g.x + d.dx).toBeCloseTo(bounds.w - FINGER_IN, 9);
      expect(boxAt(d, 1.08).x1).toBeGreaterThan(bounds.w);
    }
  });
  // a grab on the far edge of the handle (the box's right edge) falls a few px short at some zooms: a device check
  it("the rose (where it pours, at -40 degrees) reaches cbBTC at the right-most slot (.92) for a grab anywhere left of the body's centre", () => {
    for (const z of ZOOMS) for (const w of [320, 372]) {
      const sz = canScale(z), st = canSeat(w, GARDEN_H + ROW_GAP + BAR_Y, sz), h = canHit(sz), bd = { w: w + SIDE_GUTTER, h: overlayH(sz) };
      for (const local of [{ x: 0, y: h.h / 2 }, { x: h.w / 2, y: h.h / 2 }, { x: h.ox, y: h.oy }]) {
        const g = grabAt(st, h, local), d = clampDrag(1000, -80, st, h, bd, 1.08, g);
        const rose = roseOnScreen(st, d, -40, 1.08, sz, h);
        expect(rose.x).toBeGreaterThanOrEqual(0.92 * w - 40);   // within plantUnder's 40 px of cbBTC's foot (zoom 1: screen = canvas)
      }
    }
  });
  it("the rose still reaches over the left-most slot's plant (hSOL at .09) and the garden's top band", () => {
    const far = clampDrag(-1000, -1000, seat, hit, bounds, 1.08, centre), r = roseAt(-40, s);
    const rose = { x: seat.x + far.dx + r.x, y: seat.y + far.dy + r.y };
    expect(rose.x).toBeLessThanOrEqual(0.09 * width + 40);   // within plantUnder's 40 px of hSOL's foot
    expect(rose.y).toBeLessThan(GARDEN_H / 2);
  });
});

describe("the tap's slide is held as the drag is (fix round 1, R196), the box's centre standing for the finger", () => {
  it("toward hSOL at the far left, the lifted box stays inside and the rose still lands over hSOL's slot", () => {
    for (const z of ZOOMS) {
      const s = canScale(z), width = 320, seat = canSeat(width, GARDEN_H + ROW_GAP + BAR_Y, s), hit = canHit(s), r = roseAt(-40, s);
      const spot = { x: 0.09 * width, y: 40 };   // the tap's rose spot over hSOL (Garden spotOf: the foot's x, 10 px over the tip)
      const d = clampDrag(spot.x - r.x - seat.x, spot.y - r.y - seat.y, seat, hit, { w: width + SIDE_GUTTER, h: overlayH(s) }, 1.08, grabAt(seat, hit, { x: hit.w / 2, y: hit.h / 2 }));
      const cx = seat.x - hit.ox + hit.w / 2 + d.dx, cy = seat.y - hit.oy + hit.h / 2 + d.dy;
      expect(cx - (1.08 * hit.w) / 2).toBeGreaterThanOrEqual(-1e-9); expect(cy - (1.08 * hit.h) / 2).toBeGreaterThanOrEqual(-1e-9);
      expect(Math.abs(seat.x + d.dx + r.x - spot.x)).toBeLessThan(40);   // plantUnder's 40 px
    }
  });
});

describe("the rose on screen (where the stream leaves the can)", () => {
  const s = canScale(1), hit = canHit(s), seat = canSeat(320, 200, s);
  it("unlifted, it is the seat plus the drag plus the rose turned by the tilt", () => {
    const r = roseAt(-40, s), at = roseOnScreen(seat, { dx: -50, dy: -30 }, -40, 1, s, hit);
    expect(at.x).toBeCloseTo(seat.x - 50 + r.x, 9); expect(at.y).toBeCloseTo(seat.y - 30 + r.y, 9);
  });
  it("lifted, it moves out from the touch box's centre (the view's transform origin) by the lift", () => {
    const r = roseAt(0, s), cx = seat.x - hit.ox + hit.w / 2, cy = seat.y - hit.oy + hit.h / 2, at = roseOnScreen(seat, { dx: 0, dy: 0 }, 0, 1.08, s, hit);
    expect(at.x - cx).toBeCloseTo(1.08 * (seat.x + r.x - cx), 9); expect(at.y - cy).toBeCloseTo(1.08 * (seat.y + r.y - cy), 9);
  });
});

describe("the wobble waits (R195) and the stream's shape (R201)", () => {
  it("the wobble starts 2 s after the can shows ready", () => expect(WOBBLE_WAIT_MS).toBe(2000));
  it("R202: the can's sequence is G11's doubled, its pour about 4 s", () => {
    expect(CAN_MS).toBe(2 * 5400);
    expect(CAN_MS * POUR_SHARE).toBeGreaterThan(3800); expect(CAN_MS * POUR_SHARE).toBeLessThan(4300);
  });
  it("the stream is thin and see-through, thinning as it falls, in pieces that tile the unbroken part", () => {
    expect(STREAM.opacity).toBeLessThanOrEqual(0.5);
    expect(STREAM.widths).toHaveLength(STREAM.segments);
    for (let k = 1; k < STREAM.widths.length; k++) expect(STREAM.widths[k]!).toBeLessThan(STREAM.widths[k - 1]!);
    expect(Math.max(...STREAM.widths) * dropSize(canScale(2))).toBeLessThan(4);   // under 4 px wide at the largest garden
    const fall = 90, pieces = Array.from({ length: STREAM.segments }, (_, k) => streamPiece(k, fall, 1));
    expect(pieces[0]!.top).toBe(0);
    for (let k = 1; k < pieces.length; k++) expect(pieces[k]!.top).toBeCloseTo(pieces[k - 1]!.top + pieces[k - 1]!.h, 9);
    const last = pieces[pieces.length - 1]!;
    expect(last.top + last.h).toBeCloseTo(fall * STREAM.body, 9);   // the unbroken part ends above the ground
    expect(streamPiece(0, 3, 1).h).toBeCloseTo((8 * STREAM.body) / STREAM.segments, 9);   // never under an 8 px fall
  });
  it("it grows from the rose down: a piece shows once the stream reaches it", () => {
    expect(streamPiece(0, 90, 0).h).toBe(0);
    expect(streamPiece(1, 90, 0.2).h).toBe(0);                       // 0.2 x 3 = 0.6 of the first piece
    expect(streamPiece(0, 90, 0.2).h).toBeCloseTo(0.6 * streamPiece(0, 90, 1).h, 9);
    expect(streamPiece(2, 90, 1).h).toBeGreaterThan(0);
  });
  it("its drops fall from the stream's end to the ground, accelerating, and fade just above the splash", () => {
    const fall = 90, from = fall * (STREAM.body - 0.03);
    for (let i = 0; i < STREAM.drops; i++) for (let q = 0; q < 1; q += 0.01) {
      const d = streamDrop(i, q, fall);
      expect(d.y).toBeGreaterThanOrEqual(from - 1e-9); expect(d.y).toBeLessThanOrEqual(fall + 1e-9);
      expect(d.alpha).toBeGreaterThanOrEqual(0); expect(d.alpha).toBeLessThanOrEqual(1);
    }
    // within one beat, the first drop speeds up: equal steps of phase cover more ground later
    const step = 0.2 / STREAM.beats, y = (q: number) => streamDrop(0, q, fall).y;
    expect(y(2 * step) - y(step)).toBeGreaterThan(y(step) - y(0));
    expect(streamDrop(0, 0.95 / STREAM.beats, fall).alpha).toBeLessThan(1);
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
