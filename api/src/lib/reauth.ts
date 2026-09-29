import { z } from "zod";
import type { Repo } from "@/db/repo";
import { verifySignIn, type SignInInput } from "./siws";

/** A fresh Seed Vault sign-in carried by a sensitive write (R84): the nonce the server issued, signed by the Seeker's key. */
export const ReauthSchema = z.object({
  input: z.object({
    domain: z.string(), address: z.string().optional(), statement: z.string(), uri: z.string(), version: z.string(),
    chainId: z.string(), nonce: z.string(), issuedAt: z.string(), expirationTime: z.string(),
  }),
  output: z.object({ address: z.string().min(32).max(44), signedMessage: z.string(), signature: z.string() }),
});
export type Reauth = z.infer<typeof ReauthSchema>;

/**
 * Raising the daily limit and resuming a paused wallet are the two writes a session alone must not do (R84): they need one
 * fingerprint, proved the same way sign-in is proved, with a single-use nonce. `what` names the action for the sentence.
 */
export async function verifyReauth(repo: Repo, pubkey: string, reauth: Reauth | undefined, what: string): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!reauth) return { ok: false, error: `${what} asks your Seeker to sign in again.` };
  if (reauth.output.address !== pubkey) return { ok: false, error: "That sign-in is for another Seeker." };
  const signedMessage = new Uint8Array(Buffer.from(reauth.output.signedMessage, "base64"));
  const signature = new Uint8Array(Buffer.from(reauth.output.signature, "base64"));
  const verified = await verifySignIn({ input: reauth.input as SignInInput, output: { address: pubkey, signedMessage, signature } });
  if (!verified.ok) return { ok: false, error: "The sign-in did not verify. Try again." };
  if (!(await repo.useNonce(reauth.input.nonce, pubkey))) return { ok: false, error: "This sign-in request expired. Try again." };
  return { ok: true };
}
