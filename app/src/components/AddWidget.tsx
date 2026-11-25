import { useEffect, useRef, useState } from 'react'
import { BackHandler, Image, Pressable, View } from 'react-native'
import { MaterialCommunityIcons } from '@expo/vector-icons'
import { getWidgetInfo, requestPinWidget } from 'react-native-android-widget'
import { radius, spacing, TARGET, useTheme } from '@/theme'
import { ThemedText } from './ThemedText'
import { t } from '@/i18n'
import { useLang } from '@/i18n/useLang'

/** The two widget providers (app.json): "Sprouts" stays the bamboo one, so a widget already placed keeps working. Labels are keys,
 *  read at render (0.1.13). */
export const WIDGETS = [
  { name: 'Sprouts', label: 'addWidget.bamboo', image: require('../../assets/widget-preview-bamboo.png') },
  { name: 'SproutsEnso', label: 'addWidget.enso', image: require('../../assets/widget-preview-enso.png') },
] as const
/** The launcher cannot pin: how to add it by hand (addWidget.fallback). 10-27 (his note: "nothing notes/shows that the widgets are
 *  resizable... while keeping descriptions short"): the resize hint (addWidget.resize). Two whole sentences, each its own key. */
/** How long the app watches for the new widget after the launcher's prompt: the person may take a while to tap Add. */
const WATCH_MS = 30_000, WATCH_STEP_MS = 1_000

/**
 * Shows the home screen. 10-27: BackHandler.exitApp() did nothing on the Seeker (the log showed the widget placed, the app stayed), so
 * the launcher is opened directly (expo-intent-launcher, native: from the next build). A build without the module falls back to back.
 */
function goHome() {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { startActivityAsync } = require('expo-intent-launcher') as typeof import('expo-intent-launcher')
    void startActivityAsync('android.intent.action.MAIN', { category: 'android.intent.category.HOME', flags: 0x10000000 }).catch(() => BackHandler.exitApp())
  } catch {
    BackHandler.exitApp()
  }
}

/** Resolves true once more `name` widgets are placed than `before`, false after WATCH_MS. */
async function placed(name: string, before: number, stale: () => boolean): Promise<boolean> {
  for (let t = 0; t < WATCH_MS; t += WATCH_STEP_MS) {
    await new Promise((r) => setTimeout(r, WATCH_STEP_MS))
    if (stale()) return false
    const n = (await getWidgetInfo(name).catch(() => [])).length
    if (n > before) return true
  }
  return false
}

/**
 * 10-26 (his: "add the row"): Settings' "Add a widget". Opens in place to the two styles; a tap asks the launcher's own "Add to home
 * screen" prompt. A launcher that cannot pin gets the one line that says how to add it by hand.
 */
export function AddWidget() {
  useLang()
  const { colors } = useTheme()
  const [open, setOpen] = useState(false)
  const [fallback, setFallback] = useState(false)
  // one watcher at a time: a second tap, or leaving Settings, ends the one before (review 10-27: two taps sent the app home twice)
  const watch = useRef(0)
  useEffect(() => () => void (watch.current = -1), [])
  async function pin(name: string) {
    const token = ++watch.current
    try {
      const before = (await getWidgetInfo(name).catch(() => [])).length
      const asked = await requestPinWidget({ widgetName: name })
      if (!asked) return setFallback(true)
      // 10-27 (his note: "after adding it to the home page nothing happens"): once the launcher has placed it, Sprouts steps back
      // to the home screen so the new widget is in view (Android's back on the root screen: the app stays open behind)
      const ok = await placed(name, before, () => watch.current !== token)
      if (ok) goHome()
    } catch {
      setFallback(true)
    }
  }
  return (
    <View style={{ borderTopWidth: 1, borderTopColor: colors.hairline, marginTop: spacing.sm }}>
      <Pressable
        onPress={() => setOpen((o) => !o)}
        accessibilityRole="button"
        accessibilityLabel={t('addWidget.row')}
        accessibilityState={{ expanded: open }}
        style={({ pressed }) => ({ minHeight: TARGET, flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.sm, opacity: pressed ? 0.7 : 1 })}
      >
        <ThemedText style={{ flex: 1 }}>{t('addWidget.row')}</ThemedText>
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
                accessibilityLabel={t('addWidget.add', { name: t(w.label) })}
                style={({ pressed }) => ({ flex: 1, alignItems: 'center', gap: spacing.xs, opacity: pressed ? 0.7 : 1 })}
              >
                <View style={{ width: '100%', aspectRatio: 1.05, borderRadius: radius.md, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', padding: spacing.sm }}>
                  <Image source={w.image} style={{ width: '100%', height: '100%' }} resizeMode="contain" />
                </View>
                <ThemedText variant="caption" tone="secondary">
                  {t(w.label)}
                </ThemedText>
              </Pressable>
            ))}
          </View>
          <ThemedText variant="caption" tone="secondary">
            {fallback ? `${t('addWidget.fallback')} ${t('addWidget.resize')}` : t('addWidget.resize')}
          </ThemedText>
        </View>
      ) : null}
    </View>
  )
}
