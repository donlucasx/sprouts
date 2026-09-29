import type { MeResponse } from "./api";
import type { GardenInput } from "@/model/garden";

/** The API's numbers (decimal strings on the wire) into the model's input; the app never computes money itself. */
export function toGardenInput(me: MeResponse, now: Date): GardenInput {
  const b = (s: string) => BigInt(s);
  return {
    now,
    wateredAt: me.user.wateredAt ? new Date(me.user.wateredAt) : null,
    plantings: me.history.plantings.map((p) => ({ id: p.id, ts: new Date(p.ts), asset: p.asset, amountOutRaw: b(p.amountOutRaw) })),
    picks: me.history.picks.map((p) => ({ ts: new Date(p.ts), asset: p.asset, amountRaw: b(p.amountRaw) })),
    skrPutInRaw: b(me.pot.skrPutInRaw), skrEarnedRaw: b(me.pot.skrEarnedRaw), skrPickedRaw: b(me.pot.skrPickedRaw),
    skrFruit: me.pot.fruit, skrNextFruitProgress: me.pot.nextFruitProgress,
    storePutInRaw: b(me.pot.storePutInRaw), storePups: 0, storeNextPupProgress: 0,
    joinedValueRaw: b(me.pot.joinedValueRaw),
    skrPrincipalPickedRaw: b(me.pot.skrPrincipalPickedRaw),
    pendingCents: me.nextPlanting.pendingCents,
    basket: me.basket ? { amountRaw: b(me.basket.amountRaw), readyAt: new Date(me.basket.readyAt) } : null,
  };
}
