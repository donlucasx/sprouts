import { Image, Modal, Pressable, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { router } from 'expo-router'
import { ThemedText } from '@/components/ThemedText'
import { Button } from '@/components/Button'
import { COIN_FULL_NAME, COIN_LOGO } from '@/lib/coin-icons'
import { coinSheet } from '@/lib/coin-sheet'
import type { MeResponse } from '@/lib/api'
import type { CoinRow } from '@/lib/me-state'
import { FONT, radius, spacing, useTheme } from '@/theme'

/**
 * R564: tapping a coin on Home opens this sheet from the bottom: the coin's logo, value and amount, Put in / Earned (green above
 * zero, R563) / Where, its last plantings, and Withdraw opened on this coin (or the wallet line for coins Sprouts cannot move).
 * A plain RN Modal (no native sheet module, so no new dev build); tapping the shade or the hardware back closes it.
 */
export function CoinSheet({ me, row, onClose }: { me: MeResponse; row: CoinRow | null; onClose: () => void }) {
  const { colors } = useTheme()
  const insets = useSafeAreaInsets()
  const sheet = row ? coinSheet(me, row) : null
  return (
    <Modal visible={row !== null} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.32)' }} onPress={onClose} accessibilityLabel="Close" />
      {row && sheet ? (
        <View
          style={{
            backgroundColor: colors.background,
            borderTopLeftRadius: radius.lg,
            borderTopRightRadius: radius.lg,
            paddingHorizontal: spacing.edge,
            paddingTop: spacing.md,
            paddingBottom: insets.bottom + spacing.lg,
            gap: spacing.md,
          }}
        >
          <View style={{ alignSelf: 'center', width: 36, height: 4, borderRadius: 2, backgroundColor: colors.hairline }} />
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
            <Image source={COIN_LOGO[row.asset]} style={{ width: 48, height: 48, borderRadius: 24 }} />
            <View style={{ flex: 1, gap: 2 }}>
              <ThemedText variant="heading" numberOfLines={1}>
                {COIN_FULL_NAME[row.asset]}
              </ThemedText>
              <ThemedText variant="caption" tone="secondary" numeric numberOfLines={1}>
                {row.qty}
              </ThemedText>
            </View>
            <ThemedText variant="heading" numeric>
              {row.usd ?? ''}
            </ThemedText>
          </View>
          <View style={{ backgroundColor: colors.surface, borderRadius: radius.md, paddingHorizontal: spacing.md }}>
            {sheet.lines.map((l, i) => (
              <View
                key={l.label}
                style={{
                  flexDirection: 'row',
                  justifyContent: 'space-between',
                  gap: spacing.md,
                  paddingVertical: spacing.sm + 2,
                  borderTopWidth: i === 0 ? 0 : 1,
                  borderTopColor: colors.hairline,
                }}
              >
                <ThemedText variant="body" tone="secondary">
                  {l.label}
                </ThemedText>
                <ThemedText
                  variant="body"
                  numeric
                  numberOfLines={1}
                  style={{ fontFamily: FONT.label, flexShrink: 1, color: l.positive ? colors.success : colors.text }}
                >
                  {l.value}
                </ThemedText>
              </View>
            ))}
          </View>
          {sheet.plantings.length > 0 ? (
            <View style={{ gap: spacing.xs }}>
              <ThemedText variant="label" tone="secondary">
                Last plantings
              </ThemedText>
              {sheet.plantings.map((p, i) => (
                <ThemedText key={i} variant="caption" numeric>
                  {p}
                </ThemedText>
              ))}
            </View>
          ) : null}
          {sheet.withdrawKey ? (
            <Button
              title="Withdraw"
              kind="quiet"
              onPress={() => {
                onClose()
                router.push({ pathname: '/withdraw', params: { pick: sheet.withdrawKey! } })
              }}
            />
          ) : (
            <ThemedText variant="caption" tone="secondary">
              {sheet.walletNote}
            </ThemedText>
          )}
        </View>
      ) : null}
    </Modal>
  )
}
