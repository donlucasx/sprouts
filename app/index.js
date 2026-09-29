// index.js
import './polyfill'
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
