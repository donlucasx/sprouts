"use client";
import { useState } from "react";
import { call } from "../call";
import { useWallets, WalletButtons } from "../wallet-picker";
import { connectWith, signWith, type StdAccount, type StdWallet } from "@/lib/wallet-choice";
import { Albert_Sans, Outfit } from "next/font/google";
import { SiteFooter, SiteHeader } from "../site-chrome";

/** His ask 10-23: branded like /link (paper, ink, leaf, Outfit + Albert Sans), with the shared header and footer. */
const outfit = Outfit({ subsets: ["latin"], weight: ["600"] });
const albert = Albert_Sans({ subsets: ["latin"], weight: ["400", "600"] });
const paper = "#FFFBF5", ink = "#2B2622", muted = "#7A746B", leaf = "#1E6B44";

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
    <main className={`rv ${albert.className}`}>
      <style>{`
        .rv { min-height: 100svh; background: ${paper}; color: ${ink}; display: grid; grid-template-rows: auto 1fr auto; line-height: 1.5; }
        .rv-col { width: 100%; max-width: 440px; margin: 0 auto; padding: 6vh 24px 8vh; display: grid; justify-items: center; text-align: center; gap: 14px; align-content: start; }
        .rv h1 { font-size: clamp(28px, 7vw, 36px); font-weight: 600; letter-spacing: -0.02em; line-height: 1.15; }
        .rv-sub { color: ${muted}; font-size: 16px; margin-bottom: 10px; }
        .rv button { font: inherit !important; font-size: 16px !important; font-weight: 600 !important; padding: 13px 22px !important; border-radius: 999px; border: 1.5px solid ${leaf};
          background: ${leaf}; color: #fff; cursor: pointer; min-width: 220px; justify-content: center; }
        .rv button:disabled { opacity: .35; cursor: default; }
        .rv-row > div { align-items: center !important; }
        .rv-note { color: ${muted}; font-size: 14px; }
        .rv-wallet { font-size: 15px; font-weight: 600; letter-spacing: .02em; }
        .rv-done { color: ${leaf}; font-weight: 600; }
      `}</style>
      <SiteHeader />
      <div className="rv-col">
        <h1 className={outfit.className}>Revoke Sprouts</h1>
        <p className="rv-sub">Connect the wallet you linked, then revoke. Sprouts loses its approval on that wallet, on chain. Everything Sprouts planted stays in your wallet.</p>
        {!wallet ? (
          <div className="rv-row"><WalletButtons wallets={wallets} verb="Connect" onPick={connect} /></div>
        ) : (
          <>
            <p className="rv-wallet">{wallet.slice(0, 4)}...{wallet.slice(-4)}</p>
            {state === "done" ? null : <button disabled={state !== "idle"} onClick={revoke}>{state === "busy" ? "Waiting for your wallet" : "Revoke"}</button>}
          </>
        )}
        {message ? <p className={state === "done" ? "rv-done" : "rv-note"}>{message}</p> : null}
        <p className="rv-note" style={{ marginTop: 18 }}>You can also revoke in the app, in Settings.</p>
      </div>
      <SiteFooter />
    </main>
  );
}
