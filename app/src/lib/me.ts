import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError, type MeResponse } from "./api";
import { applyRulesTo, normalizeMe, pickMeState, usableMe, type ManagerExtra } from "./me-state";
import { refreshWidget } from "./widget-refresh";
import { recordZeroMarks } from "./zero-marks";
export { toGardenInput } from "./garden-input";

import { store } from "./store";
export { store };
const KEY = "me.last";

/** The last verified read, or null when there is none or it predates the Yield Manager build: every reader (Home, the widget task, the background fetch) goes through here. */
export function readLastMe(): MeResponse | null {
  const raw = store.getString(KEY);
  const usable = raw ? usableMe(JSON.parse(raw) as MeResponse) : null;
  return usable ? normalizeMe(usable) : null;
}

export function writeLastMe(me: MeResponse) {
  store.set(KEY, JSON.stringify(me));
  recordZeroMarks(me);   // R360: a coin seen at zero now starts again from a seedling at its next planting
}

/** Home's data: the live read when it works, the last verified one when it does not (never a zero pot, never a guessed fruit). */
export function useMe() {
  const q = useQuery({
    queryKey: ["me"],
    queryFn: async () => {
      const me = normalizeMe(await api<MeResponse>("/api/me"));
      writeLastMe(me);
      void refreshWidget(me).catch(() => {}); // the home-screen widget follows every good read
      return me;
    },
    placeholderData: () => readLastMe() ?? undefined,
    retry: 1,
    // Perf (10-08): a tab switch within 30 s shows the cached pot without a new read; later it shows it at once and refreshes.
    staleTime: 30_000,
  });
  const { data, stale } = pickMeState(q.isPlaceholderData ? undefined : q.data, readLastMe(), q.isError);
  return {
    data, stale, refetch: q.refetch,
    /** The data is a read made since this screen opened, not the saved last read (the garden plays nothing for the latter, I4 ruling b). */
    fresh: !q.isPlaceholderData && q.isFetchedAfterMount && q.data !== undefined,
    asOf: data ? new Date(data.pot.asOf) : null,
    loading: q.isLoading && !data,
    unauthorized: q.error instanceof ApiError && q.error.status === 401,
  };
}

export function useInvalidateMe() {
  const qc = useQueryClient();
  // Audit 10-08: Activity is cached for a minute and prefetched by Home, so every money action refreshes it with the read
  return () => Promise.all([qc.invalidateQueries({ queryKey: ["me"] }), qc.invalidateQueries({ queryKey: ["activity"] })]);
}

/** Puts a save's or an undo's answer straight into the cached read, so the screen moves once; the invalidate after it reconciles in the background. */
export function useApplyRules() {
  const qc = useQueryClient();
  return (rules: MeResponse["rules"], extra?: ManagerExtra) => {
    qc.setQueryData<MeResponse>(["me"], (old) => applyRulesTo(old, rules, extra));
  };
}
