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
import { LABEL_SIZE, STATE_MIN, textWidth } from "./widget-layout";
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
const f = (n: number) => Number(n.toFixed(2));

type Words = { title: string; sub: string | null; accent: string | null; foot: string | null; fraction: number | null; ask: boolean };

function wordsFor(me: MeResponse, total: string, parts: { parts: never[] } | { parts: unknown[] }, now: Date, room: number): Words {
  const head = widgetHeadline(me, parts as never, now, total, total !== formatUsd(0), {
    big: (t) => textWidth(t, BIG, true) <= room, label: (t) => textWidth(t, LABEL_SIZE, true) <= room, line: (t) => textWidth(t, STATE_MIN, true) <= room,
  });
  // the garden itself paused: the ask is the headline and the ring empties
  if (head.action && !head.walletAsk) return { title: head.big, sub: null, accent: head.label, foot: head.line, fraction: 0, ask: true };
  // one wallet needs USDC while the garden still plants (10-26): the money stays the headline, the ask takes the accent line
  if (head.action) return { title: total, sub: "in your garden", accent: head.label, foot: head.big.includes(total) ? null : head.big, fraction: head.fraction, ask: true };
  const saving = head.fraction !== null && head.fraction < 1;
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
function card(w: number, h: number, rx: number, cx: number, cy: number, r: number, sw: number, fr: number | null): string {
  const hole = r - sw * 0.45;
  const rr = `M${rx},0 H${f(w - rx)} A${rx},${rx} 0 0 1 ${w},${rx} V${f(h - rx)} A${rx},${rx} 0 0 1 ${f(w - rx)},${h} H${rx} A${rx},${rx} 0 0 1 0,${f(h - rx)} V${rx} A${rx},${rx} 0 0 1 ${rx},0 Z`;
  const circle = `M${f(cx - hole)},${f(cy)} A${f(hole)},${f(hole)} 0 1 0 ${f(cx + hole)},${f(cy)} A${f(hole)},${f(hole)} 0 1 0 ${f(cx - hole)},${f(cy)} Z`;
  let ripples = "";
  const step = Math.max(4, r / 9);
  for (let k = 0, rad = r + sw; rad < Math.hypot(w, h); k++, rad += step)
    ripples += `<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(rad)}" fill="none" stroke="${RIPPLE}" stroke-width="0.6"/><circle cx="${f(cx)}" cy="${f(cy + 0.5)}" r="${f(rad)}" fill="none" stroke="${RIPPLE_LIGHT}" stroke-width="0.45"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><defs><clipPath id="c"><path d="${rr}"/></clipPath></defs><path d="${rr} ${circle}" fill="${SAND}" fill-rule="evenodd"/><g clip-path="url(#c)">${ripples}</g>${ring(cx, cy, r, sw, fr)}</svg>`;
}

const text = (t: string | null, size: number, color: `#${string}`, bold: boolean, align: "left" | "center" = "left") =>
  t ? <TextWidget text={t} maxLines={1} truncate="END" style={{ fontSize: size, color, fontWeight: bold ? "700" : "normal", textAlign: align }} /> : null;

export function EnsoWidget({ me, width, height, wateredPlants = null, restartMarks = {}, now = new Date() }: { me: MeResponse | null; width: number; height: number; wateredPlants?: PlantId[] | null; restartMarks?: ZeroMarks; now?: Date }) {
  const ratio = width / Math.max(1, height);
  const mode = ratio >= 3 ? "pill" : ratio >= 1.3 ? "wide" : "full";
  // the slim pill sits centred in its row (his ruling 10-23: "slimmer like the pill"); the others fill the widget, 4 dp in
  const W = width - 8, H = mode === "pill" ? Math.min(height - 8, 72) : height - 8;
  const top = (height - H) / 2;
  const R = mode === "full" ? Math.min(W, H) / 2 - 8 : H / 2 - (mode === "pill" ? 5 : 10);
  const sw = mode === "full" ? Math.max(5, R / 17) : mode === "wide" ? 4.5 : 3.5;
  const cx = mode === "full" ? W / 2 : mode === "pill" ? H / 2 : R + 12, cy = H / 2;
  const rx = mode === "pill" ? H / 2 : Math.min(22, H * 0.12);
  const shell = (children: unknown) => (
    <FlexWidget clickAction="OPEN_APP" style={{ width: "match_parent", height: "match_parent", paddingLeft: 4, paddingRight: 4, paddingTop: top, paddingBottom: top }}>
      <OverlapWidget style={{ width: W, height: H }}>{children as never}</OverlapWidget>
    </FlexWidget>
  );
  if (!me) return shell(<SvgWidget svg={card(W, H, rx, cx, cy, R, sw, null)} style={{ width: W, height: H }} />);
  let words: Words, garden: string | null = null;
  const room = mode === "full" ? R * 1.5 : W - (cx + R) - 18;
  try {
    const total = valueBlock(gardenTotals(me), BigInt(me.pot.skrStakedRaw)).big;
    let scene: ReturnType<typeof buildScene> | null = null, input: ReturnType<typeof toGardenInput> | null = null;
    try { input = toGardenInput(me, now, wateredPlants, restartMarks); scene = buildScene(input); } catch { scene = null; }
    words = wordsFor(me, total, { parts: scene?.parts ?? [] }, now, room);
    const D = Math.floor(2 * (R - sw * 0.45)) + 2;
    if (input) garden = ensoGarden(stagesFor(input), { basket: !!me.basket && !me.basket.delivered }, D, PAPER, mode === "full");
  } catch {
    return shell([<SvgWidget key="c" svg={card(W, H, rx, cx, cy, R, sw, null)} style={{ width: W, height: H }} />]);
  }
  const D = Math.floor(2 * (R - sw * 0.45)) + 2;
  const layers = [
    garden ? (
      <FlexWidget key="g" style={{ width: W, height: H, paddingLeft: Math.round(cx - D / 2), paddingTop: Math.round(cy - D / 2) }}>
        <SvgWidget svg={garden} style={{ width: D, height: D }} />
      </FlexWidget>
    ) : null,
    <SvgWidget key="c" svg={card(W, H, rx, cx, cy, R, sw, words.fraction)} style={{ width: W, height: H }} />,
  ];
  if (mode === "full") {
    layers.push(
      <FlexWidget key="t" style={{ width: W, height: H, flexDirection: "column", justifyContent: "space-between", alignItems: "center", paddingTop: cy - R + R * 0.2, paddingBottom: H - cy - R + R * 0.16, paddingLeft: cx - R * 0.72, paddingRight: W - cx - R * 0.72 }}>
        <FlexWidget style={{ flexDirection: "column", alignItems: "center" }}>
          {text(words.title, BIG + 2, INK, true, "center")}
          {text(words.sub, LABEL_SIZE, QUIET, false, "center")}
        </FlexWidget>
        <FlexWidget style={{ flexDirection: "column", alignItems: "center" }}>
          {text(words.accent, LINE, ACCENT, true, "center")}
          {text(words.foot, LABEL_SIZE, QUIET, false, "center")}
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
