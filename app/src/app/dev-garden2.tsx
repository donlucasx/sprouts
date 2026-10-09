import { useState } from 'react'
import { Pressable, View, useWindowDimensions } from 'react-native'
import { Redirect } from 'expo-router'
import { Screen } from '@/components/Screen'
import { ThemedText } from '@/components/ThemedText'
import { StepButtons } from '@/components/Stepper'
import { Garden2 } from '@/garden2/Garden2'
import { DRAW_ORDER, PLANTS } from '@/garden2/layout'
import { ASSET_OF_PLANT, allStages, clampStage, LADDER, type Plant2, type Stages } from '@/model/garden2'
import { radius, spacing, useTheme } from '@/theme'

/**
 * Dev builds only: Garden2 with every plant's stage forced by hand, so each of the 88 layers can be eyeballed on a device (open
 * sprouts://dev-garden2, or router.push('/dev-garden2')). Release builds redirect. Tapping a plant shows its stage as the label.
 */
export default function DevGarden2() {
  const { width } = useWindowDimensions()
  const { colors, dark } = useTheme()
  const [stages, setStages] = useState<Stages>(allStages(0))
  if (typeof __DEV__ === 'undefined' || !__DEV__) return <Redirect href="/" />
  const set = (p: Plant2, s: number) => setStages((old) => ({ ...old, [p]: clampStage(p, s) }))
  const all = (s: number) => setStages(Object.fromEntries(DRAW_ORDER.map((p) => [p, clampStage(p, s)])) as Stages)
  const chip = (title: string, onPress: () => void) => (
    <Pressable
      key={title}
      onPress={onPress}
      style={{
        paddingVertical: spacing.sm,
        paddingHorizontal: spacing.md,
        borderRadius: radius.full,
        backgroundColor: colors.surface,
      }}
    >
      <ThemedText variant="label">{title}</ThemedText>
    </Pressable>
  )
  return (
    <Screen back title="Garden2 stages">
      <View style={{ marginHorizontal: dark ? 0 : -spacing.edge }}>
        <Garden2
          stages={stages}
          width={dark ? width - 2 * spacing.edge : width}
          labelFor={(p) => [`${p} (${ASSET_OF_PLANT[p]})`, `Stage ${stages[p]} of ${PLANTS[p].last}`]}
        />
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
        {chip('All 0', () => all(0))}
        {chip('All 1', () => all(1))}
        {chip('All 7', () => all(7))}
        {chip('All 14', () => all(14))}
        {chip('All +1', () =>
          setStages((old) => Object.fromEntries(DRAW_ORDER.map((p) => [p, clampStage(p, old[p] + 1)])) as Stages),
        )}
      </View>
      {DRAW_ORDER.map((p) => (
        <View key={p} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
          <ThemedText
            style={{ flex: 1 }}
          >{`${p} · ${ASSET_OF_PLANT[p]} · stage ${stages[p]}${stages[p] === 0 && PLANTS[p].first > 0 ? ' (none)' : ''}`}</ThemedText>
          <StepButtons
            what={p}
            onLess={() => set(p, stages[p] - 1)}
            onMore={() => set(p, stages[p] + 1)}
            lessDisabled={stages[p] <= 0}
            moreDisabled={stages[p] >= PLANTS[p].last}
          />
        </View>
      ))}
      <ThemedText
        variant="caption"
        tone="secondary"
      >{`Ladder (R484G), dollars per stage: ${LADDER.join(', ')}`}</ThemedText>
    </Screen>
  )
}
