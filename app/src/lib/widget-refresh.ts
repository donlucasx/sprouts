import React from "react";
import { requestWidgetUpdate } from "react-native-android-widget";
import type { MeResponse } from "./api";
import { SproutsWidget } from "@/garden/Widget";
import { wateredPlantsFor } from "./last-watering";
import { readZeroMarks } from "./zero-marks";

/** Redraws every placed Sprouts widget from the read given; a home screen without the widget is not an error. */
export async function refreshWidget(me: MeResponse | null) {
  await requestWidgetUpdate({
    widgetName: "Sprouts",
    renderWidget: (info) => React.createElement(SproutsWidget, { me, width: info.width, height: info.height, wateredPlants: wateredPlantsFor(me?.user.wateredAt), restartMarks: readZeroMarks() }),
    widgetNotFound: () => {},
  });
}
