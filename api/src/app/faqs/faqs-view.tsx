import type { ReactNode } from "react";
import { Albert_Sans, Outfit } from "next/font/google";
import { Safety } from "../safety";
import { SiteFooter, SiteHeader } from "../site-chrome";

/**
 * His ask 10-23: "faqs should be its own page with the subtle header instead of below the splash page". The can / can't card that sat
 * under the splash, then the app's answers (app/src/lib/settings-copy.ts HOW_IT_WORKS and DISCLOSURES), cut to the web's length;
 * change the facts there first.
 */
const outfit = Outfit({ subsets: ["latin"], weight: ["600"] });
const albert = Albert_Sans({ subsets: ["latin"], weight: ["400", "600"] });
const paper = "#FFFBF5", ink = "#2B2622", muted = "#7A746B", leaf = "#1E6B44", rule = "#E6DFD2";


// His asks 10-28: a permissions answer holding the can / can't card, next to what Sprouts buys; "How do I stop it?" friendlier and shorter;
// "The list is fixed in code" cut. 11-20: "How does it work?" and "What does it cost?" say the app's words (app settings-copy.test.ts checks).
const QA: [string, ReactNode][] = [
  ["How does it work?", "Every swap you make rounds up to the next dollar. Once a day, Sprouts plants that change into your split, using USDC from the wallet that made the swap. What it buys stays in your own wallet."],
  ["What can Sprouts buy?", "SKR, staked under your Seeker's key. stORE, which keeps mining ORE. hSOL and cbBTC. USDC and SOL lending at Kamino or Jupiter Lend, with the receipt in your wallet."],
  ["What permission does Sprouts need?", <>
    When you link a wallet, you approve Sprouts&apos; on-chain program to use the USDC in it. Your wallet shows this as an &quot;unlimited
    USDC&quot; approval. The program caps it at $5 a day, and only into your own garden, less a 0.5% fee.
    <div style={{ marginTop: 14 }}><Safety ink={ink} muted={muted} leaf={leaf} rule={rule} intro={false} /></div>
  </>],
  ["What does it cost?", "Sprouts takes 0.5% of each planting, in USDC, including USDC and SOL lending. Sprouts takes nothing on interest, withdrawals or moves, and pays the network fee for every planting."],
  ["Can I pause or stop it?", <>
    Any time. Turn Sprouts off at the top of Rules and nothing moves until you turn it back on. To unlink a wallet, revoke it in Settings
    or <a href="/revoke" style={{ color: leaf }}>on the web</a>. What you&apos;ve planted stays yours, and you can withdraw it whenever you like.
  </>],
];

/**
 * 0.1.13 Spanish pass P9: the same answers in Spanish, for a browser that prefers Spanish. The first and the cost answer are the app's
 * es lines (about.how, about.cost); app/tests/lib/safety-copy.test.ts checks they match.
 */
const QA_ES: [string, ReactNode][] = [
  ["¿Cómo funciona?", "Cada swap que haces se redondea al siguiente dólar. Una vez al día, Sprouts planta ese cambio en tu reparto, con USDC de la billetera que hizo el swap. Lo que compra se queda en tu propia billetera."],
  ["¿Qué puede comprar Sprouts?", "SKR, en staking con la clave de tu Seeker. stORE, que sigue minando ORE. hSOL y cbBTC. Préstamos de USDC y SOL en Kamino o Jupiter Lend, con el recibo en tu billetera."],
  ["¿Qué permiso necesita Sprouts?", <>
    Cuando vinculas una billetera, apruebas que el programa on-chain de Sprouts use el USDC que tiene. Tu billetera lo muestra como una
    aprobación de &quot;USDC ilimitado&quot;. El programa la limita a $5 al día, y solo hacia tu propio jardín, menos una comisión del 0,5%.
    <div style={{ marginTop: 14 }}><Safety ink={ink} muted={muted} leaf={leaf} rule={rule} intro={false} lang="es" /></div>
  </>],
  ["¿Cuánto cuesta?", "Sprouts cobra el 0,5% de cada plantación, en USDC, incluido el préstamo de USDC y SOL. Sprouts no cobra nada sobre intereses, retiros ni movimientos, y paga la comisión de red de cada plantación."],
  ["¿Puedo pausarlo o detenerlo?", <>
    Cuando quieras. Apaga Sprouts arriba en Reglas y nada se mueve hasta que lo vuelvas a encender. Para desvincular una billetera, revócala en Ajustes
    o <a href="/revoke" style={{ color: leaf }}>en la web</a>. Lo que plantaste sigue siendo tuyo, y puedes retirarlo cuando quieras.
  </>],
];

/** The page for one language (English exactly as before). */
export function FaqsView({ lang = "en" }: { lang?: "en" | "es" }) {
  const qa = lang === "es" ? QA_ES : QA;
  return (
    <main className={`fq ${albert.className}`} lang={lang}>
      <style>{`
        .fq { min-height: 100svh; background: ${paper}; color: ${ink}; display: grid; grid-template-rows: auto 1fr auto; line-height: 1.5; }
        .fq-col { width: 100%; max-width: 440px; margin: 0 auto; padding: 4vh 24px 8vh; display: grid; gap: 40px; align-content: start; }
        .fq h1 { font-size: clamp(28px, 7vw, 36px); font-weight: 600; letter-spacing: -0.02em; line-height: 1.15; text-align: center; }
        .fq dl { display: grid; gap: 22px; font-size: 15px; }
        .fq dt { font-weight: 600; margin-bottom: 4px; }
        .fq dd { margin: 0; color: ${ink}; }
        .fq-note { font-size: 13px; color: ${muted}; text-align: center; }
      `}</style>
      <SiteHeader />
      <div className="fq-col">
        <h1 className={outfit.className}>{lang === "es" ? "Preguntas frecuentes" : "FAQs"}</h1>
        <dl>
          {qa.map(([q, a]) => (
            <div key={q}>
              <dt>{q}</dt>
              <dd>{a}</dd>
            </div>
          ))}
        </dl>
        {lang === "es"
          ? <p className="fq-note">Sprouts no es asesoría fiscal ni de inversión. Las reglas completas están en los <a href="/terms" style={{ color: leaf }}>Términos</a> (en inglés).</p>
          : <p className="fq-note">Sprouts is not tax or investment advice. The full rules are in the <a href="/terms" style={{ color: leaf }}>Terms</a>.</p>}
      </div>
      <SiteFooter lang={lang} />
    </main>
  );
}
