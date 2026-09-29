"use no memo";
import { FlexWidget, TextWidget, SvgWidget } from "react-native-android-widget";
import type { MeResponse } from "@/lib/api";
import { buildScene } from "@/model/garden";
import { toGardenInput } from "@/lib/garden-input";
import { formatSkr, formatUsd } from "@/lib/format";

/** The garden as an SVG string for the widget: soil, one stroke per sprout (buds as dots), one circle per fruit. Same model, fewer pixels. */
function gardenSvg(me: MeResponse, width: number): string {
  const scene = buildScene(toGardenInput(me, new Date()));
  const soilY = 70;
  const sprouts = scene.parts.filter((p) => p.kind === "sprout") as { x: number; stage: number; bud: boolean }[];
  const fruit = scene.parts.filter((p) => p.kind === "fruit").length;
  const stems = sprouts.map((s) => s.bud
    ? `<circle cx="${(s.x * width).toFixed(0)}" cy="${soilY - 4}" r="3" fill="#3F7A4A" opacity="0.6"/>`
    : `<path d="M${(s.x * width).toFixed(0)} ${soilY} q 2 ${-(10 + s.stage * 12) / 2} 0 ${-(10 + s.stage * 12)}" stroke="#3F7A4A" stroke-width="2" fill="none"/>`).join("");
  const fruits = Array.from({ length: fruit }, (_, i) => `<circle cx="${(width * (0.2 + (i % 6) * 0.12)).toFixed(0)}" cy="${soilY - 30 - Math.floor(i / 6) * 12}" r="3" fill="#C9553D"/>`).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="90" viewBox="0 0 ${width} 90"><path d="M0 ${soilY} Q ${width / 2} ${soilY - 24} ${width} ${soilY} L ${width} 90 L 0 90 Z" fill="#B08A4B" opacity="0.9"/>${stems}${fruits}</svg>`;
}

/** The home-screen widget, drawn from the last verified read (never a network call of its own): the garden, the pot, next planting. */
export function SproutsWidget({ me, width, wide }: { me: MeResponse | null; width: number; wide: boolean }) {
  if (!me) {
    return (
      <FlexWidget clickAction="OPEN_APP" style={{ height: "match_parent", width: "match_parent", backgroundColor: "#F4EEDF", borderRadius: 16, padding: 12, justifyContent: "center" }}>
        <TextWidget text="Open Sprouts to sign in" style={{ fontSize: 14, color: "#2B2B2B" }} />
      </FlexWidget>
    );
  }
  return (
    <FlexWidget clickAction="OPEN_APP" style={{ height: "match_parent", width: "match_parent", backgroundColor: "#F4EEDF", borderRadius: 16, padding: 10, flexDirection: "column" }}>
      <SvgWidget svg={gardenSvg(me, width - 20)} style={{ width: width - 20, height: 90 }} />
      <TextWidget text={formatSkr(BigInt(me.pot.skrStakedRaw), me.pot.skrUsd)} style={{ fontSize: 16, color: "#2B2B2B", fontWeight: "600" }} />
      <TextWidget text={`Next planting ${formatUsd(me.nextPlanting.pendingCents)} of ${formatUsd(me.nextPlanting.thresholdCents)}`} style={{ fontSize: 12, color: "#6B6558" }} />
      {wide && me.lastReceipt ? (
        <TextWidget text={`Last planting ${formatUsd(me.lastReceipt.usdcPulledCents)} pulled, ${formatSkr(BigInt(me.lastReceipt.amountOutRaw), me.pot.skrUsd)} planted`} style={{ fontSize: 12, color: "#6B6558" }} />
      ) : null}
    </FlexWidget>
  );
}
