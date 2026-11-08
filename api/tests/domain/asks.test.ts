import { describe, it, expect } from "vitest";
import { askFor, removedRef } from "@/domain/asks";

const W = "WALLETPUBKEYAAAA";
const at = new Date("2026-11-05T10:00:00Z");
const base = { walletsEver: 1, withdrawals: 0, removedWallets: [] as { wallet: string; at: Date }[], answered: [] as { question: string; ref: string }[] };

describe("askFor", () => {
  it("asks about a wallet the user removed, until it is answered with the same ref", () => {
    const a = { ...base, removedWallets: [{ wallet: W, at }] };
    expect(askFor(a)).toEqual({ question: "wallet_removed", ref: `${W}:2026-11-05` });
    expect(removedRef(W, at)).toBe(`${W}:2026-11-05`);
    expect(askFor({ ...a, answered: [{ question: "wallet_removed", ref: removedRef(W, at) }] })).toBeNull();
  });
  it("asks about the newest unanswered removal", () => {
    const newer = new Date("2026-11-07T10:00:00Z");
    const a = { ...base, removedWallets: [{ wallet: W, at }, { wallet: "OTHERWALLET", at: newer }] };
    expect(askFor(a)?.ref).toBe("OTHERWALLET:2026-11-07");
    expect(askFor({ ...a, answered: [{ question: "wallet_removed", ref: "OTHERWALLET:2026-11-07" }] })?.ref).toBe(`${W}:2026-11-05`);
  });
  it("asks nothing when the list holds no user removal (a Sprouts stop is not asked)", () => {
    expect(askFor(base)).toBeNull();
  });
  it("asks brought_you of a user who unstaked without ever linking a wallet, once", () => {
    const a = { ...base, walletsEver: 0, withdrawals: 1 };
    expect(askFor(a)).toEqual({ question: "brought_you", ref: "brought_you" });
    expect(askFor({ ...a, answered: [{ question: "brought_you", ref: "brought_you" }] })).toBeNull();
  });
  it("does not ask brought_you of a user who has a wallet, or has not withdrawn", () => {
    expect(askFor({ ...base, withdrawals: 1 })).toBeNull();
    expect(askFor({ ...base, walletsEver: 0 })).toBeNull();
  });
  it("asks about a user revoke only within 14 days", () => {
    const now = new Date("2026-11-20T10:00:00Z");
    const old = { wallet: W, at: new Date("2026-11-05T09:00:00Z") }; // 15 days
    expect(askFor({ ...base, removedWallets: [old], now })).toBeNull();
    expect(askFor({ ...base, walletsEver: 0, withdrawals: 1, removedWallets: [old], now })?.question).toBe("brought_you");
    expect(askFor({ ...base, removedWallets: [{ wallet: W, at: new Date("2026-11-07T10:00:00Z") }], now })?.question).toBe("wallet_removed");
  });
});
