import { fromUint8Array, type SignInPayload } from "@wallet-ui/react-native-kit";
import { api } from "./api";
import type { Session } from "./session";

type SignInInput = { domain: string; address?: string; statement: string; uri: string; version: string; chainId: string; nonce: string; issuedAt: string; expirationTime: string };

const toBase64 = (bytes: Uint8Array) => fromUint8Array(bytes); // the kit's base64, never btoa on bytes [A22]

export type SignInFn = (payload: SignInPayload) => Promise<{ account: { address: string }; signedMessage: Uint8Array; signature: Uint8Array }>;
/** What the API verifies: the payload it issued (with the address the wallet filled) and the wallet's signature over it. */
export type SignedIn = { input: SignInInput & { address: string }; output: { address: string; signedMessage: string; signature: string } };

/** One fingerprint: the server's nonce, rendered and signed by the Seed Vault Wallet. The API verifies and consumes the nonce once. */
export async function freshSignIn(signIn: SignInFn): Promise<SignedIn> {
  const input = await api<SignInInput>("/api/auth/nonce", { method: "POST", body: {}, auth: false });
  const output = await signIn({ ...input, chainId: "solana:mainnet" } as SignInPayload);
  const address = output.account.address;
  return { input: { ...input, address }, output: { address, signedMessage: toBase64(output.signedMessage), signature: toBase64(output.signature) } };
}

/**
 * The verified sign-in (spec 4): the server issues the payload with its domain and a single-use nonce; the wallet signs it;
 * the server verifies, checks the Genesis Token, and answers with a session. One fingerprint.
 */
export async function signInWithSeeker(signIn: SignInFn): Promise<Session> {
  const signed = await freshSignIn(signIn);
  const verified = await api<{ token: string; skrName: string | null }>("/api/auth/verify", { method: "POST", auth: false, body: signed });
  return { token: verified.token, pubkey: signed.output.address, skrName: verified.skrName };
}
