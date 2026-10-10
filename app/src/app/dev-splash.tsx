import { useState } from 'react'
import { Pressable, View } from 'react-native'
import { Redirect } from 'expo-router'
import { Screen } from '@/components/Screen'
import { ThemedText } from '@/components/ThemedText'
import { GrowSplash } from '@/components/GrowSplash'
import { radius, spacing, useTheme } from '@/theme'

/** Dev builds only (R573/R574): the re-open loading screen's art in place, replayable, without restarting the app. */
export default function DevSplash() {
  const { colors } = useTheme()
  const [run, setRun] = useState(0)
  if (typeof __DEV__ === 'undefined' || !__DEV__) return <Redirect href="/" />
  return (
    <Screen back title="Loading screen">
      <Pressable onPress={() => setRun((n) => n + 1)} style={{ alignSelf: 'flex-start', paddingVertical: spacing.sm, paddingHorizontal: spacing.md, borderRadius: radius.full, backgroundColor: colors.surface }}>
        <ThemedText variant="label">Replay</ThemedText>
      </Pressable>
      <View style={{ paddingVertical: spacing.lg }}>
        <GrowSplash key={run} />
      </View>
    </Screen>
  )
}
