import { useState, type ReactNode } from 'react'
import { View } from 'react-native'
import { SvgXml } from 'react-native-svg'
import { frameInner, widgetFrame } from '@/model/widget2-svg'

/**
 * 10-27 (his note: "the one thing that always stands out on dark mode is the garden. What if we try framing it with bamboo (like the
 * widget)? Dark mode only."): the widget's painted bamboo frame (widgetFrame, the same nine-slice art) round Home's garden card. The
 * garden sits in the frame's opening; the poles are drawn over its edges, touch-transparent. `width` is the frame's whole width, and
 * `children` gets the opening's width to lay the garden out at.
 */
export function BambooFrame({ width, children }: { width: number; children: (innerWidth: number) => ReactNode }) {
  const [height, setHeight] = useState<number | null>(null)
  // the poles' thickness depends on the frame's size (frameK); before the first layout it is measured on a square of the width
  const inner = frameInner(width, height ?? width)
  return (
    <View
      pointerEvents="box-none"
      onLayout={(e) => setHeight(Math.round(e.nativeEvent.layout.height))}
      style={{ width, paddingLeft: inner.l, paddingRight: inner.r, paddingTop: inner.t, paddingBottom: inner.b }}
    >
      {children(inner.w)}
      {height !== null ? (
        <View pointerEvents="none" style={{ position: 'absolute', left: 0, top: 0 }}>
          <SvgXml xml={widgetFrame(width, height, false)} width={width} height={height} />
        </View>
      ) : null}
    </View>
  )
}
