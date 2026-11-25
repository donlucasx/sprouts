"use client";
import { useState } from "react";
import { Albert_Sans, Outfit } from "next/font/google";
import { call } from "../call";
import { useWallets, WalletButtons } from "../wallet-picker";
import { connectWith, signWith, type StdWallet } from "@/lib/wallet-choice";
import { ApprovalWarning, Safety } from "../safety";
import { SiteFooter, SiteHeader } from "../site-chrome";
import { safetyCopy } from "@/lib/link-safety-copy";
import type { Lang } from "@/lib/i18n";

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
function shortOfUsdc(raw: string | null | undefined, needCents: number | undefined, lang: Lang = "en"): string | null {
  if (raw == null || needCents == null) return null;
  const haveCents = Number(BigInt(raw) / 10_000n);
  if (haveCents >= needCents) return null;
  if (lang === "es") return COPY.es.shortOfUsdc(usdEs(haveCents), usdEs(needCents));
  return `This wallet has $${(haveCents / 100).toFixed(2)} of USDC. Sprouts pays for every planting with USDC from this wallet, so add at least $${(needCents / 100).toFixed(2)} to start planting.`;
}

/** "$1.234,50" from cents (his ruling 11-25: Spanish separators, US dollars). */
const usdEs = (cents: number) => `$${(cents / 100).toFixed(2).replace(".", ",").replace(/\B(?=(\d{3})+(?!\d))/g, ".")}`;

/**
 * 0.1.13 Spanish pass P9: the page's own lines in English (as they always were) and Spanish. The can / can't card and the approval
 * warning come from lib/link-safety-copy (the app's lines, drift-tested). API refusals arrive in the browser's language too, since
 * the browser sends Accept-Language with every call.
 */
const COPY = {
  en: {
    cantCheck: "That code could not be checked. Try again.",
    ownerChanged: (now: string, was: string) => `This code now links to ${now}, not ${was}. Nothing was signed. Check the code again.`,
    linked: (short: string, skrName: string | null, cap: number, revokes: boolean) =>
      `Your ${short} wallet is linked${skrName ? ` to ${skrName}'s garden` : ""}, up to $${cap.toFixed(0)} a day.${revokes ? " The old approval was revoked." : ""} You can close this page. To link another wallet, get a new code in the Sprouts app.`,
    failed: "Something did not go through. Nothing moved.",
    title: "Link your trading wallets",
    sub: "Phantom, Solflare, Backpack or any Solana wallet. Link as many as you like, one code each. Each one pays its round-ups from its own USDC.",
    placeholder: "CODE",
    codeLabel: "Code from the Sprouts app",
    waitingWallet: "Waiting for your wallet.",
    checking: "Checking the code.",
    cont: "Continue",
    getCode: "Get a code in the Sprouts app: Link a wallet, then Another wallet.",
    linksTo: (owner: string) => <>This links your wallet to {owner}&apos;s garden.</>,
    notYou: <>If that&apos;s not you, or someone sent you this code, stop here.</>,
    isMe: (owner: string) => <>{owner} is me</>,
    cancel: "Cancel",
    linkingTo: (owner: string) => <>Linking to {owner}&apos;s garden.</>,
    approveWith: "Approve with",
    doubleCheck: <>Want to double-check? Your wallet&apos;s approval should name this Sprouts program:</>,
  },
  es: {
    shortOfUsdc: (have: string, need: string) => `Esta billetera tiene ${have} en USDC. Sprouts paga cada plantación con USDC de esta billetera, así que agrégale al menos ${need} para empezar a plantar.`,
    cantCheck: "No se pudo revisar ese código. Inténtalo de nuevo.",
    ownerChanged: (now: string, was: string) => `Este código ahora vincula a ${now}, no a ${was}. No se firmó nada. Revisa el código otra vez.`,
    linked: (short: string, skrName: string | null, cap: number, revokes: boolean) =>
      `Tu billetera ${short} quedó vinculada${skrName ? ` al jardín de ${skrName}` : ""}, hasta $${cap.toFixed(0)} al día.${revokes ? " Se revocó la aprobación anterior." : ""} Puedes cerrar esta página. Para vincular otra billetera, pide un código nuevo en la app de Sprouts.`,
    failed: "Algo no se completó. No se movió nada.",
    title: "Vincula tus billeteras de trading",
    sub: "Phantom, Solflare, Backpack o cualquier billetera de Solana. Vincula todas las que quieras, un código para cada una. Cada una paga sus redondeos con su propio USDC.",
    placeholder: "CÓDIGO",
    codeLabel: "Código de la app de Sprouts",
    waitingWallet: "Esperando a tu billetera.",
    checking: "Revisando el código.",
    cont: "Continuar",
    getCode: "Pide un código en la app de Sprouts: Vincular una billetera y luego Otra billetera.",
    linksTo: (owner: string) => <>Esto vincula tu billetera al jardín de {owner}.</>,
    notYou: <>Si no eres tú, o si alguien te envió este código, detente aquí.</>,
    isMe: (owner: string) => <>Soy {owner}</>,
    cancel: "Cancelar",
    linkingTo: (owner: string) => <>Vinculando al jardín de {owner}.</>,
    approveWith: "Aprobar con",
    doubleCheck: <>¿Quieres comprobarlo? La aprobación de tu billetera debería nombrar este programa de Sprouts:</>,
  },
} as const;

export function LinkClient({ lang = "en" }: { lang?: Lang }) {
  const L = COPY[lang];
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
      setMessage(e instanceof Error ? e.message : L.cantCheck);
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
      if (t.owner !== owner) throw new Error(L.ownerChanged(t.owner, owner));
      // After go-live the delegate is leashPda(wallet, garden), shown before the wallet is asked so it can be compared with the app's
      // re-link card (contracts 5.5, Kimi #4); the signer refuses an approval naming any other delegate.
      setLeash(t.delegatee !== t.puller ? t.delegatee : null);
      const signed = await signWith(w, account, t.transaction, t.delegatee);
      const done = await call<{ skrName: string | null }>("/api/link/confirm", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: c, wallet, signedTransaction: signed }),
      });
      // 11-12 (his note): name the wallet that was linked, and say the page can be closed.
      const short = `${wallet.slice(0, 4)}...${wallet.slice(-4)}`;
      setMessage(L.linked(short, done.skrName, t.cap / 100, !!t.revokes));
      setUsdcNote(shortOfUsdc(t.usdcRaw, t.usdcNeedCents, lang));
      setState("done");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : L.failed);
      setState("idle");
    }
  }

  return (
    <main className={`lk ${albert.className}`} lang={lang}>
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
        <h1 className={outfit.className}>{L.title}</h1>
        <p className="lk-sub">{L.sub}</p>

        <input className={`lk-code ${outfit.className}`} value={code} onChange={(e) => edit(e.target.value)} disabled={state !== "idle"} placeholder={L.placeholder}
          maxLength={6} autoCapitalize="characters" aria-label={L.codeLabel} />

        {state === "done" ? null : state === "busy" ? <p className="lk-note">{owner ? L.waitingWallet : L.checking}</p> : !owner ? (
          <>
            <button disabled={c.length !== 6} onClick={check}>{L.cont}</button>
            <p className="lk-note">{L.getCode}</p>
          </>
        ) : !confirmed ? (
          <>
            <p style={{ fontWeight: 600 }}>{L.linksTo(owner)}</p>
            <p className="lk-note">{L.notYou}</p>
            <div className="lk-row">
              <button onClick={() => setConfirmed(true)}>{L.isMe(owner)}</button>
              <button className="lk-quiet" onClick={() => edit("")}>{L.cancel}</button>
            </div>
          </>
        ) : (
          <>
            <p className="lk-note">{L.linkingTo(owner)}</p>
            <ApprovalWarning ink={ink} attention="#7A6248" lang={lang} />
            <div className="lk-row"><WalletButtons wallets={wallets} verb={L.approveWith} onPick={approve} lang={lang} /></div>
          </>
        )}

        {/* 11-12 (his note "I wouldnt know what to do w this info"): only while the wallet is asked, and said as an optional check */}
        {leash && state !== "done" ? (
          <p className="lk-note">
            {L.doubleCheck}<br />
            <code style={{ wordBreak: "break-all" }}>{leash}</code>
          </p>
        ) : null}
        {message ? <p className={state === "done" ? "lk-done" : "lk-note"}>{message}</p> : null}
        {state === "done" && usdcNote ? <p className="lk-usdc">{usdcNote}</p> : null}

        {/* his ask 10-22: the boundaries open, before any wallet is asked (was a collapsed details) */}
        {/* his ask 10-28: the app's Link a wallet copy and format */}
        <div style={{ marginTop: 28, width: "100%" }}><Safety ink={ink} muted={muted} leaf={leaf} rule={rule} intro={false} heading={safetyCopy(lang).heading} lang={lang} /></div>
      </div>
      <SiteFooter lang={lang} />
    </main>
  );
}
