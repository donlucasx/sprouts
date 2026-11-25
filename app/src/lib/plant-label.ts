import type { MeResponse } from "./api";
import { coinNameLong, DECIMALS, formatUsd } from "./format";
import { t } from "@/i18n";
import { ASSET_OF, fruitLadder, type PlantId } from "@/model/garden";

/** Dollars for a label: cents, and "under 1¢" for a positive amount that rounds to nothing. */
const usd = (v: number) => (v > 0 && v < 0.005 ? t("garden.label.under1c") : formatUsd(Math.round(v * 100)));

/**
 * R250 (10-04, "whats that red thing on the hsol plant? ... should a user be able to tap on them to collect?", ruled: a label, read
 * only): what a tapped plant shows, in words, from the read the garden is drawn from. Line 1: the coin and its value. Then what it has
 * earned and how near the next token is (the fruit and the blossom, RG16), the change waiting when this coin plants next (the swelling,
 * R89), and a new sprout waiting for water (the bud). Nothing here moves money.
 */
export function plantLabel(me: Pick<MeResponse, "pot" | "holdings" | "nextPlanting">, plant: PlantId, budWaiting: boolean): string[] {
  const asset = ASSET_OF[plant];
  const lines: string[] = [];
  let value: number | null = null, earned: number | null = null, progress = 0;
  if (asset === "SKR") {
    const p = me.pot.skrUsd, unit = 10 ** DECIMALS.SKR;
    if (p !== null) { value = (Number(me.pot.skrStakedRaw) / unit) * p; earned = (Number(me.pot.skrEarnedRaw) / unit) * p; }
    progress = me.pot.nextFruitProgress;
  } else {
    const h = me.holdings.find((x) => x.asset === asset);
    if (h) { value = h.valueUsd; earned = h.earnedUsd; if (h.earnedUsd !== null) progress = fruitLadder(h.earnedUsd, h.putInCents).progress; }
  }
  lines.push(value === null ? coinNameLong(asset) : `${coinNameLong(asset)} · ${usd(value)}`);
  if (earned !== null && earned > 0) lines.push(progress > 0 ? t("garden.label.earnedNext", { amount: usd(earned), pct: Math.round(progress * 100) }) : t("garden.label.earned", { amount: usd(earned) }));
  if (me.nextPlanting.asset === asset && me.nextPlanting.pendingCents > 0) lines.push(t("garden.label.change", { pending: formatUsd(me.nextPlanting.pendingCents), threshold: formatUsd(me.nextPlanting.thresholdCents) }));
  if (budWaiting) lines.push(t("garden.label.bud"));
  return lines;
}
