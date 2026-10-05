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
  if (wanted < MIN_PICK_RAW) throw new Error(a.mode === "earned" ? "You can withdraw once your earnings reach 1 SKR." : "The smallest withdrawal is 1 SKR.");
  const shares = rawToShares(wanted, a.sharePrice); // floor: the plant keeps the dust
  const amountRaw = sharesToRaw(shares, a.sharePrice);
  const prunes = wanted > a.pot.skrEarnedRaw;
  // His note 10-05 ("very wordy- can we simplify?"): three short lines. Earning stops at signing is implied by "put it back"; one
  // withdrawal at a time shows only when a second one is tried (the app's waiting card).
  const head = a.mode === "earned" ? `Withdraw your earnings: ${skr(amountRaw, a.skrUsd)}.` : `Withdraw ${skr(amountRaw, a.skrUsd)}.`;
  const brief = [
    prunes ? `${head} Your SKR plant gets smaller.` : head,
    "Arrives in your wallet in 48 hours. You can put it back until then.",
    "Network fee about $0.001.",
  ];
  return { shares, amountRaw, prunes, brief };
}
