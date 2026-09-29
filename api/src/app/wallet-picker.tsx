"use client";
import { useEffect, useState } from "react";
import { getWallets } from "@wallet-standard/app";
import { eligibleWallets, type StdWallet } from "@/lib/wallet-choice";

/** The Solana wallets installed in this browser (Wallet Standard), kept current as extensions register. */
export function useWallets(): StdWallet[] {
  const [list, setList] = useState<StdWallet[]>([]);
  useEffect(() => {
    const { get, on } = getWallets();
    const refresh = () => setList(eligibleWallets(get() as unknown as StdWallet[]));
    refresh();
    const offs = [on("register", refresh), on("unregister", refresh)];
    return () => offs.forEach((off) => off());
  }, []);
  return list;
}

/** One button per installed wallet; the user picks, nothing guesses. */
export function WalletButtons(props: { wallets: StdWallet[]; verb: string; disabled?: boolean; onPick(w: StdWallet): void }) {
  if (!props.wallets.length) return <p>No Solana wallet found in this browser. Install Phantom or Solflare, then reload this page.</p>;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-start" }}>
      {props.wallets.map((w) => (
        <button key={w.name} disabled={props.disabled} onClick={() => props.onPick(w)} style={{ fontSize: 18, padding: "10px 16px", display: "flex", alignItems: "center", gap: 10 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={w.icon} alt="" width={24} height={24} />
          {props.verb} {w.name}
        </button>
      ))}
    </div>
  );
}
