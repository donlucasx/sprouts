import type { Metadata } from "next";
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

export const metadata: Metadata = { title: "Sprouts: FAQs", description: "How Sprouts works, what permission it needs, what it costs, and how to pause or stop it." };

// His asks 10-28: a permissions answer holding the can / can't card, next to what Sprouts buys; "How do I stop it?" friendlier and shorter;
// "The list is fixed in code" cut.
const QA: [string, ReactNode][] = [
  ["How does it work?", "Each swap you make rounds up to the next dollar. Once a day Sprouts plants that change into your split, paid from the USDC in your linked wallet. Everything it buys stays in your own wallet."],
  ["What can Sprouts buy?", "SKR, staked under your Seeker's key. stORE, which keeps mining ORE. hSOL and cbBTC. USDC and SOL lending at Kamino or Jupiter Lend, with the receipt in your wallet."],
  ["What permission does Sprouts need?", <>
    When you link a wallet, you approve Sprouts&apos; on-chain program to use the USDC in it. Your wallet shows this as an &quot;unlimited
    USDC&quot; approval. The program caps it at $5 a day, and only into your own garden.
    <div style={{ marginTop: 14 }}><Safety ink={ink} muted={muted} leaf={leaf} rule={rule} intro={false} /></div>
  </>],
  ["What does it cost?", "0.5% of each SKR, stORE, hSOL and cbBTC planting, in USDC, inside the swap. No fee on USDC or SOL lending, and nothing on interest, withdrawals or moves. Sprouts pays the network fee."],
  ["Can I pause or stop it?", <>
    Any time. Turn Sprouts off at the top of Rules and nothing moves until you turn it back on. To unlink a wallet, revoke it in Settings
    or <a href="/revoke" style={{ color: leaf }}>on the web</a>. What you&apos;ve planted stays yours, and you can withdraw it whenever you like.
  </>],
];

export default function Faqs() {
  return (
    <main className={`fq ${albert.className}`}>
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
        <h1 className={outfit.className}>FAQs</h1>
        <dl>
          {QA.map(([q, a]) => (
            <div key={q}>
              <dt>{q}</dt>
              <dd>{a}</dd>
            </div>
          ))}
        </dl>
        <p className="fq-note">Sprouts is not tax or investment advice. The full rules are in the <a href="/terms" style={{ color: leaf }}>Terms</a>.</p>
      </div>
      <SiteFooter />
    </main>
  );
}
