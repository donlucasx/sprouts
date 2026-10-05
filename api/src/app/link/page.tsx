"use client";
import { useState } from "react";
import { call } from "../call";
import { useWallets, WalletButtons } from "../wallet-picker";
import { connectWith, signWith, type StdWallet } from "@/lib/wallet-choice";

const box = { fontFamily: "system-ui, sans-serif", maxWidth: 520, margin: "10vh auto", padding: "0 24px", lineHeight: 1.5, color: "#2B2B2B" } as const;

/**
 * The laptop side of "another wallet": the code from the app, one approval with the wallet the user picks, the API sends it.
 * Security R207 #5: the page first says whose garden the code links into and waits for "this is me" before any wallet is asked,
 * so a code someone else sent ("enter ABC123 to get the airdrop") shows their name, not a bare approval for "Sprouts".
 */
export default function LinkPage() {
  const [code, setCode] = useState("");
  const [owner, setOwner] = useState<string | null>(null);   // whose garden the checked code links into
  const [confirmed, setConfirmed] = useState(false);          // the user said the owner is them
  const [state, setState] = useState<"idle" | "busy" | "done">("idle");
  const [message, setMessage] = useState<string>("");
  const [leash, setLeash] = useState<string | null>(null);    // contracts 5.5: the leash PDA this wallet's delegation names (after go-live)
  const wallets = useWallets();
  const c = code.trim().toUpperCase();

  function edit(value: string) {
    setCode(value);
    setOwner(null);
    setConfirmed(false);
    setMessage("");
    setLeash(null);
  }

  async function check() {
    setState("busy");
    setMessage("");
    try {
      setOwner((await call<{ owner: string }>(`/api/link/${c}`)).owner);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "That code could not be checked. Try again.");
    }
    setState("idle");
  }

  async function approve(w: StdWallet) {
    if (!owner || !confirmed) return;
    setState("busy");
    setMessage("");
    try {
      const account = await connectWith(w);
      const wallet = account.address;
      const t = await call<{ transaction: string; cap: number; revokes: string | null; owner: string; puller: string; delegatee: string }>(`/api/link/${c}?wallet=${wallet}`);
      if (t.owner !== owner) throw new Error(`This code now links to ${t.owner}, not ${owner}. Nothing was signed. Check the code again.`);
      // After go-live the delegate is leashPda(wallet, garden), shown before the wallet is asked so it can be compared with the app's
      // re-link card (contracts 5.5, Kimi #4); the signer refuses an approval naming any other delegate.
      setLeash(t.delegatee !== t.puller ? t.delegatee : null);
      const signed = await signWith(w, account, t.transaction, t.delegatee);
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
        Enter the code from your Sprouts app, check whose garden it links to, then approve once with your wallet. Sprouts may pull up to $5 of USDC a day from this wallet, only what your swaps rounded up. You can revoke at any time. Under a dollar of rent, refunded when you revoke. The underlying approval is unlimited; the program enforces the limit.
      </p>
      <input value={code} onChange={(e) => edit(e.target.value)} disabled={state !== "idle"} placeholder="CODE" maxLength={6} autoCapitalize="characters" style={{ fontSize: 28, letterSpacing: 6, padding: 12, width: 220, textTransform: "uppercase" }} />
      <div style={{ marginTop: 16 }}>
        {state === "done" ? null : state === "busy" ? <p>{owner ? "Waiting for your wallet." : "Checking the code."}</p> : !owner ? (
          <button disabled={c.length !== 6} onClick={check} style={{ fontSize: 18, padding: "10px 16px" }}>Check the code</button>
        ) : !confirmed ? (
          <div>
            <p style={{ fontWeight: 600 }}>This links your wallet to {owner}&apos;s garden. Only continue if {owner} is you.</p>
            <p>If someone sent you this code, stop here. Their garden would get this wallet&apos;s round-ups.</p>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => setConfirmed(true)} style={{ fontSize: 18, padding: "10px 16px" }}>{owner} is me</button>
              <button onClick={() => edit("")} style={{ fontSize: 18, padding: "10px 16px" }}>Cancel</button>
            </div>
          </div>
        ) : (
          <div>
            <p>Linking to {owner}&apos;s garden.</p>
            <WalletButtons wallets={wallets} verb="Approve with" onPick={approve} />
          </div>
        )}
      </div>
      {leash ? (
        <p style={{ marginTop: 16, fontSize: 14 }}>
          Your delegation names this Sprouts program address, not a Sprouts server key.<br />
          <code style={{ wordBreak: "break-all" }}>{leash}</code>
        </p>
      ) : null}
      {message ? <p style={{ marginTop: 16, fontWeight: state === "done" ? 600 : 400, color: state === "done" ? "#2F5D3A" : undefined }}>{message}</p> : null}
      <p style={{ marginTop: 32, fontSize: 14, color: "#555" }}>
        To revoke later: <a href="/revoke">the revoke page</a> on this site, with the wallet that approved.
      </p>
    </main>
  );
}
