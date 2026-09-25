import { createKeyPairSignerFromPrivateKeyBytes, type KeyPairSigner } from "@solana/kit";
import { config } from "./config";

let cached: KeyPairSigner | null = null;

/** The puller: the hot key that pulls, swaps and stakes. Its private key lives only in the env (32 bytes, base64url). */
export async function pullerSigner(): Promise<KeyPairSigner> {
  if (cached) return cached;
  const bytes = Buffer.from(config().pullerSecretKey, "base64url");
  if (bytes.length !== 32) throw new Error("PULLER_SECRET_KEY must be 32 bytes, base64url");
  cached = await createKeyPairSignerFromPrivateKeyBytes(new Uint8Array(bytes));
  return cached;
}
