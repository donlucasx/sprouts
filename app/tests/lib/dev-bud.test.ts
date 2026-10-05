import { describe, it, expect } from "vitest";
import { buildScene } from "@/model/garden";
import { diffScenes } from "@/lib/scene-diff";
import { previewInputAt } from "@/model/fixtures/median-year";
import { withDevBud } from "@/lib/dev-bud";

// R351's device check (DEV builds only): "Grow a bud" adds a local SKR planting, the can waters it locally, the sprout opens.
describe("the dev bud (DEV only; nothing is sent)", () => {
  const input = { ...previewInputAt(120), wateredAt: null as Date | null };
  const watered = { ...input, wateredAt: new Date(input.now.getTime() - 1000) };
  it("off: the input is unchanged", () => { expect(withDevBud(watered, null)).toBe(watered); });
  it("grown: one more SKR planting, a closed sprout the can is ready for; watered: that shoot opens", () => {
    const budAt = new Date(input.now.getTime() - 500);
    const grown = withDevBud(watered, { budAt, wateredAt: null });
    expect(grown.plantings.length).toBe(watered.plantings.length + 1);
    const a = buildScene(watered), b = buildScene(grown);
    const sprout = b.parts.find((p) => p.kind === "sprout" && p.id === "dev-bud");
    expect(sprout).toMatchObject({ plant: "skr", bud: true });
    expect(b.unrevealed).toBeGreaterThan(a.unrevealed);
    const opened = buildScene(withDevBud({ ...watered, now: new Date(input.now.getTime() + 10) }, { budAt, wateredAt: new Date(input.now.getTime() + 5) }));
    expect(opened.parts.find((p) => p.kind === "sprout" && p.id === "dev-bud")).toMatchObject({ bud: false });
    expect(diffScenes(b, opened).opened).toContain("dev-bud");
  });
});
