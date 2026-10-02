import { Pressable, ScrollView, View, type RefreshControlProps } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { MaterialCommunityIcons } from '@expo/vector-icons'
import { router } from 'expo-router'
import type { PropsWithChildren, ReactElement } from 'react'
import { spacing, TARGET, useTheme } from '@/theme'
import { ThemedText } from './ThemedText'

/**
 * Paper ground, one column, the screen edge, and the phone's insets (the status bar on an edge-to-edge Android; the bottom only
 * on a stack screen, since a tab screen ends at the tab bar). `back` adds the way home (the navigator has no header); `title`
 * sets the screen's title in the Title step.
 */
export function Screen({
  children,
  scroll = true,
  back = false,
  onBack,
  title,
  inset = 'both',
  refreshControl,
}: PropsWithChildren<{
  scroll?: boolean
  back?: boolean
  /** What the top Back does instead of leaving (the Take out flow steps back to its list). */
  onBack?: () => void
  title?: string
  inset?: 'both' | 'top'
  refreshControl?: ReactElement<RefreshControlProps>
}>) {
  const insets = useSafeAreaInsets()
  const { colors } = useTheme()
  const goBack = () => (onBack ? onBack() : router.canGoBack() ? router.back() : router.replace('/home'))
  const body = (
    <View
      style={{
        flex: scroll ? undefined : 1,
        paddingHorizontal: spacing.edge,
        paddingTop: spacing.lg,
        paddingBottom: (inset === 'both' ? insets.bottom : 0) + spacing.edge,
        gap: spacing.lg,
      }}
    >
      {back ? (
        <Pressable
          onPress={goBack}
          accessibilityRole="button"
          accessibilityLabel="Back"
          hitSlop={8}
          style={({ pressed }) => ({
            alignSelf: 'flex-start',
            minHeight: TARGET - spacing.xs,
            flexDirection: 'row',
            alignItems: 'center',
            gap: spacing.xs,
            marginLeft: -spacing.xs,
            opacity: pressed ? 0.6 : 1,
          })}
        >
          <MaterialCommunityIcons name="arrow-left" size={22} color={colors.accentText} />
          <ThemedText variant="label" tone="accentText">
            Back
          </ThemedText>
        </Pressable>
      ) : null}
      {title ? <ThemedText variant="title">{title}</ThemedText> : null}
      {children}
    </View>
  )
  return (
    // The status bar's band is part of the frame, in the ground colour, so scrolling content passes under it never over it (his device note, 10-02).
    <View style={{ flex: 1, backgroundColor: colors.background, paddingTop: insets.top }}>
      {scroll ? (
        <ScrollView keyboardShouldPersistTaps="handled" refreshControl={refreshControl}>
          {body}
        </ScrollView>
      ) : (
        body
      )}
    </View>
  )
}
