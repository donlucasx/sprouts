import { describe, it, vi } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { LiveAsset } from "@/lib/coins";
import { buildScene, PLANT_OF, type GardenInput, type Scene } from "@/model/garden";
import { previewInputAt } from "@/model/fixtures/median-year";
import { widgetGardenSvg } from "@/model/widget-svg";
import { SPRITES_B64 } from "@/garden/sprites-b64";
import { SOIL } from "@/model/species";

/**
 * Not a test: with TIMELAPSE=<out dir> it writes one HTML page per frame of a made-up year (R368: SKR and stORE lead the split), the
 * garden drawn by the widget's SVG renderer at the app's framing with the @3x sprites, for headless Chrome to screenshot. Skipped in the suite.
 */
// R369: the timelapse keeps every plant and stake on its year-end spot under one camera (the app's packing and auto framing move them
// as the garden grows, which read as choppy); FIXED is empty while the year-end layout is measured, so the real ones run then.
const FIXED: { x: Map<string, number> | null; frame: unknown; signs: Map<string, unknown> | null; record: Map<string, unknown> | null } = { x: null, frame: null, signs: null, record: null };
vi.mock("@/model/spread", async (orig) => {
  const m = await orig<typeof import("@/model/spread")>();
  return { ...m, packScene: (scene: Scene, ...a: [number?, number?]) => {
    const packed = m.packScene(scene, ...a); if (!FIXED.x) return packed;
    return { ...packed, parts: packed.parts.map((q) => ((q.kind === "plant" || q.kind === "sign") && FIXED.x!.has(`${q.kind}:${q.plant}`) ? { ...q, x: FIXED.x!.get(`${q.kind}:${q.plant}`)! } : q)) };
  } };
});
vi.mock("@/model/layout", async (orig) => {
  const m = await orig<typeof import("@/model/layout")>();
  // R371: a stake keeps the spot it has at the year's end (recorded on the year-end pass), from its first planting on
  return { ...m, frameFor: (...a: Parameters<typeof m.frameFor>) => (FIXED.frame as ReturnType<typeof m.frameFor>) ?? m.frameFor(...a),
    signPlacement: (...a: Parameters<typeof m.signPlacement>) => {
      const key = (a[0] as { plant: string }).plant;
      if (FIXED.signs?.has(key)) return FIXED.signs.get(key) as ReturnType<typeof m.signPlacement>;
      const at = m.signPlacement(...a); FIXED.record?.set(key, at); return at;
    } };
});
// R372: five plants for the demo, the lenders kept ("the lenders are part of the juice"); cbBTC dropped (it earns 0%)
const SPLIT: [LiveAsset, number][] = [["SKR", 0.35], ["stORE", 0.3], ["USDC_LEND", 0.15], ["hSOL", 0.1], ["SOL_LEND", 0.1]];
const START = new Date("2026-10-08T12:00:00-07:00").getTime();
/** R370: the yearly rates behind the caption's Earned: SKR Guardian staking 16.4% (solanamobile.com/skr, research 01), stORE ~17%
 * (research 21), hSOL ~7% (an LST's staking yield; an assumption), the lending stakes at the app's fixture venues (Kamino 4.4%, Jupiter
 * 3.9%), cbBTC 0 (it earns nothing). Simple interest per planting from its day. */
const RATE: Record<LiveAsset, number> = { SKR: 0.164, stORE: 0.17, hSOL: 0.07, USDC_LEND: 0.044, SOL_LEND: 0.039, cbBTC: 0 };
/** R370: the lending stakes' second line in the API's words (lend-view.ts: venue short name + rate to one decimal). */
const LEND_SIGNS = { USDC_LEND: { line2: "Kamino 4.4%" }, SOL_LEND: { line2: "Jupiter 3.9%" } };
/** R370 ("hSOL ... move to the left a bit (currently covered by SKR)", "cbBTC ... to the right a tad, w its stake"): nudges in shares of the width. */
// R372: the back row spread so USDC clears SKR's tree and SOL clears stORE
// (the USDC stake moved on alone, out from behind SKR's trunk)
const NUDGE: Record<string, number> = { hsol: -0.08, jitosol: 0.06, jupsol: 0.2 };
/** Moves of a placed stake board in canvas units (the stake slots are assigned by order, so moving the stake's x reshuffles them). */
const BOARD_NUDGE: Record<string, number> = { jitosol: 54 };
const LABEL: Record<LiveAsset, string> = { SKR: "SKR", stORE: "stORE", hSOL: "hSOL", USDC_LEND: "USDC", SOL_LEND: "SOL", cbBTC: "cbBTC" };
function mulberry32(seed: number) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
/** medianYear's history (102 plantings, bands 55 / 35 / 10, a watering a week) with this split. */
function year(seed = 7) {
  const rnd = mulberry32(seed); const plantings: GardenInput["plantings"] = []; const putInCents = { SKR: 0, stORE: 0, hSOL: 0, USDC_LEND: 0, SOL_LEND: 0, cbBTC: 0 } as Record<LiveAsset, number>;
  for (let i = 0; i < 102; i++) {
    const day = (i + 0.5) * (365 / 102) + (rnd() - 0.5) * 1.6; const r = rnd(); let acc = 0; let asset: LiveAsset = "SKR";
    for (const [a, share] of SPLIT) { acc += share; if (r < acc) { asset = a; break; } }
    const b = rnd(); const cents = b < 0.55 ? 40 + Math.floor(rnd() * 59) : b < 0.9 ? 100 + Math.floor(rnd() * 400) : 501 + Math.floor(rnd() * 600);
    putInCents[asset] += cents;
    plantings.push({ id: `tl${i}`, ts: new Date(START + day * 86_400_000), asset, amountOutRaw: BigInt(cents) * 1000n, usdcInCents: cents });
  }
  const waterings = Array.from({ length: 52 }, (_, w) => new Date(START + (w * 7 + 3) * 86_400_000));
  return { plantings, waterings, putInCents };
}

describe.skipIf(!process.env.TIMELAPSE)("timelapse frames", () => {
  it("writes the pages", async () => {
    const out = path.resolve(process.env.TIMELAPSE!); mkdirSync(out, { recursive: true });
    const sprites = path.resolve(__dirname, "../../assets/garden");
    for (const k of Object.keys(SPRITES_B64)) SPRITES_B64[k] = `@@${k}@@`;   // the @3x files by path instead of the 1x data
    const fx = year(), days = Number(process.env.TIMELAPSE_DAYS ?? 365), step = Number(process.env.TIMELAPSE_STEP ?? 0.5);
    // R369: no swelling (the change waiting, a saw-tooth in a made-up year: it blinked on SKR's top), every bud opened, no rings
    const at = (day: number): { input: GardenInput; scene: Scene } => {
      const input = { ...previewInputAt(day, fx), pendingCents: 0, lendSigns: LEND_SIGNS }; input.wateredAt = input.now;
      const s0 = buildScene(input); const planted = new Set(input.plantings.map((p) => PLANT_OF[p.asset]));   // R371: a stake appears with its coin's first planting
      return { input, scene: { ...s0, parts: s0.parts.filter((q) => q.kind !== "ring" && q.kind !== "swelling" && q.kind !== "seed" && (q.kind !== "sign" || planted.has(q.plant))) } };
    };
    const { packScene } = await import("@/model/spread"); const { frameFor } = await import("@/model/layout"); const { plantLayouts } = await import("@/model/scene-to-layout");
    const packed = packScene(at(days).scene);   // the nudges go in before the camera is fitted, so it frames the moved plants
    const end = { ...packed, parts: packed.parts.map((q) => ((q.kind === "plant" || q.kind === "sign") && (NUDGE[q.plant] || NUDGE[`${q.kind}:${q.plant}`]) ? { ...q, x: q.x + (NUDGE[q.plant] ?? 0) + (NUDGE[`${q.kind}:${q.plant}`] ?? 0) } : q)) };
    FIXED.x = new Map(end.parts.flatMap((q) => (q.kind === "plant" || q.kind === "sign" ? [[`${q.kind}:${q.plant}`, q.x] as [string, number]] : [])));
    FIXED.frame = frameFor(end, plantLayouts(end), (await import("@/model/spread")).SPREAD.ref);
    FIXED.record = new Map();
    const endSvg = widgetGardenSvg(at(days).scene, 1080, 720);
    FIXED.signs = FIXED.record; FIXED.record = null;
    for (const [k, d] of Object.entries(BOARD_NUDGE)) { const b = FIXED.signs.get(k) as { x: number } | undefined; if (b) FIXED.signs.set(k, { ...b, x: b.x + d }); }
    // the view (and the soil drawn to it) widens with the plants' height: both locked
    const box = /viewBox="[^"]+"/.exec(endSvg)![0], GROUND_USE = /<use xlink:href="#s-ground"[^>]*\/>/, ground = GROUND_USE.exec(endSvg)![0];
    let n = 0;
    for (let day = 1; day <= days + 1e-9; day += step) {
      const { input, scene } = at(day);
      const svg = widgetGardenSvg(scene, 1080, 720).replace(/viewBox="[^"]+"/, box).replace(GROUND_USE, ground).replace(/data:image\/png;base64,@@(.+?)@@/g, (_, k) => `file://${sprites}/${k}@3x.png`);
      const put = (a: LiveAsset) => input.plantings.filter((p) => p.asset === a).reduce((s, p) => s + p.usdcInCents, 0) / 100;
      const total = SPLIT.reduce((s, [a]) => s + put(a), 0);
      const earned = input.plantings.reduce((s, p) => s + (p.usdcInCents / 100) * RATE[p.asset] * ((input.now.getTime() - p.ts.getTime()) / (365 * 86_400_000)), 0);
      const coins = SPLIT.map(([a]) => `<span>${LABEL[a]} <b>$${put(a).toFixed(0)}</b></span>`).join("");
      const page = `<!doctype html><meta charset="utf-8"><body style="margin:0;width:1080px;height:940px;background:${SOIL.paper};font-family:Helvetica,Arial,sans-serif;color:${SOIL.ink}">
<div style="height:720px">${svg}</div>
<div style="padding:24px 40px 0;display:flex;justify-content:space-between;align-items:baseline"><span style="font-size:44px;font-weight:700">Day ${Math.floor(day)}</span><span style="font-size:44px">$${total.toFixed(2)} saved &middot; <b style="color:#3F7D3A">$${earned.toFixed(2)} earned</b></span></div>
<div style="padding:18px 40px 0;display:flex;justify-content:space-between;font-size:28px;color:#6B5340">${coins}</div>
<div style="padding:14px 40px 0;font-size:20px;color:#9a8a78">Simulated year, ${input.plantings.length} plantings. Split SKR 35%, stORE 30%, USDC 15%, hSOL 10%, SOL 10%. Earned at SKR 16.4%, stORE 17%, hSOL 7%, USDC 4.4%, SOL 3.9% a year.</div></body>`;
      writeFileSync(path.join(out, `f${String(n++).padStart(4, "0")}.html`), page);
    }
  });
});
