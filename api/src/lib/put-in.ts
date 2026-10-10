/**
 * Put in = what was pulled (10-10, Kimi audit audits/putin-3c, R583). Until 10-07 every planting pulled its change plus a flat 3c
 * "network fee" (network_fee_cents) and booked its leg as pull - 3c, yet the whole pull was swapped or deposited (planting.ts "not
 * withheld"). This adds each planting's recorded network fee back onto its legs, at READ time for what the user sees: /api/me,
 * /api/activity and the tax export. Never in the repo read layer: the allocation ledger (plant-run bookConfirmed) reads raw legs.
 *
 * The add-back is capped at what the pull covers (pull - sum of the legs, never below 0) and split over a planting's legs by their
 * usdcInCents, largest remainder first, so the corrected legs sum to the pull exactly. Legs with no planting given (a move's carried
 * basis) and plantings with no fee are returned as they are. Pure: new leg objects, the input is not changed.
 */
export function withNetworkFee<L extends { plantingId: string; usdcInCents: number }>(
  legs: readonly L[],
  plantings: readonly { id: string; usdcPulledCents: number; networkFeeCents: number }[],
): L[] {
  const add = new Map<L, number>()
  for (const p of plantings) {
    if (!(p.networkFeeCents > 0)) continue
    const mine = legs.filter((l) => l.plantingId === p.id)
    if (mine.length === 0) continue
    const sum = mine.reduce((s, l) => s + l.usdcInCents, 0)
    const back = Math.min(p.networkFeeCents, Math.max(0, p.usdcPulledCents - sum))
    if (back <= 0) continue
    const weights = sum > 0 ? mine.map((l) => l.usdcInCents / sum) : mine.map((_, i) => (i === 0 ? 1 : 0))
    const exact = weights.map((w) => w * back)
    const floor = exact.map(Math.floor)
    let left = back - floor.reduce((s, x) => s + x, 0)
    const order = exact.map((x, i) => ({ i, r: x - floor[i]! })).sort((a, b) => b.r - a.r || a.i - b.i)
    for (const { i } of order) {
      if (left <= 0) break
      floor[i]! += 1
      left -= 1
    }
    mine.forEach((l, i) => add.set(l, floor[i]!))
  }
  return legs.map((l) => (add.get(l) ? { ...l, usdcInCents: l.usdcInCents + add.get(l)! } : l))
}
