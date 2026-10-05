"use no memo";
import { FlexWidget, TextWidget, SvgWidget } from "react-native-android-widget";
import type { MeResponse } from "@/lib/api";
import { buildScene } from "@/model/garden";
import { widgetGardenHeight, widgetGardenSvg } from "@/model/widget-svg";
import { toGardenInput } from "@/lib/garden-input";
import { formatSkr, formatUsd } from "@/lib/format";
import { gardenTotals, lastPlantingLine } from "@/lib/me-state";
import type { PlantId } from "@/model/garden";

/** The home-screen widget, drawn from the last verified read (never a network call of its own): the whole garden's value, next planting, the garden. */
const PAD = 10;
const TEXT_H = 42;       // the pot line (16) and the next-planting line (12), with their leading
const WIDE_TEXT_H = 58;  // plus the last-planting line
const GAP = 6;           // between the text and the garden

export function SproutsWidget({ me, width, height, wide, wateredPlants = null }: { me: MeResponse | null; width: number; height: number; wide: boolean; wateredPlants?: PlantId[] | null }) {
  if (!me) {
    return (
      <FlexWidget clickAction="OPEN_APP" style={{ height: "match_parent", width: "match_parent", backgroundColor: "#F4EEDF", borderRadius: 16, padding: 12, justifyContent: "center" }}>
        <TextWidget text="Open Sprouts to sign in" style={{ fontSize: 14, color: "#2B2B2B" }} />
      </FlexWidget>
    );
  }
  const showLast = wide && me.lastReceipt !== null;
  const gardenW = width - 2 * PAD;
  const maxGardenH = Math.max(60, height - 2 * PAD - (showLast ? WIDE_TEXT_H : TEXT_H) - GAP);
  // R252: the garden is the app's (widget-svg.ts), as tall as its view at this width (sky above it, never more than the room), at the
  // bottom; the text at the top, in the paper the old layout left blank. A cached read missing a newer field falls back to the text.
  let garden: { svg: string; h: number } | null = null;
  try {
    const scene = buildScene(toGardenInput(me, new Date(), wateredPlants)), h = widgetGardenHeight(scene, gardenW, maxGardenH);
    garden = { svg: widgetGardenSvg(scene, gardenW, h), h };
  } catch { garden = null; }
  // R146, R252: the headline is the whole garden in dollars, as on Home; the SKR pot alone only when no SKR price is known
  const total = gardenTotals(me).valueUsd;
  return (
    <FlexWidget clickAction="OPEN_APP" style={{ height: "match_parent", width: "match_parent", backgroundColor: "#F4EEDF", borderRadius: 16, padding: PAD, flexDirection: "column", justifyContent: "space-between" }}>
      <FlexWidget style={{ width: "match_parent", flexDirection: "column" }}>
        <TextWidget text={total === null ? formatSkr(BigInt(me.pot.skrStakedRaw), me.pot.skrUsd) : `In your garden ${formatUsd(Math.round(total * 100))}`} style={{ fontSize: 16, color: "#2B2B2B", fontWeight: "600" }} />
        <TextWidget text={`Next planting ${formatUsd(me.nextPlanting.pendingCents)} of ${formatUsd(me.nextPlanting.thresholdCents)}`} style={{ fontSize: 12, color: "#6B6558" }} />
        {showLast && lastPlantingLine(me.lastReceipt) ? (
          <TextWidget text={lastPlantingLine(me.lastReceipt)!} style={{ fontSize: 12, color: "#6B6558" }} />
        ) : null}
      </FlexWidget>
      {garden !== null ? <SvgWidget svg={garden.svg} style={{ width: gardenW, height: garden.h }} /> : null}
    </FlexWidget>
  );
}
