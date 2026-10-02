import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createMMKV } from "react-native-mmkv"; // v4: a factory, and MMKV is a type only [A5]
import { api, ApiError, type MeResponse } from "./api";
import { pickMeState, usableMe } from "./me-state";
import { refreshWidget } from "./widget-refresh";
export { toGardenInput } from "./garden-input";

export const store = createMMKV({ id: "sprouts" });
const KEY = "me.last";

/** The last verified read, or null when there is none or it predates the Yield Manager build: every reader (Home, the widget task, the background fetch) goes through here. */
export function readLastMe(): MeResponse | null {
  const raw = store.getString(KEY);
  return raw ? usableMe(JSON.parse(raw) as MeResponse) : null;
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
      void refreshWidget(me).catch(() => {}); // the home-screen widget follows every good read
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
