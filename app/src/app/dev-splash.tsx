import { useState } from 'react'
import { Pressable, View } from 'react-native'
import { Redirect, router } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { ThemedText } from '@/components/ThemedText'
import { GrowSplash } from '@/components/GrowSplash'
import { LightOnly, palette, radius, spacing } from '@/theme'

/** Dev builds only (R573-R578): the re-open loading screen full screen, exactly as on launch, replayable; Back and Replay at the top. */
export default function DevSplash() {
  const insets = useSafeAreaInsets()
  const [run, setRun] = useState(0)
  if (typeof __DEV__ === 'undefined' || !__DEV__) return <Redirect href="/" />
  const chip = (t: string, on: () => void) => (
    <Pressable onPress={on} style={{ paddingVertical: spacing.xs, paddingHorizontal: spacing.md, borderRadius: radius.full, backgroundColor: palette.light.surface }}>
      <ThemedText variant="caption">{t}</ThemedText>
    </Pressable>
  )
  return (
    <LightOnly.Provider value>
    <View style={{ flex: 1, backgroundColor: palette.light.background, paddingHorizontal: spacing.edge }}>
      <GrowSplash key={run} />
      <View style={{ position: 'absolute', top: insets.top + spacing.sm, left: spacing.edge, flexDirection: 'row', gap: spacing.sm }}>
        {chip('Back', () => router.back())}
        {chip('Replay', () => setRun((n) => n + 1))}
      </View>
    </View>
    </LightOnly.Provider>
  )
}
