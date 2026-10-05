import { G, Path, Circle, ClipPath, Defs, Image as SvgImage, Rect, Text as SvgText } from "react-native-svg";
import { SPRITES } from "./sprites";
import { stemPaths, spriteTransform } from "@/model/paint";
import { COLORS, SOIL, type Placed, type PlantId } from "@/model/species";
import { boardXOf, LEND_SIGN, SIGN_TEXT, type SignLines } from "@/model/layout";
import { SOIL_CLIP_ID, soilClipPath, type GroundPlace } from "@/model/soil-clip";
import { FONT } from "@/theme/tokens";

export const INK = SOIL.ink; export const WATER = SOIL.water; export const OCHRE = SOIL.front;
/** A baked sprite placed by its anchor; `xScale` (the succulent's slender blades, the spruce's arms) scales x apart from y. */
export function SpriteAt({ name, x, y, rot = 0, scale = 1, xScale }: { name: string; x: number; y: number; rot?: number; scale?: number; xScale?: number }) {
  const m = SPRITES[name]; if (!m) return null;
  return <G transform={spriteTransform(m, x, y, rot, scale, xScale ?? scale)}><SvgImage href={m.src} width={m.w} height={m.h} /></G>;
}
/** A painted stem: gen03's three layers as paths. */
export function PaintedStem({ s }: { s: Extract<Placed, { kind: "stem" }> }) {
  return <G>{stemPaths(s.x0, s.y0, s.x1, s.y1, s.w0, s.w1, s.bend, s.color).map((p, i) => <Path key={i} d={p.d} fill={p.fill} opacity={p.opacity} />)}</G>;
}
/** One placed part of a plant, in the plant's own frame (its foot at 0, 0). */
export function PlacedPart({ p, plant }: { p: Placed; plant: PlantId }) {
  if (p.kind === "stem") return <PaintedStem s={p} />;
  if (p.part === "swelling") return <Circle cx={p.x} cy={p.y} r={p.scale} fill={COLORS[plant].light} opacity={0.4 + 0.35 * Math.min(1, (p.scale - 2.2) / 2.4)} />;
  if (p.part === "dot") return <Circle cx={p.x} cy={p.y} r={p.scale} fill={COLORS.ore.token} opacity={0.95} />;
  return <SpriteAt name={p.name} x={p.x} y={p.y} rot={p.rot} scale={p.scale} xScale={p.xScale} />;
}
/** The ground (RG28): one baked wash, 320 wide at 1x anchored top-left, its height the bake's (the manifest's, never a constant), its
 * bottom on the canvas bottom (the soil line plus 60, spec 5), scaled in x to the garden's width; the vignette
 * does not fill the canvas, so the paper shows at its edges. `soilPaths` is not drawn here. */
export function Soil({ g }: { g: GroundPlace }) {
  const m = SPRITES["ground"]; if (!m) return null;   // R231, R238: placed by the frame's ground, the one placement the clip and the stakes read too
  return <SpriteAt name="ground" x={g.x0} y={g.y0} scale={g.sy} xScale={g.sx} />;
}
/** R176: the painted soil's outline as a STATIC clip (only animated ClipPath children fail on Android, the spike) for the water rings:
 * the same placement as `Soil`, so the rings stop where the soil does. */
export function SoilClip({ g }: { g: GroundPlace }) {
  const m = SPRITES["ground"]; if (!m) return null;
  return <Defs><ClipPath id={SOIL_CLIP_ID}><Path d={soilClipPath(g.x0, g.y0, g.sx, g.sy)} /></ClipPath></Defs>;
}
/** The water ring (RG11): the front row's at 24, the back row's at 16 (gen06:77, :83: two thirds). */
export function Ring({ age, k = 1 }: { age: number; k?: number }) {
  const m = SPRITES["ring"]; if (!m) return null;
  return <G opacity={1 - age} transform={spriteTransform(m, 0, 0, 0, k)}><SvgImage href={m.src} width={m.w} height={m.h} /></G>;
}
export function Seed({ index }: { index: number }) {   // gen01 seeds(): alternating sides, 3 + 2.4 per pair out, a little lift
  const dx = (index % 2 ? 1 : -1) * (3 + 2.4 * Math.floor(index / 2)), dy = -1.2 * (index % 3);
  return <SpriteAt name="seed" x={dx} y={dy} rot={((index * 37) % 60) - 30} />;
}
/** R168: the painted board (one blank bake for all six) and the words over it in Albert Sans, dark ink, crisp at any zoom. R262: a
 * lending stake's board is drawn LEND_SIGN.boardX wide with two lines (contracts 7.2). */
export function Sign({ lines, scale }: { lines: SignLines; scale: number }) {
  const text = (y: number, size: number, words: string) => (
    <SvgText x={0} y={y} fontSize={size} fontFamily={FONT.label} fill={INK} textAnchor="middle">{words}</SvgText>
  );
  return (
    <G>
      <SpriteAt name="sign" x={0} y={0} rot={0} scale={scale} xScale={scale * boardXOf(lines)} />
      <G transform={`scale(${scale}) rotate(${SIGN_TEXT.rot})`}>
        {lines.line2 ? (
          <>
            {text(LEND_SIGN.y1, LEND_SIGN.size1, lines.line1)}
            {text(LEND_SIGN.y2, LEND_SIGN.size2, lines.line2)}
          </>
        ) : (
          text(SIGN_TEXT.y, SIGN_TEXT.size, lines.line1)
        )}
      </G>
    </G>
  );
}
export function Basket() { return <G><Rect x={0} y={0} width={26} height={16} rx={3} fill={OCHRE} /><Path d="M3 0 Q 13 -12 23 0" stroke={OCHRE} strokeWidth={2} fill="none" /></G>; }
