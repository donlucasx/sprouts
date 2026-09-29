"use client";
import { useState } from "react";
import { phantom, signWithPhantom, call } from "../phantom";

const box = { fontFamily: "system-ui, sans-serif", maxWidth: 520, margin: "10vh auto", padding: "0 24px", lineHeight: 1.5, color: "#2B2B2B" } as const;

/** Revoke with the wallet that approved: Sprouts' authority leaves the chain and the wallet is left with no delegate. */
export default function RevokePage() {
  const [wallet, setWallet] = useState<string | null>(null);
  const [state, setState] = useState<"idle" | "busy" | "done">("idle");
  const [message, setMessage] = useState<string>("");

  async function connect() {
    setMessage("");
    try {
      const p = phantom();
      if (!p) throw new Error("Install Phantom in this browser, then try again.");
      setWallet((await p.connect()).publicKey.toBase58());
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Could not connect Phantom.");
    }
  }

  async function revoke() {
    if (!wallet) return;
    setState("busy");
    setMessage("");
    try {
      const t = await call<{ transaction: string | null }>(`/api/revoke/${wallet}`);
      if (!t.transaction) throw new Error("This wallet has nothing to revoke.");
      const signed = await signWithPhantom(t.transaction);
      await call<{ revoked: boolean }>(`/api/revoke/${wallet}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ signedTransaction: signed }) });
      setMessage("Revoked. This wallet has no delegate. Nothing in your garden moved.");
      setState("done");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "The revoke did not go through. Try again.");
      setState("idle");
    }
  }

  return (
    <main style={box}>
      <h1 style={{ fontSize: 28, marginBottom: 8 }}>Revoke Sprouts</h1>
      <p>Connect the wallet that approved Sprouts, then revoke. This removes Sprouts&apos; authority on chain and refunds the rent. Your garden stays where it is, locked to your Seeker.</p>
      {!wallet ? (
        <button onClick={connect} style={{ fontSize: 18, padding: "12px 20px" }}>Connect Phantom</button>
      ) : (
        <div style={{ marginTop: 8 }}>
          <p style={{ fontSize: 14, color: "#555" }}>{wallet.slice(0, 4)}...{wallet.slice(-4)}</p>
          <button disabled={state !== "idle"} onClick={revoke} style={{ fontSize: 18, padding: "12px 20px" }}>{state === "busy" ? "Waiting for Phantom" : "Revoke"}</button>
        </div>
      )}
      {message ? <p style={{ marginTop: 16 }}>{message}</p> : null}
    </main>
  );
}
