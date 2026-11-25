import { View } from 'react-native'
import { Button } from '@/components/Button'
import { ThemedText } from '@/components/ThemedText'
import { t } from '@/i18n'
import { useLang } from '@/i18n/useLang'
import { FONT, radius, spacing, useTheme } from '@/theme'

/**
 * 0.1.13 step 3 (carousel day: 21 of 27 failed links were cancels at the wallet's "unlimited USDC" screen): the approval said as the
 * LAST step before the wallet opens. Link a wallet's Approve and the re-link card's Re-link both land here; only "Continue to wallet"
 * opens the wallet. Copy: his, 11-25 (i18n link.approval.*). Back is hidden while the wallet or the chain is busy.
 */
export function ApprovalStep({ busy, onContinue, onBack }: { busy: boolean; onContinue: () => void; onBack: () => void }) {
  useLang()
  const { colors } = useTheme()
  return (
    <View style={{ borderWidth: 1.5, borderColor: colors.attention, borderRadius: radius.md, padding: spacing.md, gap: spacing.sm }}>
      <ThemedText tone="attention" style={{ fontFamily: FONT.label, fontSize: 15, lineHeight: 21 }}>
        {t('link.approval.title')}
      </ThemedText>
      <ThemedText style={{ fontSize: 14, lineHeight: 20 }}>{t('link.approval.body')}</ThemedText>
      <Button title={t('link.approval.continue')} loading={busy} onPress={onContinue} />
      {busy ? null : <Button title={t('link.approval.back')} kind="quiet" onPress={onBack} style={{ alignSelf: 'flex-start' }} />}
    </View>
  )
}
