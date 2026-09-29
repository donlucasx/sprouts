import { Pressable, Text } from "react-native";

export function Button({ title, onPress, kind = "primary", disabled = false }: { title: string; onPress: () => void; kind?: "primary" | "quiet" | "danger"; disabled?: boolean }) {
  const bg = disabled ? "#CFC8B8" : kind === "primary" ? "#2F5D3A" : kind === "danger" ? "#8C2F2F" : "transparent";
  const color = kind === "quiet" ? "#2F5D3A" : "#F4EEDF";
  return (
    <Pressable onPress={onPress} disabled={disabled} style={{ backgroundColor: bg, paddingVertical: 14, paddingHorizontal: 18, borderRadius: 12, alignItems: "center" }}>
      <Text style={{ color, fontSize: 17, fontWeight: "600" }}>{title}</Text>
    </Pressable>
  );
}
