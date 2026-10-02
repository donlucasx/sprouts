import { useState } from 'react'
import { Pressable, View } from 'react-native'
import { MaterialCommunityIcons } from '@expo/vector-icons'
import { spacing, TARGET, useTheme } from '@/theme'
import { ThemedText } from './ThemedText'

/** One disclosure as an expandable row (R145, Claude's pick): the title with a chevron, the paragraph opening in place under it. */
export function Disclosure({ title, children, first = false }: { title: string; children: string; first?: boolean }) {
  const [open, setOpen] = useState(false)
  const { colors } = useTheme()
  return (
    <View style={{ borderTopWidth: first ? 0 : 1, borderTopColor: colors.hairline }}>
      <Pressable
        onPress={() => setOpen((o) => !o)}
        accessibilityRole="button"
        accessibilityLabel={title}
        accessibilityState={{ expanded: open }}
        style={({ pressed }) => ({
          minHeight: TARGET,
          flexDirection: 'row',
          alignItems: 'center',
          gap: spacing.sm,
          paddingVertical: spacing.sm,
          opacity: pressed ? 0.7 : 1,
        })}
      >
        <ThemedText style={{ flex: 1 }}>{title}</ThemedText>
        <MaterialCommunityIcons name={open ? 'chevron-up' : 'chevron-down'} size={22} color={colors.accentText} />
      </Pressable>
      {open ? (
        <ThemedText tone="secondary" style={{ paddingBottom: spacing.md }}>
          {children}
        </ThemedText>
      ) : null}
    </View>
  )
}
