import { Pressable, Text, View } from "react-native";

/** Two options in one outlined bar, the chosen one filled, so both read as choices (09-29: a filled button beside plain text did not). */
export function TwoWay<T extends string>({ options, value, onChange }: { options: { value: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <View style={{ flexDirection: "row", borderWidth: 1.5, borderColor: "#2F5D3A", borderRadius: 12, overflow: "hidden" }}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable key={o.value} onPress={() => onChange(o.value)} accessibilityRole="button" accessibilityState={{ selected: on }}
            style={{ flex: 1, paddingVertical: 12, alignItems: "center", backgroundColor: on ? "#2F5D3A" : "transparent" }}>
            <Text style={{ color: on ? "#F4EEDF" : "#2F5D3A", fontSize: 16, fontWeight: "600" }}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}
