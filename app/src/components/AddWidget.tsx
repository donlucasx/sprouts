import { useState } from 'react'
import { BackHandler, Image, Pressable, View } from 'react-native'
import { MaterialCommunityIcons } from '@expo/vector-icons'
import { getWidgetInfo, requestPinWidget } from 'react-native-android-widget'
import { radius, spacing, TARGET, useTheme } from '@/theme'
import { ThemedText } from './ThemedText'

/** The two widget providers (app.json): "Sprouts" stays the bamboo one, so a widget already placed keeps working. */
export const WIDGETS = [
  { name: 'Sprouts', label: 'Bamboo', image: require('../../assets/widget-preview-bamboo.png') },
  { name: 'SproutsEnso', label: 'Ensō', image: require('../../assets/widget-preview-enso.png') },
] as const
export const PIN_FALLBACK = 'Long-press your home screen, then tap Widgets.'
/** 10-27 (his note: "nothing notes/shows that the widgets are resizable... while keeping descriptions short"). */
export const RESIZE_HINT = 'Long-press a widget to resize it.'
/** How long the app watches for the new widget after the launcher's prompt: the person may take a while to tap Add. */
const WATCH_MS = 30_000, WATCH_STEP_MS = 1_000

// DRAFT: the add-widget flow's steps in the dev log (his note 10-27: the app did not step back after adding)
const log = (m: string) => { if (__DEV__) console.log(`[add-widget] ${m}`) }

/** Resolves true once more `name` widgets are placed than `before`, false after WATCH_MS. */
async function placed(name: string, before: number): Promise<boolean> {
  for (let t = 0; t < WATCH_MS; t += WATCH_STEP_MS) {
    await new Promise((r) => setTimeout(r, WATCH_STEP_MS))
    const n = (await getWidgetInfo(name).catch(() => [])).length
    if (t % 5_000 === 0) log(`watch ${name}: ${n} placed`)
    if (n > before) return true
  }
  return false
}

/**
 * 10-26 (his: "add the row"): Settings' "Add a widget". Opens in place to the two styles; a tap asks the launcher's own "Add to home
 * screen" prompt. A launcher that cannot pin gets the one line that says how to add it by hand.
 */
export function AddWidget() {
  const { colors } = useTheme()
  const [open, setOpen] = useState(false)
  const [fallback, setFallback] = useState(false)
  async function pin(name: string) {
    try {
      const before = (await getWidgetInfo(name).catch((e) => (log(`info failed ${String(e)}`), []))).length
      const asked = await requestPinWidget({ widgetName: name })
      log(`pin ${name}: asked=${asked} before=${before}`)
      if (!asked) return setFallback(true)
      // 10-27 (his note: "after adding it to the home page nothing happens"): once the launcher has placed it, Sprouts steps back
      // to the home screen so the new widget is in view (Android's back on the root screen: the app stays open behind)
      const ok = await placed(name, before)
      log(`pin ${name}: placed=${ok}`)
      if (ok) BackHandler.exitApp()
    } catch {
      setFallback(true)
    }
  }
  return (
    <View style={{ borderTopWidth: 1, borderTopColor: colors.hairline, marginTop: spacing.sm }}>
      <Pressable
        onPress={() => setOpen((o) => !o)}
        accessibilityRole="button"
        accessibilityLabel="Add a widget"
        accessibilityState={{ expanded: open }}
        style={({ pressed }) => ({ minHeight: TARGET, flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.sm, opacity: pressed ? 0.7 : 1 })}
      >
        <ThemedText style={{ flex: 1 }}>Add a widget</ThemedText>
        <MaterialCommunityIcons name={open ? 'chevron-up' : 'chevron-down'} size={22} color={colors.accentText} />
      </Pressable>
      {open ? (
        <View style={{ gap: spacing.sm, paddingBottom: spacing.md }}>
          <View style={{ flexDirection: 'row', gap: spacing.md }}>
            {WIDGETS.map((w) => (
              <Pressable
                key={w.name}
                onPress={() => void pin(w.name)}
                accessibilityRole="button"
                accessibilityLabel={`Add the ${w.label} widget`}
                style={({ pressed }) => ({ flex: 1, alignItems: 'center', gap: spacing.xs, opacity: pressed ? 0.7 : 1 })}
              >
                <View style={{ width: '100%', aspectRatio: 1.05, borderRadius: radius.md, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', padding: spacing.sm }}>
                  <Image source={w.image} style={{ width: '100%', height: '100%' }} resizeMode="contain" />
                </View>
                <ThemedText variant="caption" tone="secondary">
                  {w.label}
                </ThemedText>
              </Pressable>
            ))}
          </View>
          <ThemedText variant="caption" tone="secondary">
            {fallback ? `${PIN_FALLBACK} ${RESIZE_HINT}` : RESIZE_HINT}
          </ThemedText>
        </View>
      ) : null}
    </View>
  )
}
