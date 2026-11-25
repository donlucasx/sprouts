import { useState } from 'react'
import { Pressable, View } from 'react-native'
import { MaterialCommunityIcons } from '@expo/vector-icons'
import { useQuery } from '@tanstack/react-query'
import { api, type VenuesResponse } from '@/lib/api'
import { venueCard, venueGroups } from '@/model/venues'
import { spacing, TARGET, useTheme } from '@/theme'
import { ThemedText } from './ThemedText'
import { useLang } from '@/i18n/useLang'
import { t } from '@/i18n'

function Line({ title, detail }: { title: string; detail: string }) {
  return (
    <View style={{ gap: 2, paddingVertical: spacing.xs }}>
      <ThemedText>{title}</ThemedText>
      <ThemedText variant="caption" tone="secondary">
        {detail}
      </ThemedText>
    </View>
  )
}

/** R451: "Where lending goes today" under the Yield Manager in Rules (moved from Settings, 10-08). Collapsed by default; open, it
 *  lists the venues Sprouts can use, then the ones it only compares. The rates and the AI's verdicts come from the daily run
 *  (GET /api/venues, R275, R276). */
export function VenuesPanel() {
  useLang()
  const { colors } = useTheme()
  const [open, setOpen] = useState(false)
  const venues = useQuery({ queryKey: ['venues'], queryFn: () => api<VenuesResponse>('/api/venues'), retry: false, enabled: open })
  const card = venueCard(venues.data, venues.isError, t('venues.empty'))
  const groups = venues.data && venues.data.venues.length > 0 ? venueGroups(venues.data) : null
  return (
    <View style={{ gap: spacing.xs }}>
      <Pressable
        onPress={() => setOpen((v) => !v)}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        style={{ flexDirection: 'row', alignItems: 'center', minHeight: TARGET, gap: spacing.sm }}
      >
        <ThemedText style={{ flex: 1, color: colors.accentText }}>{t('venues.title')}</ThemedText>
        <MaterialCommunityIcons name={open ? 'chevron-up' : 'chevron-down'} size={20} color={colors.accentText} />
      </Pressable>
      {open ? (
        groups ? (
          <>
            <ThemedText variant="caption" tone="secondary">
              {t('venues.checked')}
            </ThemedText>
            {groups.used.map((v) => (
              <Line key={v.key} title={v.title} detail={v.detail} />
            ))}
          </>
        ) : (
          <ThemedText tone="secondary">{'message' in card ? card.message : ''}</ThemedText>
        )
      ) : null}
    </View>
  )
}
