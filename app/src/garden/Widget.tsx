"use no memo";
import { FlexWidget, OverlapWidget, TextWidget, SvgWidget } from "react-native-android-widget";
import type { MeResponse } from "@/lib/api";
import { buildScene } from "@/model/garden";
import { widgetGarden } from "@/model/widget-svg";
import { frameGap, frameInner, widgetFrame, widgetGarden2 } from "@/model/widget2-svg";
import { stagesFor } from "@/model/garden2";
import { GARDEN2 } from "@/garden2/flag";
import { toGardenInput, type ZeroMarks } from "@/lib/garden-input";
import { gardenTotals, valueBlock } from "@/lib/me-state";
import { formatUsd } from "@/lib/format";
import { widgetHeadline, widgetStateLine, type WidgetState } from "@/lib/widget-state";
import { BAR_GAP, BAR_H, G2_BIG, G2_BIG_MIN, LABEL_SIZE, lineBox, isSlim, padFor, STATE_MIN, textWidth, widgetLayout, type Box } from "./widget-layout";
import type { PlantId, Scene } from "@/model/garden";

/** Brand colours (manual 4, light: the widget draws on paper whatever the phone's theme; Garden2's paper sits inside its bamboo frame). */
const PAPER = "#F4EEDF", INK = "#2B2B2B", QUIET = "#6B6558", ACCENT = "#145A3C";
/** dp of garden the bar must leave, or it is dropped. */
const MIN_GARDEN_H = 16;
/** A frame opening shorter than this (the 2x1's ~89 dp) keeps no bottom line (10-27). */
const SHORT_OPENING = 100;
/** The next-planting bar's empty track (10-11): a soft ink on the painting's paper sky. */
const TRACK = "#E4DCC8";
/** dp Garden2 keeps clear at the bottom: in portrait the library sizes the widget to its MAX height, a few dp taller than the cell on
 *  the Seeker, and the launcher draws it unscaled from the top (scaleType matrix), so the bottom line would be cut (seen 10-10). */
export const BOTTOM_SAFE = 10;
/** dp of clear wallpaper kept around the bamboo frame on every side (his note 10-11: "a tad slimmer within it so theres more transparency
 *  around"); half on a widget under 140 dp. */
export const FRAME_INSET = 8;
export const frameInset = (width: number) => (width < 140 ? FRAME_INSET / 2 : FRAME_INSET);
/** Narrower than this (one column, the 1x1 and 1xN): words and the bar only, no art (10-27). */
export const TINY_W = 140;
/** The slim frame's height: 64 cut the bottom line once the empty bar showed too (10-27); the ensō pill is 72. */
const SLIM_FRAME_H = 74;
/** R363's tiny label under the total. */
export const WIDGET_LABEL = "your garden";

/**
 * The home-screen widget, drawn from the last verified read (never a network call of its own). R363 + R364 (10-05): laid out for the
 * square (the default 2x2): the whole garden's value big and alone at the top with "your garden" under it, the garden in the middle,
 * ONE state line at the bottom that invites a tap (widgetStateLine: Home's own state). Wide sizes keep the total at the left of the
 * garden; tall ones centre the garden in its box. The boxes come from widgetLayout; the whole widget opens the app.
 * Garden2 (10-10, 10-11): a painted bamboo frame; the painting fills its opening (widgetGarden2); one small headline reports the next
 * planting or the garden (widgetHeadline: never a call to swap, never "$0.00"), Home's bar while saving, the other fact at the bottom.
 */
export function SproutsWidget({ me, width, height, wateredPlants = null, restartMarks = {}, now = new Date() }: { me: MeResponse | null; width: number; height: number; wateredPlants?: PlantId[] | null; restartMarks?: ZeroMarks; now?: Date }) {
  const H = GARDEN2 ? Math.max(1, height - BOTTOM_SAFE) : height;
  // Garden2 (his ask 10-10): a bamboo frame (widgetFrame) holds the paper, the content laid out in the frame's opening (frameInner)
  // the frame itself, FRAME_INSET in from the widget's edges, the wallpaper showing around it
  // 10-26 draft (his ruling 10-23: the 4x1 "slimmer like the pill"; 10-26: no garden art in it): a widget at least 3x as wide as it is
  // tall draws a slim frame, words and the bar only, centred in its row
  const slim = GARDEN2 && isSlim(width, height);
  const inset = frameInset(width), FW = Math.max(1, width - 2 * inset), FH = Math.max(1, slim ? Math.min(H - 2 * inset, SLIM_FRAME_H) : H - 2 * inset);
  const padTop = slim ? Math.max(inset, (H - FH) / 2) : inset;
  const inner = GARDEN2 ? frameInner(FW, FH) : null;
  // 10-11: the painting (`bg`, widgetGarden2) fills the frame's whole opening behind the text
  const card = (pad: number, style: Record<string, unknown>, children: unknown, bg: string | null = null) =>
    inner ? (
      <FlexWidget clickAction="OPEN_APP" style={{ height: "match_parent", width: "match_parent", paddingLeft: inset, paddingRight: inset, paddingTop: padTop }}>
        <OverlapWidget style={{ width: FW, height: FH }}>
          <SvgWidget svg={widgetFrame(FW, FH)} style={{ width: FW, height: FH }} />
          <FlexWidget style={{ width: FW, height: FH, paddingLeft: inner.l, paddingTop: inner.t, paddingRight: inner.r, paddingBottom: inner.b }}>
            <OverlapWidget style={{ width: inner.w, height: inner.h }}>
              {bg !== null ? <SvgWidget svg={bg} style={{ width: inner.w, height: inner.h }} /> : null}
              <FlexWidget style={{ width: inner.w, height: inner.h, padding: pad, ...style }}>{children}</FlexWidget>
            </OverlapWidget>
          </FlexWidget>
        </OverlapWidget>
      </FlexWidget>
    ) : (
      <FlexWidget clickAction="OPEN_APP" style={{ height: "match_parent", width: "match_parent", backgroundColor: PAPER, borderRadius: 16, padding: pad, ...style }}>{children}</FlexWidget>
    );
  const notice = (text: string) => card(inner ? frameGap(width) : padFor(width), { justifyContent: "center" }, <TextWidget text={text} style={{ fontSize: 14, color: INK }} />);
  if (!me) return notice("Open Sprouts to sign in");
  // R146, R252: the total is Home's own number (valueBlock: the whole garden in dollars, the SKR pot when no SKR price is known).
  // A cached read too old for these fields says "open the app" rather than failing the whole render.
  let labelAction = false;
  let big: string, label = WIDGET_LABEL, fraction: number | null = null, scene: Scene | null = null, input: ReturnType<typeof toGardenInput> | null = null, state: WidgetState;
  try {
    big = valueBlock(gardenTotals(me), BigInt(me.pot.skrStakedRaw)).big;
    // a garden that cannot be built (a cached read missing a newer field) draws no garden, and so no bud line: Home rebuilds on open
    try { input = toGardenInput(me, now, wateredPlants, restartMarks); scene = buildScene(input); } catch { scene = null; }
    // Garden2 has no buds to water (R458), so never the bud line: Home's own rule (home.tsx's watcher)
    state = widgetStateLine(me, scene && !GARDEN2 ? scene : { parts: scene?.parts ?? [], unrevealed: 0 }, now);
    // Garden2 (his note 10-11): the next planting leads, with its bar; the garden's total moves to the bottom line
    if (GARDEN2) {
      const room = inner!.w - 2 * frameGap(width);
      const total = big, hasMoney = total !== formatUsd(0);
      const head = widgetHeadline(me, { parts: scene?.parts ?? [] }, now, total, hasMoney, {
        big: (t) => textWidth(t, G2_BIG_MIN, true) <= room, label: (t) => textWidth(t, LABEL_SIZE, true) <= room, line: (t) => textWidth(t, STATE_MIN, true) <= room,
      });
      state = { text: head.line, action: false };
      big = head.big; label = head.label; fraction = head.fraction;
      labelAction = head.action;
    }
  } catch { return notice("Open Sprouts to see your garden"); }
  // 10-27 (his note: "the 1x1 should have no art and feature the planting gauge instead"): one column wide, the words and the bar
  const tiny = !!inner && !slim && width < TINY_W;
  if (tiny && inner) {
    const w = inner.w - 2 * frameGap(width), fillW = fraction === null ? 0 : Math.round(w * Math.min(1, Math.max(0, fraction)));
    return card(frameGap(width), { flexDirection: "column", justifyContent: "center" }, [
      <TextWidget key="b" text={big} maxLines={1} truncate="END" style={{ fontSize: G2_BIG_MIN, color: INK, fontWeight: "700" }} />,
      <TextWidget key="l" text={label} maxLines={2} truncate="END" style={{ fontSize: LABEL_SIZE - 1, color: labelAction ? ACCENT : QUIET, fontWeight: labelAction ? "600" : "normal" }} />,
      fraction === null ? null : (
        <FlexWidget key="bar" style={{ width: w, height: BAR_H, marginTop: 6, flexDirection: "row", backgroundColor: TRACK, borderRadius: BAR_H / 2 }}>
          {fillW > 0 ? <FlexWidget style={{ width: fillW, height: BAR_H, backgroundColor: ACCENT, borderRadius: BAR_H / 2 }} /> : null}
        </FlexWidget>
      ),
    ].filter(Boolean));
  }
  if (slim && inner) {
    const w = inner.w - 2 * frameGap(width), fillW = fraction === null ? 0 : Math.round(w * Math.min(1, Math.max(0, fraction)));
    const words = labelAction
      ? [<TextWidget key="b" text={big} maxLines={1} truncate="END" style={{ fontSize: G2_BIG, color: INK, fontWeight: "700" }} />,
         <TextWidget key="l" text={label} maxLines={1} truncate="END" style={{ fontSize: LABEL_SIZE, color: ACCENT, fontWeight: "600" }} />]
      : [<FlexWidget key="r" style={{ flexDirection: "row", alignItems: "flex-end" }}>
           <TextWidget text={big} maxLines={1} style={{ fontSize: G2_BIG, color: INK, fontWeight: "700" }} />
           <TextWidget text={`  ${label}`} maxLines={1} truncate="END" style={{ fontSize: LABEL_SIZE, color: QUIET }} />
         </FlexWidget>];
    const slimBar = fraction === null ? null : (
      <FlexWidget key="bar" style={{ width: w, height: BAR_H, marginTop: 3, marginBottom: 3, flexDirection: "row", backgroundColor: TRACK, borderRadius: BAR_H / 2 }}>
        {fillW > 0 ? <FlexWidget style={{ width: fillW, height: BAR_H, backgroundColor: ACCENT, borderRadius: BAR_H / 2 }} /> : null}
      </FlexWidget>
    );
    return card(frameGap(width), { flexDirection: "column", justifyContent: "center" }, [...words, slimBar, <TextWidget key="t" text={state.text} maxLines={1} truncate="END" style={{ fontSize: LABEL_SIZE, color: QUIET }} />]);
  }
  // 10-27 (his note: the 2x1 "art too small, should be cropped in on the tree"): an opening under SHORT_OPENING dp drops the bottom
  // line, so the garden (framed on the tree, widget2View) takes its room
  const short = !!inner && inner.h < SHORT_OPENING;
  if (short) state = { text: "", action: false };
  let L = inner ? widgetLayout(inner.w, inner.h, big, label, state.text, frameGap(width), fraction !== null, G2_BIG, G2_BIG_MIN) : widgetLayout(width, height, big, label, state.text);
  if (short) L = { ...L, garden: { ...L.garden, h: L.garden.h + L.state.h + 4 }, state: { ...L.state, h: 0 } };
  // a widget too short for the bar and a garden (110 dp tall) keeps the garden and drops the bar
  if (inner && fraction !== null && L.garden.h < MIN_GARDEN_H) { fraction = null; L = widgetLayout(inner.w, inner.h, big, label, state.text, frameGap(width), false, G2_BIG, G2_BIG_MIN); }
  let garden: { svg: string; w?: number; h: number } | null = null, painting: string | null = null;
  // 10-10 (his ask: the widget shows the new garden): Garden2's painted layers as stills, Home's stages, stakes and basket, filling the
  // frame's opening behind the text (10-11); the old garden draws in its box
  try {
    if (GARDEN2) painting = input ? widgetGarden2(stagesFor(input), { basket: !!me.basket && !me.basket.delivered, stakes: true }, inner!.w, inner!.h, L.garden).svg : null;
    else garden = scene ? widgetGarden(scene, L.garden.w, L.garden.h) : null;
  } catch { garden = null; painting = null; }
  // the bar: Home's fraction toward the next planting, a track with its fill
  const fill = fraction === null ? 0 : Math.round(L.header.w * Math.min(1, Math.max(0, fraction)));
  const bar = fraction === null ? null : (
    <FlexWidget style={{ width: L.header.w, height: BAR_GAP + BAR_H, flexDirection: "column", justifyContent: "flex-end" }}>
      <FlexWidget style={{ width: L.header.w, height: BAR_H, flexDirection: "row", backgroundColor: TRACK, borderRadius: BAR_H / 2 }}>
        {fill > 0 ? <FlexWidget style={{ width: fill, height: BAR_H, backgroundColor: ACCENT, borderRadius: BAR_H / 2 }} /> : null}
      </FlexWidget>
    </FlexWidget>
  );

  const header = (
    <FlexWidget style={{ width: L.header.w, height: L.header.h, flexDirection: "column" }}>
      <TextWidget text={big} maxLines={1} truncate="END" style={{ fontSize: L.bigSize, color: INK, fontWeight: "700", height: lineBox(L.bigSize) }} />
      <TextWidget text={label} maxLines={1} truncate="END" style={{ fontSize: LABEL_SIZE, color: labelAction ? ACCENT : QUIET, fontWeight: labelAction ? "600" : "normal", height: lineBox(LABEL_SIZE) }} />
      {bar}
    </FlexWidget>
  );
  // R253 / fix/widget-fit: the garden cropped to its plants (widgetGarden); centred in its box, so a tall widget's spare room is shared
  // above and below it, never one big blank band
  const gardenBox = (b: Box) => (
    <FlexWidget style={{ width: b.w, height: b.h, justifyContent: "center", alignItems: "center" }}>
      {garden !== null ? <SvgWidget svg={garden.svg} style={{ width: garden.w ?? b.w, height: garden.h }} /> : null}
    </FlexWidget>
  );
  const line = (
    <TextWidget text={state.text} maxLines={L.stateLines} truncate="END" style={{ fontSize: L.stateSize, color: state.action ? ACCENT : QUIET, fontWeight: state.action ? "600" : "normal", height: L.state.h }} />
  );
  const top = L.mode === "wide"
    ? (
      <FlexWidget style={{ width: "match_parent", height: L.garden.h, flexDirection: "row" }}>
        {header}
        <FlexWidget style={{ width: L.garden.x - L.header.x - L.header.w, height: L.garden.h }} />
        {gardenBox(L.garden)}
      </FlexWidget>
    )
    : (
      <FlexWidget style={{ width: "match_parent", height: L.garden.y + L.garden.h - L.pad, flexDirection: "column" }}>
        {header}
        <FlexWidget style={{ width: "match_parent", height: L.garden.y - L.header.y - L.header.h }} />
        {gardenBox(L.garden)}
      </FlexWidget>
    );
  return card(L.pad, { flexDirection: "column", justifyContent: "space-between" }, short ? [top] : [top, line], painting);
}
