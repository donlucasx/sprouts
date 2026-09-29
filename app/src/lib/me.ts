import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createMMKV } from "react-native-mmkv"; // v4: a factory, and MMKV is a type only [A5]
import { api, ApiError, type MeResponse } from "./api";
import { pickMeState } from "./me-state";
import type { GardenInput } from "@/model/garden";

export const store = createMMKV({ id: "sprouts" });
const KEY = "me.last";

export function readLastMe(): MeResponse | null {
  const raw = store.getString(KEY);
  return raw ? (JSON.parse(raw) as MeResponse) : null;
}

export function writeLastMe(me: MeResponse) {
  store.set(KEY, JSON.stringify(me));
}

/** Home's data: the live read when it works, the last verified one when it does not (never a zero pot, never a guessed fruit). */
export function useMe() {
  const q = useQuery({
    queryKey: ["me"],
    queryFn: async () => {
      const me = await api<MeResponse>("/api/me");
      writeLastMe(me);
      return me;
    },
    placeholderData: () => readLastMe() ?? undefined,
    retry: 1,
  });
  const { data, stale } = pickMeState(q.isPlaceholderData ? undefined : q.data, readLastMe(), q.isError);
  return {
    data, stale, refetch: q.refetch,
    asOf: data ? new Date(data.pot.asOf) : null,
    loading: q.isLoading && !data,
    unauthorized: q.error instanceof ApiError && q.error.status === 401,
  };
}

export function useInvalidateMe() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ["me"] });
}

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
