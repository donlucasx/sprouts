import { fromUint8Array, type SignInPayload } from "@wallet-ui/react-native-kit";
import { api } from "./api";
import type { Session } from "./session";

type SignInInput = { domain: string; address?: string; statement: string; uri: string; version: string; chainId: string; nonce: string; issuedAt: string; expirationTime: string };

const toBase64 = (bytes: Uint8Array) => fromUint8Array(bytes); // the kit's base64, never btoa on bytes [A22]

/**
 * The verified sign-in (spec 4): the server issues the payload with its domain and a single-use nonce; the wallet signs it;
 * the server verifies, checks the Genesis Token, and answers with a session. One fingerprint.
 */
export async function signInWithSeeker(signIn: (payload: SignInPayload) => Promise<{ account: { address: string }; signedMessage: Uint8Array; signature: Uint8Array }>): Promise<Session> {
  const input = await api<SignInInput>("/api/auth/nonce", { method: "POST", body: {}, auth: false });
  const output = await signIn({ ...input, chainId: "solana:mainnet" } as SignInPayload);
  const address = output.account.address;
  const verified = await api<{ token: string; skrName: string | null }>("/api/auth/verify", {
    method: "POST", auth: false,
    body: { input: { ...input, address }, output: { address, signedMessage: toBase64(output.signedMessage), signature: toBase64(output.signature) } },
  });
  return { token: verified.token, pubkey: address, skrName: verified.skrName };
}
