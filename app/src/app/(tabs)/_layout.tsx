import { Tabs } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import type { ComponentProps } from "react";

type IconName = ComponentProps<typeof Ionicons>["name"];
function icon(on: IconName, off: IconName) {
  return function TabIcon({ color, focused }: { color: ComponentProps<typeof Ionicons>["color"]; focused: boolean }) {
    return <Ionicons name={focused ? on : off} size={22} color={color} />;
  };
}

/**
 * The four places, always one tap away (his note, 09-29: Rules, Withdraw and Settings sat below the fold on Home). Withdraw lives on
 * the pot card, since it acts on that number; linking a wallet on the wallets card and in Settings.
 */
export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: "#2F5D3A",
        tabBarInactiveTintColor: "#9A9384",
        tabBarStyle: { backgroundColor: "#F4EEDF", borderTopColor: "#E2DACB" },
        sceneStyle: { backgroundColor: "#F4EEDF" },
      }}
    >
      <Tabs.Screen name="home" options={{ title: "Garden", tabBarIcon: icon("leaf", "leaf-outline") }} />
      <Tabs.Screen name="activity" options={{ title: "Activity", tabBarIcon: icon("list", "list-outline") }} />
      <Tabs.Screen name="rules" options={{ title: "Rules", tabBarIcon: icon("options", "options-outline") }} />
      <Tabs.Screen name="settings" options={{ title: "Settings", tabBarIcon: icon("settings", "settings-outline") }} />
    </Tabs>
  );
}
