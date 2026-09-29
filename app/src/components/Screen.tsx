import { Pressable, SafeAreaView, ScrollView, Text, View } from "react-native";
import { router } from "expo-router";
import type { PropsWithChildren } from "react";

/** Paper ground, one column, comfortable padding: every screen sits on this. `back` adds the way home (the navigator has no header). */
export function Screen({ children, scroll = true, back = false }: PropsWithChildren<{ scroll?: boolean; back?: boolean }>) {
  const goBack = () => (router.canGoBack() ? router.back() : router.replace("/home"));
  const body = (
    <View style={{ padding: 20, gap: 16 }}>
      {back ? (
        <Pressable onPress={goBack} accessibilityRole="button" accessibilityLabel="Back" hitSlop={12} style={{ alignSelf: "flex-start", paddingVertical: 4 }}>
          <Text style={{ fontSize: 16, color: "#2F5D3A" }}>{"‹ Back"}</Text>
        </Pressable>
      ) : null}
      {children}
    </View>
  );
  return <SafeAreaView style={{ flex: 1, backgroundColor: "#F4EEDF" }}>{scroll ? <ScrollView>{body}</ScrollView> : body}</SafeAreaView>;
}
