import { useState } from 'react'
import { Image, Pressable, View } from 'react-native'
import { MaterialCommunityIcons } from '@expo/vector-icons'
import { requestPinWidget } from 'react-native-android-widget'
import { radius, spacing, TARGET, useTheme } from '@/theme'
import { ThemedText } from './ThemedText'

/** The two widget providers (app.json): "Sprouts" stays the bamboo one, so a widget already placed keeps working. */
export const WIDGETS = [
  { name: 'Sprouts', label: 'Bamboo', image: require('../../assets/widget-preview-bamboo.png') },
  { name: 'SproutsEnso', label: 'Ensō', image: require('../../assets/widget-preview-enso.png') },
] as const
export const PIN_FALLBACK = 'Long-press your home screen, then tap Widgets.'

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
      if (!(await requestPinWidget({ widgetName: name }))) setFallback(true)
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
          {fallback ? (
            <ThemedText variant="caption" tone="secondary">
              {PIN_FALLBACK}
            </ThemedText>
          ) : null}
        </View>
      ) : null}
    </View>
  )
}
