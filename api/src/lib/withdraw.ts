import { rawToShares, sharesToRaw } from "./pot";

const MIN_PICK_RAW = 1_000_000n; // 1 SKR (the program's own minimum stake; RECONCILED rule 7)

export type PickPlan = { shares: bigint; amountRaw: bigint; prunes: boolean; brief: string[] };

const skr = (raw: bigint, usd: number | null) => {
  const n = Number(raw) / 1e6;
  return usd === null ? `${n.toFixed(2)} SKR` : `${n.toFixed(2)} SKR ($${(n * usd).toFixed(2)})`;
};

/** What a withdraw does, in numbers and in the sentences the brief shows before the fingerprint (spec 6, R60: "Withdraw", never "harvest"). */
export function planPick(a: { mode: "earned" | "amount"; amountRaw?: bigint; pot: { skrStakedRaw: bigint; skrEarnedRaw: bigint }; sharePrice: bigint; skrUsd: number | null }): PickPlan {
  const wanted = a.mode === "earned" ? a.pot.skrEarnedRaw : (a.amountRaw ?? 0n);
  if (wanted > a.pot.skrStakedRaw) throw new Error("That is more than your garden holds.");
  if (wanted < MIN_PICK_RAW) throw new Error(a.mode === "earned" ? "You can withdraw once your earned SKR reaches 1 SKR." : "The smallest withdrawal is 1 SKR.");
  const shares = rawToShares(wanted, a.sharePrice); // floor: the plant keeps the dust
  const amountRaw = sharesToRaw(shares, a.sharePrice);
  const prunes = wanted > a.pot.skrEarnedRaw;
  const brief = [
    a.mode === "earned" ? `Withdraw what your garden earned: ${skr(amountRaw, a.skrUsd)}.` : `Withdraw ${skr(amountRaw, a.skrUsd)} from your garden.`,
    prunes ? `This takes ${skr(wanted - a.pot.skrEarnedRaw, a.skrUsd)} of what you put in and prunes the plant.` : "What you put in stays planted and keeps earning.",
    "The SKR stops earning the moment you sign. It ripens in the basket for 48 hours, then Sprouts delivers it to your Seeker's wallet.",
    "You can put it back with one fingerprint until it is delivered. One basket at a time.",
    "Network fee: about $0.001.",
  ];
  return { shares, amountRaw, prunes, brief };
}
