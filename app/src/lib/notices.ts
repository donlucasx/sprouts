import { formatUsd, formatAmount } from "./format";

/** The planting push: what landed, where it sits, and that a sprout waits to be opened (audits/watering-ux, finding 9). */
export function plantingNotice(
  p: { asset: "SKR" | "stORE"; usdcInCents: number; amountOutRaw: string },
  pot: { skrUsd: number | null; storeUsd: number | null },
): string {
  const amount = formatAmount(p.asset, BigInt(p.amountOutRaw), p.asset === "SKR" ? pot.skrUsd : pot.storeUsd);
  const where = p.asset === "SKR" ? "locked to your Seeker" : "in your Seeker wallet";
  return `${formatUsd(p.usdcInCents)} of change became ${amount}, ${where}. A new sprout is waiting in your garden.`;
}
