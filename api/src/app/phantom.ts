"use client";
import { VersionedTransaction } from "@solana/web3.js";
import { getBase64Encoder, getBase64Decoder } from "@solana/kit";

type Provider = { isPhantom?: boolean; connect(): Promise<{ publicKey: { toBase58(): string } }>; signTransaction(tx: VersionedTransaction): Promise<VersionedTransaction> };

/** The programs an approval or a revoke may touch; anything else is refused before Phantom is asked [A10]. */
const ALLOWED = new Set([
  "De1egAFMkMWZSN5rYXRj9CAdheBamobVNubTsi9avR44", // Subscriptions
  "11111111111111111111111111111111", // System
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", // Token
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL", // Associated Token
  "ComputeBudget111111111111111111111111111111",
]);

/** Phantom's injected provider, or null when the extension is not there. */
export function phantom(): Provider | null {
  const w = window as unknown as { phantom?: { solana?: Provider }; solana?: Provider };
  const p = w.phantom?.solana ?? w.solana;
  return p?.isPhantom ? p : null;
}

/** The API built the transaction; Phantom signs it; the API sends it. Every program id is checked before Phantom is asked. */
export async function signWithPhantom(base64: string): Promise<string> {
  const p = phantom();
  if (!p) throw new Error("Phantom is not installed in this browser.");
  const tx = VersionedTransaction.deserialize(new Uint8Array(getBase64Encoder().encode(base64)));
  const keys = tx.message.staticAccountKeys.map((k) => k.toBase58());
  for (const ix of tx.message.compiledInstructions) {
    if (!ALLOWED.has(keys[ix.programIdIndex])) throw new Error("This approval touches a program Sprouts does not use. Nothing was signed.");
  }
  const signed = await p.signTransaction(tx);
  return getBase64Decoder().decode(signed.serialize());
}

/** One fetch for the pages: JSON out, the API's own sentence on failure. */
export async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(path, init);
  const j = (await r.json().catch(() => ({}))) as T & { error?: string };
  if (!r.ok) throw new Error(j.error ?? `Request failed (${r.status}).`);
  return j;
}
