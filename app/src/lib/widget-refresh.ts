import React from "react";
import { requestWidgetUpdate } from "react-native-android-widget";
import type { MeResponse } from "./api";
import { SproutsWidget } from "@/garden/Widget";
import { wateredPlantsFor } from "./last-watering";
import { readZeroMarks } from "./zero-marks";

/** The widget for one read at one size, the ONE way both paths draw it (this refresh and index.js's system task handler): the same
 * watered plants and R360 zero marks as Home, so its bud line never disagrees with Home's can. */
export function widgetFor(me: MeResponse | null, info: { width: number; height: number }) {
  return React.createElement(SproutsWidget, { me, width: info.width, height: info.height, wateredPlants: wateredPlantsFor(me?.user.wateredAt), restartMarks: readZeroMarks() });
}

/** Redraws every placed Sprouts widget from the read given; a home screen without the widget is not an error. */
export async function refreshWidget(me: MeResponse | null) {
  await requestWidgetUpdate({
    widgetName: "Sprouts",
    renderWidget: (info) => widgetFor(me, info),
    widgetNotFound: () => {},
  });
}
