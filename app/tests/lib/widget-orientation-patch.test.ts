import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

// 11-27 (his device test): a background wake reported ORIENTATION_UNDEFINED and the library used the landscape pair (wide + short),
// so the widget drew as a one-row pill inside its full cell. The pnpm patch makes only LANDSCAPE mean landscape. Kimi scope 11-27.
const UTIL = 'node_modules/react-native-android-widget/android/src/main/java/com/reactnativeandroidwidget/RNWidgetUtil.java'
describe('widget size: the orientation patch stays applied', () => {
  it('is registered in pnpm-workspace.yaml', () => {
    expect(readFileSync('pnpm-workspace.yaml', 'utf8')).toContain('react-native-android-widget@0.22.1: patches/react-native-android-widget@0.22.1.patch')
  })
  it('the installed library treats every non-landscape orientation as portrait, for width and height', () => {
    const s = readFileSync(UTIL, 'utf8')
    expect(s.match(/orientation != android\.content\.res\.Configuration\.ORIENTATION_LANDSCAPE/g)).toHaveLength(2)
    expect(s).not.toContain('orientation == ORIENTATION_PORTRAIT')
  })
})
