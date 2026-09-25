import { getBase58Encoder } from "@solana/kit";
import { createSignInMessageText, verifySignIn as verifySignInStandard } from "@solana/wallet-standard-util";
import { config } from "./config";

export type SignInInput = {
  domain: string;
  address?: string;
  statement: string;
  uri: string;
  version: string;
  chainId: string;
  nonce: string;
  issuedAt: string;
  expirationTime: string;
};

export type SignInOutput = { address: string; signedMessage: Uint8Array; signature: Uint8Array };

const TEN_MINUTES = 10 * 60_000;

/** The server-issued sign-in payload: our domain, a single-use nonce, a ten-minute window. The wallet renders and signs it. */
export function createSignInPayload(a: { address?: string; nonce: string; now?: Date }): SignInInput {
  const now = a.now ?? new Date();
  const origin = new URL(config().appOrigin);
  return {
    domain: origin.host,
    ...(a.address ? { address: a.address } : {}),
    statement: "Sign in to Sprouts. No transaction, no fee.",
    uri: origin.origin,
    version: "1",
    chainId: "solana:mainnet",
    nonce: a.nonce,
    issuedAt: now.toISOString(),
    expirationTime: new Date(now.getTime() + TEN_MINUTES).toISOString(),
  };
}

/** The exact text the wallet signs (the Sign-In-With-Solana message format). */
export function renderSignInMessage(input: SignInInput): string {
  if (!input.address) throw new Error("renderSignInMessage needs the address");
  return createSignInMessageText({ ...input, address: input.address });
}

/**
 * Verify a sign-in: the public key is derived from the address itself, never taken from the client; the signature must be
 * exactly 64 bytes; the signed message must match the payload we issued.
 */
export async function verifySignIn(a: { input: SignInInput; output: SignInOutput }): Promise<{ ok: boolean; address: string }> {
  const { input, output } = a;
  if (output.signature.length !== 64 || output.signedMessage.length === 0) return { ok: false, address: output.address };
  try {
    const publicKey = new Uint8Array(getBase58Encoder().encode(output.address));
    const ok = verifySignInStandard(input, {
      account: { address: output.address, publicKey, chains: ["solana:mainnet"], features: [] },
      signedMessage: output.signedMessage,
      signature: output.signature,
    });
    return { ok, address: output.address };
  } catch {
    return { ok: false, address: output.address };
  }
}
