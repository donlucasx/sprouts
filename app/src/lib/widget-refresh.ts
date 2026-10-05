import React from "react";
import { requestWidgetUpdate } from "react-native-android-widget";
import type { MeResponse } from "./api";
import { SproutsWidget } from "@/garden/Widget";
import { wateredPlantsFor } from "./last-watering";
import { DEMO_SHOT } from "./demo-shot";

/** Redraws every placed Sprouts widget from the read given; a home screen without the widget is not an error. */
export async function refreshWidget(me: MeResponse | null) {
  if (DEMO_SHOT) return; // the demo garden never reaches the home-screen widget
  await requestWidgetUpdate({
    widgetName: "Sprouts",
    renderWidget: (info) => React.createElement(SproutsWidget, { me, width: info.width, height: info.height, wide: info.width >= 300, wateredPlants: wateredPlantsFor(me?.user.wateredAt) }),
    widgetNotFound: () => {},
  });
}
