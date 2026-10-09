import { View } from 'react-native'
import { ThemedText } from './ThemedText'
import { spacing, useTheme } from '@/theme'
import { PRO_BADGE } from '@/model/manager'

/** R347: the outlined "Pro" pill beside a Pro feature's heading (the Yield Manager; Tax reports, his note 10-08). */
export function ProBadge() {
  const { colors } = useTheme()
  return (
    <View style={{ borderWidth: 1, borderColor: colors.accentText, borderRadius: 999, paddingHorizontal: spacing.sm, paddingVertical: 2 }}>
      <ThemedText variant="caption" tone="accentText">
        {PRO_BADGE}
      </ThemedText>
    </View>
  )
}
