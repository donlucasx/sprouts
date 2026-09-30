import { useRef, useState } from "react";
import { View, type GestureResponderEvent, type LayoutChangeEvent } from "react-native";
import Svg from "react-native-svg";
import { Sprout, Succulent, GREEN, OCHRE } from "@/garden/parts";
import { fenceShare } from "@/lib/forms";

const POST_W = 22;

/**
 * The fence (R92): one bed, the SKR sprout at the left end, the ORE succulent at the right, a post that slides in steps of 10.
 * The bed right of the post is ORE's share, 0 to 50, so the post starts at the right end and moves left as ORE grows.
 * Pure JS (no native slider, so the dev client on the phone needs no rebuild): a tap or a drag on the bed moves the post. The
 * bed claims the touch and keeps it, so the screen's vertical scroll does not take a sideways drag away from it.
 */
export function Fence({ share, onChange, disabled = false }: { share: number; onChange: (share: number) => void; disabled?: boolean }) {
  const [width, setWidth] = useState(0);
  const start = useRef({ x: 0, pageX: 0 }); // where the touch began, written and read in the handlers only
  const onLayout = (e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width);
  const grant = (e: GestureResponderEvent) => {
    start.current = { x: e.nativeEvent.locationX, pageX: e.nativeEvent.pageX };
    onChange(fenceShare(e.nativeEvent.locationX, width));
  };
  // A drag that leaves the bed still moves the post: the distance travelled on screen, from where the touch began.
  const move = (e: GestureResponderEvent) => onChange(fenceShare(start.current.x + (e.nativeEvent.pageX - start.current.pageX), width));
  const postLeft = width ? (1 - share / 100) * width - POST_W / 2 : 0;
  const oreWidth = width ? (share / 100) * width : 0;
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 10, opacity: disabled ? 0.5 : 1 }}>
      <Svg width={24} height={40} viewBox="0 0 40 80"><Sprout stage={2} bud={false} /></Svg>
      <View
        onLayout={onLayout}
        onStartShouldSetResponder={() => !disabled}
        onMoveShouldSetResponder={() => !disabled}
        onResponderTerminationRequest={() => false}
        onResponderGrant={grant}
        onResponderMove={move}
        style={{ flex: 1, height: 44, justifyContent: "center" }}
        accessibilityRole="adjustable"
        accessibilityLabel="ORE share"
        accessibilityValue={{ text: `${share} percent` }}
        accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
        onAccessibilityAction={(e) => onChange(Math.max(0, Math.min(50, share + (e.nativeEvent.actionName === "increment" ? 10 : -10))))}
      >
        <View style={{ height: 10, borderRadius: 5, backgroundColor: GREEN, overflow: "hidden" }}>
          <View style={{ position: "absolute", right: 0, top: 0, bottom: 0, width: oreWidth, backgroundColor: OCHRE }} />
        </View>
        <View pointerEvents="none" style={{ position: "absolute", left: postLeft, width: POST_W, height: 34, borderRadius: 5, backgroundColor: "#5A4632", borderWidth: 2, borderColor: "#F4EEDF" }} />
      </View>
      <Svg width={24} height={40} viewBox="0 0 40 80"><Succulent stage={2} bud={false} /></Svg>
    </View>
  );
}
