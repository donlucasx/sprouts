"use client";
import { useState } from "react";
import { call } from "../call";
import { useWallets, WalletButtons } from "../wallet-picker";
import { connectWith, signWith, type StdWallet } from "@/lib/wallet-choice";

const box = { fontFamily: "system-ui, sans-serif", maxWidth: 520, margin: "10vh auto", padding: "0 24px", lineHeight: 1.5, color: "#2B2B2B" } as const;

/** The laptop side of "another wallet": the code from the app, one approval with the wallet the user picks, the API sends it. */
export default function LinkPage() {
  const [code, setCode] = useState("");
  const [state, setState] = useState<"idle" | "busy" | "done">("idle");
  const [message, setMessage] = useState<string>("");
  const wallets = useWallets();

  async function approve(w: StdWallet) {
    setState("busy");
    setMessage("");
    try {
      const account = await connectWith(w);
      const wallet = account.address;
      const c = code.trim().toUpperCase();
      const t = await call<{ transaction: string; cap: number; revokes: string | null }>(`/api/link/${c}?wallet=${wallet}`);
      const signed = await signWith(w, account, t.transaction);
      const done = await call<{ skrName: string | null }>("/api/link/confirm", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: c, wallet, signedTransaction: signed }),
      });
      setMessage(`Linked${done.skrName ? ` to ${done.skrName}'s garden` : ""}. This wallet's swaps now round up into your garden, at most $${(t.cap / 100).toFixed(2)} a day.${t.revokes ? " The previous approval was revoked." : ""} You can close this page and go back to the app.`);
      setState("done");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Something did not go through. Nothing moved.");
      setState("idle");
    }
  }

  return (
    <main style={box}>
      <h1 style={{ fontSize: 28, marginBottom: 8 }}>Link a wallet to Sprouts</h1>
      <p>
        Enter the code from the app, then approve once with your wallet. Sprouts may pull up to $5 of USDC a day from this wallet, only what your swaps rounded up. You can revoke at any time. Under a dollar of rent, refunded when you revoke. The underlying approval is unlimited; the program enforces the limit.
      </p>
      <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="CODE" maxLength={6} autoCapitalize="characters" style={{ fontSize: 28, letterSpacing: 6, padding: 12, width: 220, textTransform: "uppercase" }} />
      <div style={{ marginTop: 16 }}>
        {state === "done" ? null : state === "busy" ? <p>Waiting for your wallet.</p> : <WalletButtons wallets={wallets} verb="Approve with" disabled={code.trim().length !== 6} onPick={approve} />}
      </div>
      {message ? <p style={{ marginTop: 16, fontWeight: state === "done" ? 600 : 400, color: state === "done" ? "#2F5D3A" : undefined }}>{message}</p> : null}
      <p style={{ marginTop: 32, fontSize: 14, color: "#555" }}>
        To revoke later: <a href="/revoke">the revoke page</a> on this site, with the wallet that approved.
      </p>
    </main>
  );
}
