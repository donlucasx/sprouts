import { Tabs } from 'expo-router'
import { MaterialCommunityIcons } from '@expo/vector-icons'
import type { ComponentProps } from 'react'
import { FONT, useTheme } from '@/theme'

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
 */
export default function TabsLayout() {
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
      <Tabs.Screen name="home" options={{ title: 'Garden', tabBarIcon: icon('sprout', 'sprout-outline') }} />
      <Tabs.Screen
        name="activity"
        options={{ title: 'Activity', tabBarIcon: icon('format-list-bulleted', 'format-list-bulleted') }}
      />
      <Tabs.Screen name="rules" options={{ title: 'Rules', tabBarIcon: icon('tune-variant', 'tune-variant') }} />
      <Tabs.Screen name="settings" options={{ title: 'Settings', tabBarIcon: icon('cog', 'cog-outline') }} />
    </Tabs>
  )
}
