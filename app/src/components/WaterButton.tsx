import { useEffect } from "react";
import { Pressable, Text } from "react-native";
import Svg from "react-native-svg";
import Animated, { useSharedValue, useAnimatedStyle, withTiming, Easing } from "react-native-reanimated";
import { WateringCan } from "@/garden/parts";

/**
 * The can as a button (audits/watering-ux, findings 2 and 4): a 48 dp pill with a green outline, the glyph and a word, on its own
 * row; Home shows it only while a bud waits (R96). While the request runs the word says "Watering..." and the can tilts to pour.
 */
export function WaterButton({ label, busy, onPress }: { label: "Water" | "Watering..."; busy: boolean; onPress: () => void }) {
  const tilt = useSharedValue(0);
  useEffect(() => {
    tilt.value = withTiming(busy ? 24 : 0, { duration: 350, easing: Easing.out(Easing.cubic) });
  }, [busy, tilt]);
  const style = useAnimatedStyle(() => ({ transform: [{ rotate: `${tilt.value}deg` }] }));
  return (
    <Pressable
      onPress={onPress}
      disabled={busy}
      accessibilityRole="button"
      accessibilityLabel="Water the garden"
      style={{ alignSelf: "flex-start", height: 48, flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 18, borderRadius: 24, borderWidth: 1.5, borderColor: "#2F5D3A", backgroundColor: "#F4EEDF" }}
    >
      <Animated.View style={[{ width: 27, height: 18 }, style]}>
        <Svg width={27} height={18} viewBox="-1 -2 36 24"><WateringCan /></Svg>
      </Animated.View>
      <Text style={{ color: "#2F5D3A", fontSize: 16, fontWeight: "600" }}>{label}</Text>
    </Pressable>
  );
}
