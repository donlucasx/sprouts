import { describe, it, expect, vi } from "vitest";

// 09-29 Saga: a re-sign-in inside the app (raising the limit, resuming a wallet) failed with "-1/authorization request failed":
// the kit's signIn re-authorizes with the saved auth token plus the sign-in payload, which Solflare declines, and its retry
// without the token in the same session is declined too. The first sign-in (no token) works. The re-sign-in now asks exactly that.
const calls: Record<string, unknown>[] = [];
vi.mock("@wallet-ui/react-native-kit", () => ({
  transact: async (fn: (w: unknown) => Promise<unknown>) => fn({
    authorize: async (a: Record<string, unknown>) => {
      calls.push(a);
      return { accounts: [{ address: "AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyA=" }], auth_token: "new", sign_in_result: { address: "x", signed_message: "bXNn", signature: "c2ln" } };
    },
  }),
  stringToUint8Array: (s: string) => new TextEncoder().encode(s),
}));

describe("freshWalletSignIn", () => {
  it("asks the wallet for a fresh authorization with no saved token, and returns the account and the signed bytes", async () => {
    const { freshWalletSignIn } = await import("@/lib/reauth");
    const identity = { name: "Sprouts", uri: "https://sprouts.money" };
    const out = await freshWalletSignIn(identity)({ domain: "sprouts.money", nonce: "n" } as never);
    expect(calls).toEqual([{ chain: "solana:mainnet", identity, sign_in_payload: { domain: "sprouts.money", nonce: "n" } }]);
    expect(Object.keys(calls[0])).not.toContain("auth_token");
    expect(out.account.address).toBe("4wBqpZM9xaSheZzJSMawUKKwhdpChKbZ5eu5ky4Vigw");
    expect(new TextDecoder().decode(out.signedMessage)).toBe("bXNn");
    expect(new TextDecoder().decode(out.signature)).toBe("c2ln");
  });
});
