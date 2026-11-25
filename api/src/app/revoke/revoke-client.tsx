"use client";
import { useState } from "react";
import { call } from "../call";
import { useWallets, WalletButtons } from "../wallet-picker";
import { connectWith, signWith, type StdAccount, type StdWallet } from "@/lib/wallet-choice";
import { Albert_Sans, Outfit } from "next/font/google";
import { SiteFooter, SiteHeader } from "../site-chrome";
import type { Lang } from "@/lib/i18n";

/** His ask 10-23: branded like /link (paper, ink, leaf, Outfit + Albert Sans), with the shared header and footer. */
const outfit = Outfit({ subsets: ["latin"], weight: ["600"] });
const albert = Albert_Sans({ subsets: ["latin"], weight: ["400", "600"] });
const paper = "#FFFBF5", ink = "#2B2622", muted = "#7A746B", leaf = "#1E6B44";

/** 0.1.13 Spanish pass P9: the page's lines in English (as they always were) and Spanish; API refusals follow the browser too. */
const COPY = {
  en: {
    cantConnect: (name: string) => `Could not connect ${name}.`,
    nothing: "This wallet has nothing to revoke.",
    done: "Revoked. This wallet has no delegate. Nothing in your garden moved.",
    failed: "The revoke did not go through. Try again.",
    title: "Revoke Sprouts",
    sub: "Connect the wallet you linked, then revoke. Sprouts loses its approval on that wallet, on chain. Everything Sprouts planted stays in your wallet.",
    connect: "Connect",
    waiting: "Waiting for your wallet",
    revoke: "Revoke",
    inApp: "You can also revoke in the app, in Settings.",
  },
  es: {
    cantConnect: (name: string) => `No se pudo conectar ${name}.`,
    nothing: "Esta billetera no tiene nada que revocar.",
    done: "Revocada. Esta billetera no tiene delegado. No se movió nada de tu jardín.",
    failed: "La revocación no se completó. Inténtalo de nuevo.",
    title: "Revocar Sprouts",
    sub: "Conecta la billetera que vinculaste y luego revoca. Sprouts pierde su aprobación en esa billetera, on-chain. Todo lo que Sprouts plantó se queda en tu billetera.",
    connect: "Conectar",
    waiting: "Esperando a tu billetera",
    revoke: "Revocar",
    inApp: "También puedes revocar en la app, en Ajustes.",
  },
} as const;

/** Revoke with the wallet that approved: Sprouts' authority leaves the chain and the wallet is left with no delegate. */
export function RevokeClient({ lang = "en" }: { lang?: Lang }) {
  const L = COPY[lang];
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
      setMessage(e instanceof Error ? e.message : L.cantConnect(w.name));
    }
  }

  async function revoke() {
    if (!picked || !wallet) return;
    setState("busy");
    setMessage("");
    try {
      const t = await call<{ transaction: string | null }>(`/api/revoke/${wallet}`);
      if (!t.transaction) throw new Error(L.nothing);
      const signed = await signWith(picked.w, picked.account, t.transaction);
      await call<{ revoked: boolean }>(`/api/revoke/${wallet}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ signedTransaction: signed }) });
      setMessage(L.done);
      setState("done");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : L.failed);
      setState("idle");
    }
  }

  return (
    <main className={`rv ${albert.className}`} lang={lang}>
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
        <h1 className={outfit.className}>{L.title}</h1>
        <p className="rv-sub">{L.sub}</p>
        {!wallet ? (
          <div className="rv-row"><WalletButtons wallets={wallets} verb={L.connect} onPick={connect} lang={lang} /></div>
        ) : (
          <>
            <p className="rv-wallet">{wallet.slice(0, 4)}...{wallet.slice(-4)}</p>
            {state === "done" ? null : <button disabled={state !== "idle"} onClick={revoke}>{state === "busy" ? L.waiting : L.revoke}</button>}
          </>
        )}
        {message ? <p className={state === "done" ? "rv-done" : "rv-note"}>{message}</p> : null}
        <p className="rv-note" style={{ marginTop: 18 }}>{L.inApp}</p>
      </div>
      <SiteFooter lang={lang} />
    </main>
  );
}
