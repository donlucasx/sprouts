import { SafeAreaView, ScrollView, View } from "react-native";
import type { PropsWithChildren } from "react";

/** Paper ground, one column, comfortable padding: every screen sits on this. */
export function Screen({ children, scroll = true }: PropsWithChildren<{ scroll?: boolean }>) {
  const body = <View style={{ padding: 20, gap: 16 }}>{children}</View>;
  return <SafeAreaView style={{ flex: 1, backgroundColor: "#F4EEDF" }}>{scroll ? <ScrollView>{body}</ScrollView> : body}</SafeAreaView>;
}
