import { describe, it, expect } from "vitest";
import { pauseCauseOf } from "@/domain/pause-cause";

const ev = (walletPubkey: string, kind: string, detail: unknown = null) => ({ walletPubkey, kind, detail });

describe("pauseCauseOf (R207: only the newest event counts, newest first)", () => {
  it("a newest paused_no_usdc is the run's pause, with the cents it wanted", () => {
    expect(pauseCauseOf([ev("W", "paused_no_usdc", { needCents: 312 }), ev("W", "paused_by_user")], "W")).toEqual({ reason: "no_usdc", needCents: 312 });
  });
  it("a user pause after it, a resume, another wallet's event or no event at all is the user's", () => {
    expect(pauseCauseOf([ev("W", "paused_by_user"), ev("W", "paused_no_usdc", { needCents: 1 })], "W")).toEqual({ reason: "user" });
    expect(pauseCauseOf([ev("W", "resumed")], "W")).toEqual({ reason: "user" });
    expect(pauseCauseOf([ev("X", "paused_no_usdc", { needCents: 1 })], "W")).toEqual({ reason: "user" });
    expect(pauseCauseOf([], "W")).toEqual({ reason: "user" });
  });
  it("a missing or odd needCents reads as unknown", () => {
    expect(pauseCauseOf([ev("W", "paused_no_usdc", null)], "W")).toEqual({ reason: "no_usdc", needCents: null });
    expect(pauseCauseOf([ev("W", "paused_no_usdc", { needCents: "5" })], "W")).toEqual({ reason: "no_usdc", needCents: null });
  });
});
