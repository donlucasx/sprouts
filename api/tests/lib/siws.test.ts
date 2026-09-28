import { describe, it, expect, beforeAll } from "vitest";
import { generateKeyPairSigner, signBytes, getUtf8Encoder } from "@solana/kit";
import { createSignInPayload, renderSignInMessage, verifySignIn } from "@/lib/siws";

beforeAll(() => {
  process.env.APP_ORIGIN ??= "https://sprouts.money";
});

describe("sign-in with Solana", () => {
  it("builds a payload for the app's domain with the nonce and a ten-minute expiry", () => {
    const p = createSignInPayload({ nonce: "abc123" });
    expect(p.domain).toBe("sprouts.money");
    expect(p.nonce).toBe("abc123");
    expect(new Date(p.expirationTime).getTime() - new Date(p.issuedAt).getTime()).toBe(10 * 60_000);
    expect(p.statement).toBe("Sign in to Sprouts. No transaction, no fee.");
  });

  it("accepts a message signed by the address in the payload and rejects another key", async () => {
    const signer = await generateKeyPairSigner();
    const other = await generateKeyPairSigner();
    const input = createSignInPayload({ address: signer.address, nonce: "abc123" });
    const message = new Uint8Array(getUtf8Encoder().encode(renderSignInMessage(input)));
    const good = new Uint8Array(await signBytes(signer.keyPair.privateKey, message));
    expect((await verifySignIn({ input, output: { address: signer.address, signedMessage: message, signature: good } })).ok).toBe(true);
    const bad = new Uint8Array(await signBytes(other.keyPair.privateKey, message));
    expect((await verifySignIn({ input, output: { address: signer.address, signedMessage: message, signature: bad } })).ok).toBe(false);
  });

  // Review I2: the server pins domain, uri, statement and expiry; a message a phishing page had the user sign for its own
  // domain, carrying a fresh Sprouts nonce, must not verify.
  it("rejects a correctly signed message for another domain", async () => {
    const signer = await generateKeyPairSigner();
    const input = { ...createSignInPayload({ address: signer.address, nonce: "abc123" }), domain: "evil.example", uri: "https://evil.example" };
    const message = new Uint8Array(getUtf8Encoder().encode(renderSignInMessage(input)));
    const signature = new Uint8Array(await signBytes(signer.keyPair.privateKey, message));
    expect((await verifySignIn({ input, output: { address: signer.address, signedMessage: message, signature } })).ok).toBe(false);
  });

  it("rejects a correctly signed message whose statement was changed", async () => {
    const signer = await generateKeyPairSigner();
    const input = { ...createSignInPayload({ address: signer.address, nonce: "abc123" }), statement: "Approve unlimited spending." };
    const message = new Uint8Array(getUtf8Encoder().encode(renderSignInMessage(input)));
    const signature = new Uint8Array(await signBytes(signer.keyPair.privateKey, message));
    expect((await verifySignIn({ input, output: { address: signer.address, signedMessage: message, signature } })).ok).toBe(false);
  });

  it("rejects a correctly signed message that has expired", async () => {
    const signer = await generateKeyPairSigner();
    const input = createSignInPayload({ address: signer.address, nonce: "abc123", now: new Date(Date.now() - 11 * 60_000) });
    const message = new Uint8Array(getUtf8Encoder().encode(renderSignInMessage(input)));
    const signature = new Uint8Array(await signBytes(signer.keyPair.privateKey, message));
    expect((await verifySignIn({ input, output: { address: signer.address, signedMessage: message, signature } })).ok).toBe(false);
  });

  it("rejects a signature that is not 64 bytes", async () => {
    const signer = await generateKeyPairSigner();
    const input = createSignInPayload({ address: signer.address, nonce: "abc123" });
    const message = new Uint8Array(getUtf8Encoder().encode(renderSignInMessage(input)));
    expect((await verifySignIn({ input, output: { address: signer.address, signedMessage: message, signature: new Uint8Array(10) } })).ok).toBe(false);
  });
});
