import { describe, it, expect } from "vitest";
import { pickMeState } from "@/lib/me-state";
const cached = { pot: { asOf: "2026-09-28T16:00:00Z" } } as never;
const live = { pot: { asOf: "2026-09-28T17:00:00Z" } } as never;
describe("pickMeState", () => {
  it("keeps the last verified read on failure and says it is stale", () => { expect(pickMeState(undefined, cached, true)).toEqual({ data: cached, stale: true }); });
  it("prefers the live read", () => { expect(pickMeState(live, cached, false)).toEqual({ data: live, stale: false }); });
  it("never invents a garden", () => { expect(pickMeState(undefined, null, true)).toEqual({ data: undefined, stale: true }); });
});
