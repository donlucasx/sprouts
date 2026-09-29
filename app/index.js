// index.js
import './polyfill'
// The background refresh must be defined here, at the entry: Android starts it headless (no UI, so no route and no _layout),
// and a task defined only behind _layout was dropped as "No task registered for key expo-task-manager" (09-29: no notification ever fired).
import './src/lib/background'
import 'expo-router/entry'
import React from 'react'
import { registerWidgetTaskHandler } from 'react-native-android-widget'
import { SproutsWidget } from './src/garden/Widget'
import { readLastMe } from './src/lib/me'

// The widget renders from the last verified /api/me in storage (Review Focus 5): buds stay buds until the app is watered.
registerWidgetTaskHandler(async (props) => {
  const me = readLastMe()
  const wide = props.widgetInfo.width >= 300
  props.renderWidget(React.createElement(SproutsWidget, { me, width: props.widgetInfo.width, height: props.widgetInfo.height, wide }))
})
