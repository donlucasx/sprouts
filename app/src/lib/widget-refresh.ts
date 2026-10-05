import React from "react";
import { requestWidgetUpdate } from "react-native-android-widget";
import type { MeResponse } from "./api";
import { SproutsWidget } from "@/garden/Widget";
import { wateredPlantsFor } from "./last-watering";
import { DEMO_SHOT } from "./demo-shot";
import { readZeroMarks } from "./zero-marks";

/** The widget for one read at one size, the ONE way both paths draw it (this refresh and index.js's system task handler): the same
 * watered plants and R360 zero marks as Home, so its bud line never disagrees with Home's can. */
export function widgetFor(me: MeResponse | null, info: { width: number; height: number }) {
  return React.createElement(SproutsWidget, { me, width: info.width, height: info.height, wateredPlants: wateredPlantsFor(me?.user.wateredAt), restartMarks: readZeroMarks() });
}

/** Redraws every placed Sprouts widget from the read given; a home screen without the widget is not an error. */
export async function refreshWidget(me: MeResponse | null) {
  if (DEMO_SHOT) return; // the demo garden never reaches the home-screen widget
  await requestWidgetUpdate({
    widgetName: "Sprouts",
    renderWidget: (info) => widgetFor(me, info),
    widgetNotFound: () => {},
  });
}

/** Dev only (demo/shot-420): the dev menu's "Demo: draw the widget" puts the demo garden on the placed widget for the store shot. The
 * real app's next read (or the widget's own 30-minute update from the saved real read) draws it back; nothing is saved. */
export async function drawDemoWidget(me: MeResponse | null) {
  if (!DEMO_SHOT) return;
  await requestWidgetUpdate({ widgetName: "Sprouts", renderWidget: (info) => widgetFor(me, info), widgetNotFound: () => {} });
}
