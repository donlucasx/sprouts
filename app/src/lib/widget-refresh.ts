import React from "react";
import { requestWidgetUpdate } from "react-native-android-widget";
import type { MeResponse } from "./api";
import { SproutsWidget } from "@/garden/Widget";
import { EnsoWidget } from "@/garden/EnsoWidget";
import { wateredPlantsFor } from "./last-watering";
import { readZeroMarks } from "./zero-marks";
import { sizeOrOneCell } from "@/garden/widget-layout";

/** The widget for one read at one size, the ONE way both paths draw it (this refresh and index.js's system task handler): the same
 * watered plants and R360 zero marks as Home, so its bud line never disagrees with Home's can. */
export function widgetFor(me: MeResponse | null, info: { width: number; height: number; widgetName?: string }) {
  // 10-26 draft: two providers (app.json): "Sprouts" is the bamboo frame, "SproutsEnso" the ensō
  // 10-27 (his notes: both 1x1s "still" showed the garden, the text cut off): a one-cell widget comes with NO size (Android leaves its
  // size options unset, so the library reads 0 x 0; the log showed it each time he resized to 1x1). No size is drawn as one cell, the
  // text-and-gauge versions; a real size replaces it on the next update.
  const { width, height } = sizeOrOneCell(info);
  return React.createElement(info.widgetName === "SproutsEnso" ? EnsoWidget : SproutsWidget, { me, width, height, wateredPlants: wateredPlantsFor(me?.user.wateredAt), restartMarks: readZeroMarks() });
}

/** Redraws every placed Sprouts widget from the read given; a home screen without the widget is not an error. */
export async function refreshWidget(me: MeResponse | null) {
  for (const widgetName of ["Sprouts", "SproutsEnso"])
    await requestWidgetUpdate({
      widgetName,
      renderWidget: (info) => widgetFor(me, { ...info, widgetName }),
      widgetNotFound: () => {},
    });
}
