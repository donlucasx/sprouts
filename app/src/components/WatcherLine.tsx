import { Text } from "react-native";

/** The watcher's one line (spec 6): italic serif, under 25 words. A fixed line in this plan; Plan 3 writes it. */
export function WatcherLine({ text }: { text: string }) {
  return <Text style={{ flex: 1, fontSize: 16, fontStyle: "italic", fontFamily: "serif", color: "#2B2B2B" }}>{text}</Text>;
}
