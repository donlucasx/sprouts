import { fromUint8Array, toUint8Array, type SignInPayload } from "@wallet-ui/react-native-kit";
import { api } from "./api";
import { installationId, type Session } from "./session";

type SignInInput = { domain: string; address?: string; statement: string; uri: string; version: string; chainId: string; nonce: string; issuedAt: string; expirationTime: string };

const toBase64 = (bytes: Uint8Array) => fromUint8Array(bytes); // the kit's base64, never btoa on bytes [A22]

const BASE64_TEXT = /^[A-Za-z0-9+/_-]+={0,2}$/;
/**
 * The protocol hands the sign-in result's signature and signed message as base64 text; wallet-ui 4.3.0 turns each into the UTF-8
 * bytes of that text (its stringToUint8Array is a TextEncoder), so the server saw an 88-byte "signature" (the Saga, 2026-09-29).
 * Undo that when it happened and leave real bytes alone: 64 signature bytes are never all base64 characters, and a sign-in
 * message holds spaces and colons. A wrong guess cannot pass: the server still verifies the signature over the message.
 */
export function unwrapBase64Text(bytes: Uint8Array): Uint8Array {
  if (bytes.length === 0 || bytes.length % 4 !== 0) return bytes;
  let text = "";
  for (const b of bytes) {
    if (b > 127) return bytes;
    text += String.fromCharCode(b);
  }
  return BASE64_TEXT.test(text) ? toUint8Array(text) : bytes;
}

export type SignInFn = (payload: SignInPayload) => Promise<{ account: { address: string }; signedMessage: Uint8Array; signature: Uint8Array }>;
/** What the API verifies: the payload it issued (with the address the wallet filled) and the wallet's signature over it. */
export type SignedIn = { input: SignInInput & { address: string }; output: { address: string; signedMessage: string; signature: string } };

/** One fingerprint: the server's nonce, rendered and signed by the Seed Vault Wallet. The API verifies and consumes the nonce once. */
export async function freshSignIn(signIn: SignInFn): Promise<SignedIn> {
  const input = await api<SignInInput>("/api/auth/nonce", { method: "POST", body: {}, auth: false });
  const output = await signIn({ ...input, chainId: "solana:mainnet" } as SignInPayload);
  const address = output.account.address;
  return { input: { ...input, address }, output: { address, signedMessage: toBase64(unwrapBase64Text(output.signedMessage)), signature: toBase64(unwrapBase64Text(output.signature)) } };
}

/**
 * The verified sign-in (spec 4): the server issues the payload with its domain and a single-use nonce; the wallet signs it;
 * the server verifies, checks the Genesis Token, and answers with a session. One fingerprint.
 */
export async function signInWithSeeker(signIn: SignInFn): Promise<Session> {
  const signed = await freshSignIn(signIn);
  const verified = await api<{ token: string; skrName: string | null }>("/api/auth/verify", { method: "POST", auth: false, body: { ...signed, device: await installationId() } });
  return { token: verified.token, pubkey: signed.output.address, skrName: verified.skrName };
}
