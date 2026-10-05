import type { GardenInput } from "@/model/garden";

/** R351's device check, DEV builds only (Home registers it under `__DEV__`; nothing here is sent anywhere): "Grow a bud" adds one
 * local SKR planting at `budAt`, a closed sprout the can is ready for; watering it (the can, locally) sets `wateredAt`, so the next
 * scene opens it through the garden's real diff and plan. Any real bud waiting before `wateredAt` opens locally with it. */
export type DevBud = { budAt: Date; wateredAt: Date | null };
export function withDevBud(input: GardenInput, dev: DevBud | null): GardenInput {
  if (!dev) return input;
  const last = [...input.plantings].reverse().find((p) => p.asset === "SKR");
  const amountOutRaw = last?.amountOutRaw ?? 1_000_000_000n, usdcInCents = last?.usdcInCents ?? 100;
  return {
    ...input,
    plantings: [...input.plantings, { id: "dev-bud", ts: dev.budAt, asset: "SKR", amountOutRaw, usdcInCents }],
    skrPutInRaw: input.skrPutInRaw + amountOutRaw,
    ...(dev.wateredAt ? { wateredAt: dev.wateredAt, wateredPlants: ["skr" as const] } : {}),
  };
}
