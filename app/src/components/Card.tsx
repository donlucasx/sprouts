import { View } from "react-native";
import type { PropsWithChildren } from "react";

/** A paper card: rounded, padded, a shade lighter than the ground. */
export function Card({ children }: PropsWithChildren) {
  return <View style={{ backgroundColor: "#FBF7EC", borderRadius: 14, padding: 16, gap: 6 }}>{children}</View>;
}
