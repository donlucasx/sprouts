// The six species on one grammar (spec 4): a pure function from a plant's shoots to placed parts, shared by the app's garden and
// the widget. The constants are the review generators' (brand/garden/gen01 to gen06, gen09) and the golden test holds them there.
import { BAKED_L, type LayoutOpts, type Placed, type PlantLayout, type ShootIn, type Species } from "./species";
import { mandarin } from "./geometry/mandarin";
import { succulent } from "./geometry/succulent";
import { sunflower } from "./geometry/sunflower";
import { spruce } from "./geometry/spruce";
import { snake } from "./geometry/snake";
import { blueberry } from "./geometry/blueberry";
export { branchFlags, stageOf, pupsByCount } from "./geometry/common";   // pupsByCount lives in common.ts since Task 0.5
/** A transplanted position (R61) is the SKR plant's grown base; its own plantings start above it. */
export const TRANSPLANT_BASE = 56;
const BY: Record<Species, (s: ShootIn[], o: LayoutOpts, k: number) => PlantLayout> = { mandarin, succulent, sunflower, spruce, snake, blueberry };
export const layoutPlant = (species: Species, shoots: ShootIn[], o: LayoutOpts, k: number): PlantLayout => BY[species](shoots, o, k);
/** A leaf-like sprite's drawn length: its baked length (BAKED_L by name and stage) times its scale. The golden test and I4's Strip read it. */
export const leafLen = (p: Extract<Placed, { kind: "sprite" }>) => { const base = BAKED_L[p.name.replace(/-s\d$/, "").replace(/-\d$/, "")]; return base ? base[Number(p.name.match(/-s(\d)$/)?.[1] ?? 0)] * p.scale : 0; };
