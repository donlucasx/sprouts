// index.js
import './polyfill'
// The background refresh must be defined here, at the entry: Android starts it headless (no UI, so no route and no _layout),
// and a task defined only behind _layout was dropped as "No task registered for key expo-task-manager" (09-29: no notification ever fired).
import './src/lib/background'
import 'expo-router/entry'
import { registerWidgetTaskHandler } from 'react-native-android-widget'
import { readLastMe } from './src/lib/me'
import { widgetFor } from './src/lib/widget-refresh'

// The widget renders from the last verified /api/me in storage (Review Focus 5): buds stay buds until the app is watered.
registerWidgetTaskHandler(async (props) => {
  // the same element as the in-app refresh (widgetFor): R360's zero marks included, so the widget never shows a bud Home does not
  props.renderWidget(widgetFor(readLastMe(), props.widgetInfo))
})
