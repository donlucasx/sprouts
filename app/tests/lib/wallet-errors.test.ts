import { describe, it, expect } from "vitest";
import { DROPPED_NOTHING_SENT, isSessionDropped, isWalletDeclined, SIGN_IN_DID_NOT_FINISH } from "@/lib/wallet-errors";

// The two errors the Saga showed on 10-06 (audits/signin-drop): Solflare tore its session down after the user approved (no reply),
// versus a wallet that answered "no".
const dropped = Object.assign(new Error("java.util.concurrent.CancellationException"), { name: "SolanaMobileWalletAdapterError" });
const declined = Object.assign(new Error("authorization request failed"), { code: -1 });

describe("isSessionDropped / isWalletDeclined", () => {
  it("a session the wallet closed without answering is a drop, not a decline", () => {
    expect(isSessionDropped(dropped)).toBe(true);
    expect(isWalletDeclined(dropped)).toBe(false);
  });
  it("the wallet's own no (-1, a closed sheet, cancelled by user) is a decline, never a drop", () => {
    for (const e of [declined, Object.assign(new Error("x"), { code: "ERROR_ASSOCIATION_CANCELLED" }), new Error("cancelled by user")]) {
      expect(isWalletDeclined(e)).toBe(true);
      expect(isSessionDropped(e)).toBe(false);
    }
  });
  it("anything else is neither", () => {
    for (const e of [new Error("Network request failed"), null, "CancellationException as a string is not an Error"]) {
      expect(isSessionDropped(e)).toBe(false);
      expect(isWalletDeclined(e)).toBe(false);
    }
  });
});

// Neither line may claim which happened: the wallets send a cancel and a lost approval alike (device tests, 10-06).
describe("the copy after a wallet ends without a signature", () => {
  it("never says the wallet closed or that the user declined", () => {
    for (const line of [DROPPED_NOTHING_SENT, SIGN_IN_DID_NOT_FINISH]) expect(line).not.toMatch(/closed before answering|declined|did not sign\. Try again, or/);
    expect(SIGN_IN_DID_NOT_FINISH).toBe("Sign-in didn't finish in your wallet. Tap Sign in to try again.");
    expect(DROPPED_NOTHING_SENT).toBe("Your wallet didn't sign, so nothing was sent. Try again.");
  });
});
