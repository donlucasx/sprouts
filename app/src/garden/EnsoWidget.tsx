"use no memo";
import { FlexWidget, OverlapWidget, SvgWidget, TextWidget } from "react-native-android-widget";
import type { MeResponse } from "@/lib/api";
import { buildScene } from "@/model/garden";
import { ensoGarden } from "@/model/widget2-svg";
import { stagesFor } from "@/model/garden2";
import { toGardenInput, type ZeroMarks } from "@/lib/garden-input";
import { gardenTotals, valueBlock } from "@/lib/me-state";
import { formatUsd } from "@/lib/format";
import { widgetHeadline } from "@/lib/widget-state";
import { isSlim, LABEL_SIZE, lineBox, STATE_MIN, textWidth } from "./widget-layout";
import type { PlantId } from "@/model/garden";

/**
 * DRAFT 10-26 (his rulings 10-23 and 10-26; previews/widget-styles-1023/board-states.png): the ensō widget. Raked sand, the app's
 * gauge as a ring, and inside it a window on the live garden centred on the SKR tree (ensoGarden), never faded: the ring owns its edge.
 * Three shapes from the widget's proportions: full (the ring round the garden, the words inside it), wide (2x1: the ring at the left,
 * the words at the right) and the slim pill (4x1). Paused, the ring is its empty track and the words ask for USDC in the wallet.
 */
const SAND = "#ECE5D3", PAPER = "#FFFCF7", INK = "#2B2B2B" as const, QUIET = "#6B6558" as const, ACCENT = "#145A3C" as const;
const RIPPLE = "rgba(140,116,78,0.45)", RIPPLE_LIGHT = "rgba(255,255,255,0.85)";
const BIG = 16, LINE = 12;
/** Tall from this width to height ratio (a 3x3 is 0.66, the 3x2 square 1.0); the words' blocks above and below the ring, in dp. */
const TALL_RATIO = 0.8, MINI_W = 140;
/** Tall (10-27 round 4, his notes: the bottom words "touching the edges of the planting circle... a tad smaller"; "format the text to
 *  read well over the sand rings"): each block centred in its band of sand, on a soft paper label so the rings never cross the letters. */
const TALL_PAD = 12, PLATE_X = 14, PLATE_Y = 5;
type Plate = { x: number; y: number; w: number; h: number };
const f = (n: number) => Number(n.toFixed(2));

type Words = { title: string; sub: string | null; accent: string | null; foot: string | null; fraction: number | null; ask: boolean };

function wordsFor(me: MeResponse, total: string, parts: { parts: never[] } | { parts: unknown[] }, now: Date, room: number, big = BIG): Words {
  const head = widgetHeadline(me, parts as never, now, total, total !== formatUsd(0), {
    big: (t) => textWidth(t, big, true) <= room, label: (t) => textWidth(t, LABEL_SIZE, true) <= room, line: (t) => textWidth(t, STATE_MIN, true) <= room,
  });
  // the garden itself paused: the ask is the headline and the ring empties
  if (head.action && !head.walletAsk) return { title: head.big, sub: null, accent: head.label, foot: head.line, fraction: 0, ask: true };
  // one wallet needs USDC while the garden still plants (10-26): the money stays the headline, the ask takes the accent line
  if (head.action) return { title: total, sub: "in your garden", accent: head.label, foot: head.big.includes(total) ? null : head.big, fraction: head.fraction, ask: true };
  const saving = head.fraction !== null && head.fraction > 0 && head.fraction < 1;
  return { title: total, sub: "in your garden", accent: head.big.includes(total) ? null : head.big, foot: saving ? "next planting" : head.label, fraction: head.fraction, ask: false };
}

function ring(cx: number, cy: number, r: number, sw: number, fr: number | null): string {
  const track = `<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(r)}" fill="none" stroke="${PAPER}" stroke-width="${sw}"/><circle cx="${f(cx)}" cy="${f(cy)}" r="${f(r)}" fill="none" stroke="#A7F0B6" stroke-opacity="0.42" stroke-width="${sw}"/><circle cx="${f(cx)}" cy="${f(cy)}" r="${f(r)}" fill="none" stroke="#E3FBD9" stroke-opacity="0.8" stroke-width="${f(sw * 0.45)}"/>`;
  if (!fr || fr <= 0) return track;
  const a = Math.min(0.999, fr) * 2 * Math.PI;
  const x1 = cx + r * Math.sin(a), y1 = cy - r * Math.cos(a);
  const arc = `M${f(cx)},${f(cy - r)} A${f(r)},${f(r)} 0 ${a > Math.PI ? 1 : 0} 1 ${f(x1)},${f(y1)}`;
  return track + `<path d="${arc}" fill="none" stroke="#2E8B57" stroke-opacity="0.72" stroke-width="${sw}" stroke-linecap="round"/><path d="${arc}" fill="none" stroke="#FFFFFF" stroke-opacity="0.22" stroke-width="${f(sw * 0.3)}" stroke-linecap="round"/><circle cx="${f(x1)}" cy="${f(y1)}" r="${f(sw * 0.62)}" fill="#236F47" fill-opacity="0.4"/>`;
}

/** The sand card with a round hole for the garden window, its raked ripples round the ring, and the ring. */
function card(w: number, h: number, rx: number, cx: number, cy: number, r: number, sw: number, fr: number | null, plates: Plate[] = [], paperHole = false): string {
  const hole = r - sw * 0.45;
  const rr = `M${rx},0 H${f(w - rx)} A${rx},${rx} 0 0 1 ${w},${rx} V${f(h - rx)} A${rx},${rx} 0 0 1 ${f(w - rx)},${h} H${rx} A${rx},${rx} 0 0 1 0,${f(h - rx)} V${rx} A${rx},${rx} 0 0 1 ${rx},0 Z`;
  const circle = `M${f(cx - hole)},${f(cy)} A${f(hole)},${f(hole)} 0 1 0 ${f(cx + hole)},${f(cy)} A${f(hole)},${f(hole)} 0 1 0 ${f(cx - hole)},${f(cy)} Z`;
  let ripples = "";
  const step = Math.max(4, r / 9);
  for (let k = 0, rad = r + sw; rad < Math.hypot(w, h); k++, rad += step)
    ripples += `<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(rad)}" fill="none" stroke="${RIPPLE}" stroke-width="0.6"/><circle cx="${f(cx)}" cy="${f(cy + 0.5)}" r="${f(rad)}" fill="none" stroke="${RIPPLE_LIGHT}" stroke-width="0.45"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><defs><clipPath id="c"><path d="${rr}"/></clipPath></defs><path d="${rr} ${circle}" fill="${SAND}" fill-rule="evenodd"/><g clip-path="url(#c)">${ripples}</g>${paperHole ? `<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(hole + 1)}" fill="${PAPER}"/>` : ""}${plates.map((q) => `<rect x="${f(q.x)}" y="${f(q.y)}" width="${f(q.w)}" height="${f(q.h)}" rx="${f(Math.min(14, q.h / 2))}" fill="${PAPER}" fill-opacity="0.9" stroke="${RIPPLE}" stroke-width="0.6"/>`).join("")}${ring(cx, cy, r, sw, fr)}</svg>`;
}

const text = (t: string | null, size: number, color: `#${string}`, bold: boolean, align: "left" | "center" = "left") =>
  t ? <TextWidget text={t} maxLines={1} truncate="END" style={{ fontSize: size, color, fontWeight: bold ? "700" : "normal", textAlign: align }} /> : null;

export function EnsoWidget({ me, width, height, wateredPlants = null, restartMarks = {}, now = new Date() }: { me: MeResponse | null; width: number; height: number; wateredPlants?: PlantId[] | null; restartMarks?: ZeroMarks; now?: Date }) {
  const ratio = width / Math.max(1, height);
  // 10-27 (his note on the 3x3, 276 x 417: "shall we adapt the text to fit it better?"): a widget much taller than wide puts the words
  // in the sand above and below the ring (tall), the ring holding only the garden
  // 10-27 (his note: "the enso 1x1 does not work rn- lets make a version without art that has relevant text and planting bar"): one
  // column wide is the mini, the ring as the gauge with the total inside it and one line under it, no garden
  const mode = isSlim(width, height) ? "pill" : width < MINI_W ? "mini" : ratio >= 1.3 ? "wide" : ratio <= TALL_RATIO ? "tall" : "full";
  const round = mode === "full" || mode === "tall";
  // the slim pill sits centred in its row (his ruling 10-23: "slimmer like the pill"); the others fill the widget, 4 dp in
  const W = width - 8, H = mode === "pill" ? Math.min(height - 8, 72) : height - 8;
  const top = (height - H) / 2;
  // tall: the words' sizes come from the width first, then the ring takes what the two bands leave
  const tT = Math.round(Math.min(28, Math.max(BIG + 2, W * 0.11))), tS = Math.max(LABEL_SIZE, Math.round(tT * 0.48)), tA = Math.max(LINE, Math.round(tT * 0.52));
  const topH = lineBox(tT) + lineBox(tS), botH = lineBox(tA) + lineBox(tS);
  const tallTop = topH + 2 * (TALL_PAD + PLATE_Y), tallBot = H - (botH + 2 * (TALL_PAD + PLATE_Y));
  const R = mode === "mini" ? Math.min(W / 2 - 6, (H - 22) / 2 - 4) : mode === "full" ? Math.min(W, H) / 2 - 8 : mode === "tall" ? Math.min(W / 2 - 8, (tallBot - tallTop) / 2 - 4) : H / 2 - (mode === "pill" ? 5 : 10);
  const sw = round ? Math.max(5, R / 17) : mode === "wide" ? 4.5 : mode === "mini" ? 4 : 3.5;
  const cx = round || mode === "mini" ? W / 2 : mode === "pill" ? H / 2 : R + 12, cy = mode === "tall" ? (tallTop + tallBot) / 2 : mode === "mini" ? R + 8 : H / 2;
  const rx = mode === "pill" ? H / 2 : Math.min(22, H * 0.12);
  const shell = (children: unknown) => (
    <FlexWidget clickAction="OPEN_APP" style={{ width: "match_parent", height: "match_parent", paddingLeft: 4, paddingRight: 4, paddingTop: top, paddingBottom: top }}>
      <OverlapWidget style={{ width: W, height: H }}>{children as never}</OverlapWidget>
    </FlexWidget>
  );
  if (!me) return shell(<SvgWidget svg={card(W, H, rx, cx, cy, R, sw, null)} style={{ width: W, height: H }} />);
  let words: Words, garden: string | null = null;
  const room = mode === "full" ? R * 1.5 : mode === "tall" ? W - 24 : mode === "mini" ? W - 8 : W - (cx + R) - 18;
  // 10-27 (his note: the 2x2 / 2x3 "should show the 19.92 a bit bigger... the bigger 3x3, fonts should fit accordingly"): the full and
  // tall words grow with the widget, the title with the ring (or the width when tall), the smaller lines in step; never under the
  // approved mock's sizes (18 / 11 / 12)
  const T = mode === "tall" ? tT : round ? Math.round(Math.min(30, Math.max(BIG + 2, R * 0.19))) : BIG + 2;
  const S = mode === "tall" ? tS : Math.max(LABEL_SIZE, Math.round(T * 0.5)), A = mode === "tall" ? tA : Math.max(LINE, Math.round(T * 0.55)); // the bottom lines sit where the ring narrows (10-27)
  try {
    const total = valueBlock(gardenTotals(me), BigInt(me.pot.skrStakedRaw)).big;
    let scene: ReturnType<typeof buildScene> | null = null, input: ReturnType<typeof toGardenInput> | null = null;
    try { input = toGardenInput(me, now, wateredPlants, restartMarks); scene = buildScene(input); } catch { scene = null; }
    words = wordsFor(me, total, { parts: scene?.parts ?? [] }, now, room, round ? T - 2 : BIG);
    const D = Math.floor(2 * (R - sw * 0.45)) + 2;
    if (input && mode !== "mini") garden = ensoGarden(stagesFor(input), { basket: !!me.basket && !me.basket.delivered }, D, PAPER, round);
  } catch {
    return shell([<SvgWidget key="c" svg={card(W, H, rx, cx, cy, R, sw, null)} style={{ width: W, height: H }} />]);
  }
  const D = Math.floor(2 * (R - sw * 0.45)) + 2;
  // tall: the bands of sand above and below the ring, and a paper label sized to each block's words
  const bandTop = cy - R - sw, bandBot = cy + R + sw;
  const plate = (lines: [string | null, number, boolean][], mid: number): Plate | null => {
    const shown = lines.filter(([t]) => t);
    if (!shown.length) return null;
    const w = Math.min(W - 16, Math.max(...shown.map(([t, s, b]) => textWidth(t!, s, b))) + 2 * PLATE_X);
    const h = shown.reduce((c, [, s]) => c + lineBox(s), 0) + 2 * PLATE_Y;
    return { x: cx - w / 2, y: mid - h / 2, w, h };
  };
  const plates = mode === "tall"
    ? [plate([[words.title, T, true], [words.sub, S, false]], bandTop / 2), plate([[words.accent, A, true], [words.foot, S, false]], (bandBot + H) / 2)].filter((q): q is Plate => q !== null)
    : [];
  const layers = [
    garden ? (
      <FlexWidget key="g" style={{ width: W, height: H, paddingLeft: Math.round(cx - D / 2), paddingTop: Math.round(cy - D / 2) }}>
        <SvgWidget svg={garden} style={{ width: D, height: D }} />
      </FlexWidget>
    ) : null,
    <SvgWidget key="c" svg={card(W, H, rx, cx, cy, R, sw, words.fraction, plates, mode === "mini")} style={{ width: W, height: H }} />,
  ];
  if (mode === "full") {
    // the words inside the ring; 10-27 (his note: the bottom line touched the ring) the bottom inset 0.16 R -> 0.24 R
    layers.push(
      <FlexWidget key="t" style={{ width: W, height: H, flexDirection: "column", justifyContent: "space-between", alignItems: "center", paddingTop: cy - R + R * 0.2, paddingBottom: H - cy - R + R * 0.24, paddingLeft: cx - R * 0.72, paddingRight: W - cx - R * 0.72 }}>
        <FlexWidget style={{ flexDirection: "column", alignItems: "center" }}>
          {text(words.title, T, INK, true, "center")}
          {text(words.sub, S, QUIET, false, "center")}
        </FlexWidget>
        <FlexWidget style={{ flexDirection: "column", alignItems: "center" }}>
          {text(words.accent, A, ACCENT, true, "center")}
          {text(words.foot, S, QUIET, false, "center")}
        </FlexWidget>
      </FlexWidget>,
    );
  } else if (mode === "mini") {
    // the total inside the gauge ring, the one line that matters under it (the ask in accent, else the state)
    const under = words.ask ? words.accent : words.fraction !== null && words.fraction > 0 && words.fraction < 1 ? "next planting" : words.foot ?? words.accent;
    layers.push(
      <FlexWidget key="t" style={{ width: W, height: H, flexDirection: "column", alignItems: "center" }}>
        <FlexWidget style={{ width: W, height: Math.round(cy + R + sw / 2), justifyContent: "center", alignItems: "center", paddingLeft: 4, paddingRight: 4 }}>
          {text(words.title, Math.max(12, Math.min(16, Math.round(R * 0.36))), INK, true, "center")}
        </FlexWidget>
        <FlexWidget style={{ width: W, height: H - Math.round(cy + R + sw / 2), justifyContent: "center", alignItems: "center", paddingLeft: 4, paddingRight: 4 }}>
          {text(under, LABEL_SIZE - 1, words.ask ? ACCENT : QUIET, words.ask, "center")}
        </FlexWidget>
      </FlexWidget>,
    );
  } else if (mode === "tall") {
    layers.push(
      <FlexWidget key="t" style={{ width: W, height: H, flexDirection: "column", alignItems: "center" }}>
        <FlexWidget style={{ width: W, height: Math.round(bandTop), flexDirection: "column", justifyContent: "center", alignItems: "center" }}>
          {text(words.title, T, INK, true, "center")}
          {text(words.sub, S, QUIET, false, "center")}
        </FlexWidget>
        <FlexWidget style={{ width: W, height: Math.round(bandBot) - Math.round(bandTop) }} />
        <FlexWidget style={{ width: W, height: H - Math.round(bandBot), flexDirection: "column", justifyContent: "center", alignItems: "center" }}>
          {text(words.accent, A, ACCENT, true, "center")}
          {text(words.foot, S, QUIET, false, "center")}
        </FlexWidget>
      </FlexWidget>,
    );
  } else {
    const left = cx + R + (mode === "pill" ? 10 : 12);
    layers.push(
      <FlexWidget key="t" style={{ width: W, height: H, flexDirection: "column", justifyContent: "center", paddingLeft: left, paddingRight: mode === "pill" ? 20 : 6 }}>
        {/* the widget renderer draws widget elements only: plain children, never a fragment (TypeError on the Seeker, 10-26) */}
        {mode === "pill" ? text(words.sub ? `${words.title} ${words.sub}` : words.title, BIG, INK, true) : text(words.title, BIG, INK, true)}
        {mode === "pill"
          ? text([words.accent, words.foot].filter(Boolean).join(" · "), LINE, words.ask ? ACCENT : QUIET, words.ask)
          : text(words.sub ? "in garden" : null, LABEL_SIZE, QUIET, false)}
        {mode === "pill" ? null : text(words.accent, LINE, ACCENT, true)}
        {mode === "pill" ? null : text(words.foot, LABEL_SIZE, QUIET, false)}
      </FlexWidget>,
    );
  }
  return shell(layers.filter(Boolean));
}
