"use client";
import { useState } from "react";
import { call } from "../call";
import { useWallets, WalletButtons } from "../wallet-picker";
import { connectWith, signWith, type StdAccount, type StdWallet } from "@/lib/wallet-choice";

const box = { fontFamily: "system-ui, sans-serif", maxWidth: 520, margin: "10vh auto", padding: "0 24px", lineHeight: 1.5, color: "#2B2B2B" } as const;

/** Revoke with the wallet that approved: Sprouts' authority leaves the chain and the wallet is left with no delegate. */
export default function RevokePage() {
  const [picked, setPicked] = useState<{ w: StdWallet; account: StdAccount } | null>(null);
  const wallets = useWallets();
  const wallet = picked?.account.address ?? null;
  const [state, setState] = useState<"idle" | "busy" | "done">("idle");
  const [message, setMessage] = useState<string>("");

  async function connect(w: StdWallet) {
    setMessage("");
    try {
      setPicked({ w, account: await connectWith(w) });
    } catch (e) {
      setMessage(e instanceof Error ? e.message : `Could not connect ${w.name}.`);
    }
  }

  async function revoke() {
    if (!picked || !wallet) return;
    setState("busy");
    setMessage("");
    try {
      const t = await call<{ transaction: string | null }>(`/api/revoke/${wallet}`);
      if (!t.transaction) throw new Error("This wallet has nothing to revoke.");
      const signed = await signWith(picked.w, picked.account, t.transaction);
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
        <WalletButtons wallets={wallets} verb="Connect" onPick={connect} />
      ) : (
        <div style={{ marginTop: 8 }}>
          <p style={{ fontSize: 14, color: "#555" }}>{wallet.slice(0, 4)}...{wallet.slice(-4)}</p>
          <button disabled={state !== "idle"} onClick={revoke} style={{ fontSize: 18, padding: "12px 20px" }}>{state === "busy" ? "Waiting for your wallet" : "Revoke"}</button>
        </div>
      )}
      {message ? <p style={{ marginTop: 16 }}>{message}</p> : null}
    </main>
  );
}
