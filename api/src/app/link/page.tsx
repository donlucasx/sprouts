"use client";
import { useState } from "react";
import { Albert_Sans, Outfit } from "next/font/google";
import { call } from "../call";
import { useWallets, WalletButtons } from "../wallet-picker";
import { connectWith, signWith, type StdWallet } from "@/lib/wallet-choice";
import { Safety } from "../safety";
import { SiteFooter, SiteHeader } from "../site-chrome";

/** 10-16 (his note "too much text, simplify, and brand the page"): the splash's paper, ink and Outfit, the deck's leaf green and Albert Sans. */
const outfit = Outfit({ subsets: ["latin"], weight: ["300", "600"] });
const albert = Albert_Sans({ subsets: ["latin"], weight: ["400", "600"] });
const ART = "/site/link-mandarin-s14.mp4?v=2";
const paper = "#FFFBF5", ink = "#2B2622", muted = "#7A746B", leaf = "#1E6B44", rule = "#E6DFD2";

/**
 * The laptop side of "another wallet": the code from the app, one approval with the wallet the user picks, the API sends it.
 * Security R207 #5: the page first says whose garden the code links into and waits for "this is me" before any wallet is asked,
 * so a code someone else sent ("enter ABC123 to get the airdrop") shows their name, not a bare approval for "Sprouts".
 */
/**
 * 10-26 (Kimi user-comms D): a wallet linked with too little USDC pauses on its first planting, and the "another wallet" path never
 * said so. Null when there is enough, or when the API could not read the balance (no note rather than a wrong one).
 */
function shortOfUsdc(raw: string | null | undefined, needCents: number | undefined): string | null {
  if (raw == null || needCents == null) return null;
  const haveCents = Number(BigInt(raw) / 10_000n);
  if (haveCents >= needCents) return null;
  return `This wallet has $${(haveCents / 100).toFixed(2)} of USDC. Sprouts pays for every planting with USDC from this wallet, so add at least $${(needCents / 100).toFixed(2)} to start planting.`;
}

export default function LinkPage() {
  const [code, setCode] = useState("");
  const [owner, setOwner] = useState<string | null>(null);   // whose garden the checked code links into
  const [confirmed, setConfirmed] = useState(false);          // the user said the owner is them
  const [state, setState] = useState<"idle" | "busy" | "done">("idle");
  const [message, setMessage] = useState<string>("");
  const [leash, setLeash] = useState<string | null>(null);    // contracts 5.5: the leash PDA this wallet's delegation names (after go-live)
  const [usdcNote, setUsdcNote] = useState<string | null>(null); // 10-26: the linked wallet holds less USDC than its first planting needs
  const wallets = useWallets();
  const c = code.trim().toUpperCase();

  function edit(value: string) {
    setCode(value);
    setOwner(null);
    setConfirmed(false);
    setMessage("");
    setLeash(null);
    setUsdcNote(null);
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
      const t = await call<{ transaction: string; cap: number; revokes: string | null; owner: string; puller: string; delegatee: string; usdcRaw?: string | null; usdcNeedCents?: number }>(`/api/link/${c}?wallet=${wallet}`);
      if (t.owner !== owner) throw new Error(`This code now links to ${t.owner}, not ${owner}. Nothing was signed. Check the code again.`);
      // After go-live the delegate is leashPda(wallet, garden), shown before the wallet is asked so it can be compared with the app's
      // re-link card (contracts 5.5, Kimi #4); the signer refuses an approval naming any other delegate.
      setLeash(t.delegatee !== t.puller ? t.delegatee : null);
      const signed = await signWith(w, account, t.transaction, t.delegatee);
      const done = await call<{ skrName: string | null }>("/api/link/confirm", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: c, wallet, signedTransaction: signed }),
      });
      setMessage(`Linked${done.skrName ? ` to ${done.skrName}'s garden` : ""}, up to $${(t.cap / 100).toFixed(0)} a day.${t.revokes ? " The old approval was revoked." : ""} To link another wallet, get a new code in the app.`);
      setUsdcNote(shortOfUsdc(t.usdcRaw, t.usdcNeedCents));
      setState("done");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Something did not go through. Nothing moved.");
      setState("idle");
    }
  }

  return (
    <main className={`lk ${albert.className}`}>
      <style>{`
        .lk { min-height: 100svh; background: ${paper}; color: ${ink}; display: grid; grid-template-rows: auto 1fr auto; line-height: 1.5; }
        .lk-col { width: 100%; max-width: 440px; margin: 0 auto; padding: 2vh 24px 24px; display: grid; justify-items: center; text-align: center; gap: 14px; align-content: center; }
        .lk-art { width: min(52vw, 200px); aspect-ratio: 1; object-fit: contain; object-position: center bottom; mix-blend-mode: multiply; }
        .lk h1 { font-size: clamp(28px, 7vw, 36px); font-weight: 600; letter-spacing: -0.02em; line-height: 1.15; margin-top: 6px; }
        .lk-sub { color: ${muted}; font-size: 16px; }
        .lk-code { font-size: 30px; letter-spacing: .3em; text-align: center; text-transform: uppercase; width: 100%; max-width: 280px; padding: 14px 12px 14px calc(12px + .3em);
          border: 1.5px solid ${rule}; border-radius: 16px; background: #fff; color: ${ink}; outline: none; margin-top: 10px; }
        .lk-code:focus { border-color: ${leaf}; }
        .lk button { font: inherit !important; font-size: 16px !important; font-weight: 600 !important; padding: 13px 22px !important; border-radius: 999px; border: 1.5px solid ${leaf};
          background: ${leaf}; color: #fff; cursor: pointer; min-width: 220px; justify-content: center; }
        .lk button:disabled { opacity: .35; cursor: default; }
        .lk button.lk-quiet { background: transparent; color: ${leaf}; }
        .lk-row { display: flex; flex-wrap: wrap; gap: 10px; justify-content: center; }
        .lk-row > div { align-items: center !important; }
        .lk-note { color: ${muted}; font-size: 14px; }
        .lk details { color: ${muted}; font-size: 14px; max-width: 360px; }
        .lk summary { cursor: pointer; color: ${leaf}; font-weight: 600; list-style: none; }
        .lk summary::-webkit-details-marker { display: none; }
        .lk details p { margin-top: 8px; text-align: left; }
        .lk-done { color: ${leaf}; font-weight: 600; }
        .lk-usdc { background: #FFF1D6; border-radius: 14px; padding: 12px 16px; font-size: 15px; max-width: 360px; }
      `}</style>
      {/* his ask 10-23: the shared header (the mark moved up into it) and footer */}
      <SiteHeader />
      <div className="lk-col">
        {/* his ask 10-22: one of the garden's mandarin idle loops (brand/garden2/idle/final) in place of the still */}
        <video className="lk-art" src={ART} autoPlay loop muted playsInline aria-hidden="true" />
        <h1 className={outfit.className}>Link your trading wallets</h1>
        <p className="lk-sub">Phantom, Solflare, Backpack or any Solana wallet. Link as many as you like, one code each. Each one pays its round-ups from its own USDC.</p>

        <input className={`lk-code ${outfit.className}`} value={code} onChange={(e) => edit(e.target.value)} disabled={state !== "idle"} placeholder="CODE"
          maxLength={6} autoCapitalize="characters" aria-label="Code from the Sprouts app" />

        {state === "done" ? null : state === "busy" ? <p className="lk-note">{owner ? "Waiting for your wallet." : "Checking the code."}</p> : !owner ? (
          <>
            <button disabled={c.length !== 6} onClick={check}>Continue</button>
            <p className="lk-note">Get a code in the Sprouts app: Link a wallet, then Another wallet.</p>
          </>
        ) : !confirmed ? (
          <>
            <p style={{ fontWeight: 600 }}>This links your wallet to {owner}&apos;s garden.</p>
            <p className="lk-note">If that&apos;s not you, or someone sent you this code, stop here.</p>
            <div className="lk-row">
              <button onClick={() => setConfirmed(true)}>{owner} is me</button>
              <button className="lk-quiet" onClick={() => edit("")}>Cancel</button>
            </div>
          </>
        ) : (
          <>
            <p className="lk-note">Linking to {owner}&apos;s garden.</p>
            <div className="lk-row"><WalletButtons wallets={wallets} verb="Approve with" onPick={approve} /></div>
          </>
        )}

        {leash ? (
          <p className="lk-note">
            Your wallet should name this Sprouts program:<br />
            <code style={{ wordBreak: "break-all" }}>{leash}</code>
          </p>
        ) : null}
        {message ? <p className={state === "done" ? "lk-done" : "lk-note"}>{message}</p> : null}
        {state === "done" && usdcNote ? <p className="lk-usdc">{usdcNote}</p> : null}

        {/* his ask 10-22: the boundaries open, before any wallet is asked (was a collapsed details) */}
        <div style={{ marginTop: 28 }}><Safety ink={ink} muted={muted} leaf={leaf} rule={rule} /></div>
      </div>
      <SiteFooter />
    </main>
  );
}
