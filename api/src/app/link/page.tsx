"use client";
import { useState } from "react";
import { phantom, signWithPhantom, call } from "../phantom";

const box = { fontFamily: "system-ui, sans-serif", maxWidth: 520, margin: "10vh auto", padding: "0 24px", lineHeight: 1.5, color: "#2B2B2B" } as const;

/** The laptop side of "another wallet": the code from the app, one approval with Phantom, the API sends it. */
export default function LinkPage() {
  const [code, setCode] = useState("");
  const [state, setState] = useState<"idle" | "busy" | "done">("idle");
  const [message, setMessage] = useState<string>("");

  async function approve() {
    setState("busy");
    setMessage("");
    try {
      const p = phantom();
      if (!p) throw new Error("Install Phantom in this browser, then try again.");
      const wallet = (await p.connect()).publicKey.toBase58();
      const c = code.trim().toUpperCase();
      const t = await call<{ transaction: string; cap: number; revokes: string | null }>(`/api/link/${c}?wallet=${wallet}`);
      const signed = await signWithPhantom(t.transaction);
      const done = await call<{ skrName: string | null }>("/api/link/confirm", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: c, wallet, signedTransaction: signed }),
      });
      setMessage(`Linked to ${done.skrName ?? "your Seeker"}'s Sprouts, limit $${(t.cap / 100).toFixed(2)} a day.${t.revokes ? " The previous approval was revoked." : ""}`);
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
        Enter the code from the app, then approve once with Phantom. Sprouts may pull up to $5 of USDC a day from this wallet, only what your swaps rounded up. You can revoke at any time. Under a dollar of rent, refunded when you revoke. The underlying approval is unlimited; the program enforces the limit.
      </p>
      <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="CODE" maxLength={6} autoCapitalize="characters" style={{ fontSize: 28, letterSpacing: 6, padding: 12, width: 220, textTransform: "uppercase" }} />
      <div style={{ marginTop: 16 }}>
        <button disabled={state !== "idle" || code.trim().length !== 6} onClick={approve} style={{ fontSize: 18, padding: "12px 20px" }}>
          {state === "busy" ? "Waiting for Phantom" : "Approve with Phantom"}
        </button>
      </div>
      {message ? <p style={{ marginTop: 16 }}>{message}</p> : null}
      <p style={{ marginTop: 32, fontSize: 14, color: "#555" }}>
        To revoke later: <a href="/revoke">sprouts-api-gamma.vercel.app/revoke</a>.
      </p>
    </main>
  );
}
