"use no memo";
import { FlexWidget, TextWidget, SvgWidget } from "react-native-android-widget";
import type { MeResponse } from "@/lib/api";
import { buildScene } from "@/model/garden";
import { widgetGardenHeight, widgetGardenSvg } from "@/model/widget-svg";
import { toGardenInput } from "@/lib/garden-input";
import { formatAmount, formatSkr, formatUsd } from "@/lib/format";

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
  const maxGardenH = Math.max(60, height - 2 * PAD - (showLast ? WIDE_TEXT_H : TEXT_H));
  // R167: the garden is as tall as its plants need (never smaller than the full height would draw them); the rest goes to the text
  let garden: { svg: string; h: number } | null = null;
  try {
    const scene = buildScene(toGardenInput(me, new Date())), h = widgetGardenHeight(scene, maxGardenH, wide);
    garden = { svg: widgetGardenSvg(scene, gardenW, h, wide), h };
  } catch { garden = null; }  // a cached read missing a newer field must not blank the widget: fall back to the text
  return (
    <FlexWidget clickAction="OPEN_APP" style={{ height: "match_parent", width: "match_parent", backgroundColor: "#F4EEDF", borderRadius: 16, padding: PAD, flexDirection: "column", justifyContent: "flex-end" }}>
      {garden !== null ? <SvgWidget svg={garden.svg} style={{ width: gardenW, height: garden.h }} /> : null}
      <FlexWidget style={{ flex: 1, width: "match_parent", flexDirection: "column", justifyContent: garden !== null ? "center" : "flex-end" }}>
      <TextWidget text={formatSkr(BigInt(me.pot.skrStakedRaw), me.pot.skrUsd)} style={{ fontSize: 16, color: "#2B2B2B", fontWeight: "600" }} />
      <TextWidget text={`Next planting ${formatUsd(me.nextPlanting.pendingCents)} of ${formatUsd(me.nextPlanting.thresholdCents)}`} style={{ fontSize: 12, color: "#6B6558" }} />
      {showLast && me.lastReceipt ? (
        <TextWidget text={`Last planting ${formatUsd(me.lastReceipt.usdcPulledCents)} pulled, ${formatAmount(me.lastReceipt.asset, BigInt(me.lastReceipt.amountOutRaw), me.lastReceipt.usdPrice)} planted`} style={{ fontSize: 12, color: "#6B6558" }} />
      ) : null}
      </FlexWidget>
    </FlexWidget>
  );
}
