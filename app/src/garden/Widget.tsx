"use no memo";
import { FlexWidget, TextWidget, SvgWidget } from "react-native-android-widget";
import type { MeResponse } from "@/lib/api";
import { buildScene } from "@/model/garden";
import { widgetGarden } from "@/model/widget-svg";
import { toGardenInput, type ZeroMarks } from "@/lib/garden-input";
import { gardenTotals, valueBlock } from "@/lib/me-state";
import { widgetStateLine, type WidgetState } from "@/lib/widget-state";
import { LABEL_SIZE, lineBox, widgetLayout, type Box } from "./widget-layout";
import type { PlantId, Scene } from "@/model/garden";

/** Brand colours (manual 4, light: the widget draws on paper whatever the phone's theme). */
const PAPER = "#F4EEDF", INK = "#2B2B2B", QUIET = "#6B6558", ACCENT = "#145A3C";
/** R363's tiny label under the total. */
export const WIDGET_LABEL = "your garden";

/**
 * The home-screen widget, drawn from the last verified read (never a network call of its own). R363 + R364 (10-05): laid out for the
 * square (the default 2x2): the whole garden's value big and alone at the top with "your garden" under it, the garden in the middle,
 * ONE state line at the bottom that invites a tap (widgetStateLine: Home's own state). Wide sizes keep the total at the left of the
 * garden; tall ones centre the garden in its box. The boxes come from widgetLayout; the whole widget opens the app.
 */
export function SproutsWidget({ me, width, height, wateredPlants = null, restartMarks = {}, now = new Date() }: { me: MeResponse | null; width: number; height: number; wateredPlants?: PlantId[] | null; restartMarks?: ZeroMarks; now?: Date }) {
  const notice = (text: string) => (
    <FlexWidget clickAction="OPEN_APP" style={{ height: "match_parent", width: "match_parent", backgroundColor: PAPER, borderRadius: 16, padding: 12, justifyContent: "center" }}>
      <TextWidget text={text} style={{ fontSize: 14, color: INK }} />
    </FlexWidget>
  );
  if (!me) return notice("Open Sprouts to sign in");
  // R146, R252: the total is Home's own number (valueBlock: the whole garden in dollars, the SKR pot when no SKR price is known).
  // A cached read too old for these fields says "open the app" rather than failing the whole render.
  let big: string, scene: Scene | null = null, state: WidgetState;
  try {
    big = valueBlock(gardenTotals(me), BigInt(me.pot.skrStakedRaw)).big;
    // a garden that cannot be built (a cached read missing a newer field) draws no garden, and so no bud line: Home rebuilds on open
    try { scene = buildScene(toGardenInput(me, now, wateredPlants, restartMarks)); } catch { scene = null; }
    state = widgetStateLine(me, scene ?? { parts: [], unrevealed: 0 }, now);
  } catch { return notice("Open Sprouts to see your garden"); }
  const L = widgetLayout(width, height, big, WIDGET_LABEL, state.text);
  let garden: { svg: string; h: number } | null = null;
  try { garden = scene ? widgetGarden(scene, L.garden.w, L.garden.h) : null; } catch { garden = null; }

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
  return (
    <FlexWidget clickAction="OPEN_APP" style={{ height: "match_parent", width: "match_parent", backgroundColor: PAPER, borderRadius: 16, padding: L.pad, flexDirection: "column", justifyContent: "space-between" }}>
      {top}
      {line}
    </FlexWidget>
  );
}
