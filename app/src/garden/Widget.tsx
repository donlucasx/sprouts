"use no memo";
import { FlexWidget, TextWidget, SvgWidget } from "react-native-android-widget";
import type { MeResponse } from "@/lib/api";
import { buildScene } from "@/model/garden";
import { widgetGardenSvg } from "@/model/widget-svg";
import { toGardenInput } from "@/lib/garden-input";
import { formatSkr, formatUsd } from "@/lib/format";

/** The home-screen widget, drawn from the last verified read (never a network call of its own): the garden, the pot, next planting. */
const PAD = 10;
const TEXT_H = 42;       // the pot line (16) and the next-planting line (12), with their leading
const WIDE_TEXT_H = 58;  // plus the last-planting line

export function SproutsWidget({ me, width, height, wide }: { me: MeResponse | null; width: number; height: number; wide: boolean }) {
  if (!me) {
    return (
      <FlexWidget clickAction="OPEN_APP" style={{ height: "match_parent", width: "match_parent", backgroundColor: "#F4EEDF", borderRadius: 16, padding: 12, justifyContent: "center" }}>
        <TextWidget text="Open Sprouts to sign in" style={{ fontSize: 14, color: "#2B2B2B" }} />
      </FlexWidget>
    );
  }
  const showLast = wide && me.lastReceipt !== null;
  const gardenW = width - 2 * PAD;
  const gardenH = Math.max(60, height - 2 * PAD - (showLast ? WIDE_TEXT_H : TEXT_H));
  const scene = buildScene(toGardenInput(me, new Date()));
  return (
    <FlexWidget clickAction="OPEN_APP" style={{ height: "match_parent", width: "match_parent", backgroundColor: "#F4EEDF", borderRadius: 16, padding: PAD, flexDirection: "column", justifyContent: "flex-end" }}>
      <SvgWidget svg={widgetGardenSvg(scene, gardenW, gardenH)} style={{ width: gardenW, height: gardenH }} />
      <TextWidget text={formatSkr(BigInt(me.pot.skrStakedRaw), me.pot.skrUsd)} style={{ fontSize: 16, color: "#2B2B2B", fontWeight: "600" }} />
      <TextWidget text={`Next planting ${formatUsd(me.nextPlanting.pendingCents)} of ${formatUsd(me.nextPlanting.thresholdCents)}`} style={{ fontSize: 12, color: "#6B6558" }} />
      {showLast && me.lastReceipt ? (
        <TextWidget text={`Last planting ${formatUsd(me.lastReceipt.usdcPulledCents)} pulled, ${formatSkr(BigInt(me.lastReceipt.amountOutRaw), me.pot.skrUsd)} planted`} style={{ fontSize: 12, color: "#6B6558" }} />
      ) : null}
    </FlexWidget>
  );
}
