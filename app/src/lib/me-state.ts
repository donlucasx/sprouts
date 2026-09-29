import type { MeResponse } from "./api";

/** Review Focus 2, as a pure decision: a failed read keeps the last verified state and says so; never a zero garden. */
export function pickMeState(live: MeResponse | undefined, cached: MeResponse | null, failed: boolean): { data: MeResponse | undefined; stale: boolean } {
  if (live) return { data: live, stale: false };
  if (cached) return { data: cached, stale: failed };
  return { data: undefined, stale: failed };
}
