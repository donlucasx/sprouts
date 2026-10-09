import { describe, it, expect, vi } from "vitest";

// The kit re-exports js-base64; node's Buffer stands in for it here. The session module touches the secure store; only its id is needed.
vi.mock("@wallet-ui/react-native-kit", () => ({
  fromUint8Array: (b: Uint8Array) => Buffer.from(b).toString("base64"),
  toUint8Array: (s: string) => new Uint8Array(Buffer.from(s, "base64")),
}));
vi.mock("@/lib/session", () => ({ installationId: vi.fn(async () => "test-device") }));
vi.mock("@/lib/api", () => ({
  api: vi.fn(async () => ({ domain: "sprouts.money", statement: "Sign in to Sprouts.", uri: "https://sprouts.money", version: "1", chainId: "solana:mainnet", nonce: "abc123", issuedAt: "2026-09-29T16:00:00Z", expirationTime: "2026-09-29T16:10:00Z" })),
}));

import { freshSignIn, signInWithSeeker, unwrapBase64Text } from "@/lib/signin";
import { api } from "@/lib/api";

const sig = new Uint8Array(64).map((_, i) => (i * 37 + 200) % 256); // real signature bytes, some above 127
const message = new TextEncoder().encode("sprouts.money wants you to sign in with your Solana account:\nDjRp\n\nSign in to Sprouts.\n\nNonce: abc123");
/** What wallet-ui 4.3.0 hands back: the UTF-8 bytes of the wallet's base64 text (its stringToUint8Array is a TextEncoder). */
const asWalletUi = (b: Uint8Array) => new TextEncoder().encode(Buffer.from(b).toString("base64"));
const decode = (s: string) => new Uint8Array(Buffer.from(s, "base64"));

describe("unwrapBase64Text", () => {
  it("undoes wallet-ui's text encoding of the wallet's base64 fields", () => {
    expect(unwrapBase64Text(asWalletUi(sig))).toEqual(sig);
    expect(unwrapBase64Text(asWalletUi(message))).toEqual(message);
  });
  it("undoes the adapter's unpadded URL-safe base64 too (the fallback path when the wallet has no native sign-in; the Saga, 2026-09-29)", () => {
    const asFallback = (b: Uint8Array) => new TextEncoder().encode(Buffer.from(b).toString("base64url"));
    expect(asFallback(message).length % 4).not.toBe(0);
    expect(unwrapBase64Text(asFallback(message))).toEqual(message);
    expect(unwrapBase64Text(asFallback(sig))).toEqual(sig);
  });
  it("leaves real bytes alone", () => {
    expect(unwrapBase64Text(sig)).toBe(sig);
    expect(unwrapBase64Text(message)).toBe(message);
    expect(unwrapBase64Text(new Uint8Array())).toEqual(new Uint8Array());
  });
});

describe("freshSignIn", () => {
  it("posts the wallet's real signature when wallet-ui hands back base64 text as bytes (the Saga 'Bad signature', 2026-09-29)", async () => {
    const r = await freshSignIn(async () => ({ account: { address: "DjRp" }, signedMessage: asWalletUi(message), signature: asWalletUi(sig) }));
    expect(decode(r.output.signature)).toEqual(sig);
    expect(decode(r.output.signedMessage)).toEqual(message);
    expect(r.input.address).toBe("DjRp");
  });
  it("posts real bytes unchanged when the wallet library already decoded them", async () => {
    const r = await freshSignIn(async () => ({ account: { address: "DjRp" }, signedMessage: message, signature: sig }));
    expect(decode(r.output.signature)).toEqual(sig);
    expect(decode(r.output.signedMessage)).toEqual(message);
  });
});

describe("signInWithSeeker (R283: the Terms are accepted at sign-in)", () => {
  it("sends the Terms version with the verify call", async () => {
    await signInWithSeeker(async () => ({ account: { address: "DjRp" }, signedMessage: message, signature: sig }));
    const verify = vi.mocked(api).mock.calls.find((c) => c[0] === "/api/auth/verify");
    expect((verify?.[1] as { body: { termsVersion?: string } }).body.termsVersion).toBe("2026-10-09");
  });
});

// 10-06 (audits/signin-drop): a cold, locked Solflare tears the session down after the user approves; the immediate retry works.
describe("freshSignIn retries once when the wallet drops the session", () => {
  const dropped = () => Object.assign(new Error("java.util.concurrent.CancellationException"), { name: "SolanaMobileWalletAdapterError" });
  const ok = { account: { address: "DjRp" }, signedMessage: message, signature: sig };

  it("a drop, then a fresh nonce and one more wallet request, which signs", async () => {
    vi.mocked(api).mockClear();
    const signIn = vi.fn().mockRejectedValueOnce(dropped()).mockResolvedValueOnce(ok);
    const r = await freshSignIn(signIn);
    expect(signIn).toHaveBeenCalledTimes(2);
    expect(vi.mocked(api).mock.calls.filter(([path]) => path === "/api/auth/nonce")).toHaveLength(2);   // the retry signs a new nonce
    expect(r.output.address).toBe("DjRp");
  });
  it("two drops: the second one is thrown, no third request", async () => {
    const signIn = vi.fn().mockRejectedValue(dropped());
    await expect(freshSignIn(signIn)).rejects.toThrow("CancellationException");
    expect(signIn).toHaveBeenCalledTimes(2);
  });
  it("a real decline is never retried", async () => {
    const signIn = vi.fn().mockRejectedValue(Object.assign(new Error("authorization request failed"), { code: -1 }));
    await expect(freshSignIn(signIn)).rejects.toThrow("authorization request failed");
    expect(signIn).toHaveBeenCalledTimes(1);
  });
});
