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
import { widgetStateLine, type WidgetState } from "@/lib/widget-state";
import { LABEL_SIZE, lineBox, padFor, widgetLayout, type Box } from "./widget-layout";
import type { PlantId, Scene } from "@/model/garden";

/** Brand colours (manual 4, light: the widget draws on paper whatever the phone's theme; Garden2's paper sits inside its bamboo frame). */
const PAPER = "#F4EEDF", INK = "#2B2B2B", QUIET = "#6B6558", ACCENT = "#145A3C";
/** dp Garden2 keeps clear at the bottom: in portrait the library sizes the widget to its MAX height, a few dp taller than the cell on
 *  the Seeker, and the launcher draws it unscaled from the top (scaleType matrix), so the bottom line would be cut (seen 10-10). */
export const BOTTOM_SAFE = 10;
/** R363's tiny label under the total. */
export const WIDGET_LABEL = "your garden";

/**
 * The home-screen widget, drawn from the last verified read (never a network call of its own). R363 + R364 (10-05): laid out for the
 * square (the default 2x2): the whole garden's value big and alone at the top with "your garden" under it, the garden in the middle,
 * ONE state line at the bottom that invites a tap (widgetStateLine: Home's own state). Wide sizes keep the total at the left of the
 * garden; tall ones centre the garden in its box. The boxes come from widgetLayout; the whole widget opens the app.
 */
export function SproutsWidget({ me, width, height, wateredPlants = null, restartMarks = {}, now = new Date() }: { me: MeResponse | null; width: number; height: number; wateredPlants?: PlantId[] | null; restartMarks?: ZeroMarks; now?: Date }) {
  const H = GARDEN2 ? Math.max(1, height - BOTTOM_SAFE) : height;
  // Garden2 (his ask 10-10): a bamboo frame (widgetFrame) holds the paper, the content laid out in the frame's opening (frameInner)
  const inner = GARDEN2 ? frameInner(width, H) : null;
  const card = (pad: number, style: Record<string, unknown>, children: unknown) =>
    inner ? (
      <OverlapWidget clickAction="OPEN_APP" style={{ height: "match_parent", width: "match_parent" }}>
        <SvgWidget svg={widgetFrame(width, H)} style={{ width, height: H }} />
        <FlexWidget style={{ width, height: H, paddingLeft: inner.l, paddingTop: inner.t, paddingRight: inner.r, paddingBottom: inner.b }}>
          <FlexWidget style={{ width: inner.w, height: inner.h, padding: pad, ...style }}>{children}</FlexWidget>
        </FlexWidget>
      </OverlapWidget>
    ) : (
      <FlexWidget clickAction="OPEN_APP" style={{ height: "match_parent", width: "match_parent", backgroundColor: PAPER, borderRadius: 16, padding: pad, ...style }}>{children}</FlexWidget>
    );
  const notice = (text: string) => card(inner ? frameGap(width) : padFor(width), { justifyContent: "center" }, <TextWidget text={text} style={{ fontSize: 14, color: INK }} />);
  if (!me) return notice("Open Sprouts to sign in");
  // R146, R252: the total is Home's own number (valueBlock: the whole garden in dollars, the SKR pot when no SKR price is known).
  // A cached read too old for these fields says "open the app" rather than failing the whole render.
  let big: string, scene: Scene | null = null, input: ReturnType<typeof toGardenInput> | null = null, state: WidgetState;
  try {
    big = valueBlock(gardenTotals(me), BigInt(me.pot.skrStakedRaw)).big;
    // a garden that cannot be built (a cached read missing a newer field) draws no garden, and so no bud line: Home rebuilds on open
    try { input = toGardenInput(me, now, wateredPlants, restartMarks); scene = buildScene(input); } catch { scene = null; }
    // Garden2 has no buds to water (R458), so never the bud line: Home's own rule (home.tsx's watcher)
    state = widgetStateLine(me, scene && !GARDEN2 ? scene : { parts: scene?.parts ?? [], unrevealed: 0 }, now);
  } catch { return notice("Open Sprouts to see your garden"); }
  const L = inner ? widgetLayout(inner.w, inner.h, big, WIDGET_LABEL, state.text, frameGap(width)) : widgetLayout(width, height, big, WIDGET_LABEL, state.text);
  let garden: { svg: string; h: number } | null = null;
  // 10-10 (his ask: the widget shows the new garden): Garden2's painted layers as stills, Home's stages, stakes and basket
  try {
    garden = GARDEN2
      ? input ? widgetGarden2(stagesFor(input), { basket: !!me.basket && !me.basket.delivered, stakes: true }, L.garden.w, L.garden.h) : null
      : scene ? widgetGarden(scene, L.garden.w, L.garden.h) : null;
  } catch { garden = null; }

  const header = (
    <FlexWidget style={{ width: L.header.w, height: L.header.h, flexDirection: "column" }}>
      <TextWidget text={big} maxLines={1} truncate="END" style={{ fontSize: L.bigSize, color: INK, fontWeight: "700", height: lineBox(L.bigSize) }} />
      <TextWidget text={WIDGET_LABEL} maxLines={1} truncate="END" style={{ fontSize: LABEL_SIZE, color: QUIET, height: lineBox(LABEL_SIZE) }} />
    </FlexWidget>
  );
  // R253 / fix/widget-fit: the garden cropped to its plants (widgetGarden); centred in its box, so a tall widget's spare room is shared
  // above and below it, never one big blank band
  const gardenBox = (b: Box) => (
    <FlexWidget style={{ width: b.w, height: b.h, justifyContent: "center", alignItems: "center" }}>
      {garden !== null ? <SvgWidget svg={garden.svg} style={{ width: b.w, height: garden.h }} /> : null}
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
  return card(L.pad, { flexDirection: "column", justifyContent: "space-between" }, [top, line]);
}
