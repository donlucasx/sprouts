import { Tabs } from 'expo-router'
import { MaterialCommunityIcons } from '@expo/vector-icons'
import type { ComponentProps } from 'react'
import { FONT, useTheme } from '@/theme'
import { Mark } from '@/components/Mark'
import { t } from '@/i18n'
import { useLang } from '@/i18n/useLang'
import { Text, type ColorValue } from 'react-native'
import type { Key } from '@/i18n/en'

/**
 * 11-25 (his device test: the tab names stayed English until a restart): the bar does not re-read `title` when the language changes,
 * so each label is its own small component that subscribes to the language and re-renders by itself.
 */
function TabLabel({ k, color }: { k: Key; color: ColorValue }) {
  useLang()
  return <Text style={{ fontFamily: FONT.label, fontSize: 12, color }}>{t(k)}</Text>
}
const label = (k: Key) => function Label({ color }: { color: ColorValue }) { return <TabLabel k={k} color={color} /> }

type IconName = ComponentProps<typeof MaterialCommunityIcons>['name']
function icon(on: IconName, off: IconName) {
  return function TabIcon({
    color,
    focused,
  }: {
    color: ComponentProps<typeof MaterialCommunityIcons>['color']
    focused: boolean
  }) {
    return <MaterialCommunityIcons name={focused ? on : off} size={24} color={color} />
  }
}

/**
 * The four places, always one tap away (his note, 09-29: Rules, Withdraw and Settings sat below the fold on Home). Withdraw lives on
 * the pot card, since it acts on that number; linking a wallet on the wallets card and in Settings. Material icons, the platform's.
 * The order is the declaration order below (R197: Garden | Rules | Activity | Settings).
 */
export default function TabsLayout() {
  useLang() // 0.1.13: the tab names follow the language
  const { colors } = useTheme()
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.textSecondary,
        tabBarStyle: { backgroundColor: colors.background, borderTopColor: colors.hairline },
        // The platform's own label size for a bottom bar, in the brand's label face.
        tabBarLabelStyle: { fontFamily: FONT.label, fontSize: 12 },
        sceneStyle: { backgroundColor: colors.background },
      }}
    >
      {/* R163: the Garden tab carries the Sprouts mark in the tab bar's tint (the label already says Garden). */}
      <Tabs.Screen name="home" options={{ title: t('tabs.garden'), tabBarLabel: label('tabs.garden'), tabBarIcon: ({ color }) => <Mark size={24} color={String(color)} decorative /> }} />
      {/* R197 (device check 2, his note): Rules before Activity, so the bar reads Garden | Rules | Activity | Settings. */}
      <Tabs.Screen name="rules" options={{ title: t('tabs.rules'), tabBarLabel: label('tabs.rules'), tabBarIcon: icon('tune-variant', 'tune-variant') }} />
      <Tabs.Screen
        name="activity"
        options={{ title: t('tabs.activity'), tabBarLabel: label('tabs.activity'), tabBarIcon: icon('format-list-bulleted', 'format-list-bulleted') }}
      />
      <Tabs.Screen name="settings" options={{ title: t('tabs.settings'), tabBarLabel: label('tabs.settings'), tabBarIcon: icon('cog', 'cog-outline') }} />
    </Tabs>
  )
}
