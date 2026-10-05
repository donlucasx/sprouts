import type { Metadata } from "next";
import { Outfit, Albert_Sans } from "next/font/google";

/** R316: the one-screen brief for the Solana Mobile / Radiants team (R314, R315), a temporary page until the site becomes the deck. */

const outfit = Outfit({ subsets: ["latin"], weight: ["500", "600"], variable: "--font-display" });
const albert = Albert_Sans({ subsets: ["latin"], weight: ["400", "600"], variable: "--font-body" });

const LEAD =
  "Your Seeker's spare change, planted. Every swap rounds up into SKR and stORE that only your Seed Vault can unlock, and an AI yield manager grows the rest in lending. Watch your garden grow. Withdraw any time."; // R354

export const metadata: Metadata = {
  title: "Sprouts brief",
  description: "Round-ups into SKR that your Seeker keeps and a yield manager grows.",
  openGraph: {
    title: "Sprouts brief",
    description: "Round-ups into SKR that your Seeker keeps and a yield manager grows.",
    url: "https://sprouts.money/brief",
    siteName: "Sprouts",
    type: "website",
    images: [{ url: "https://sprouts.money/og.png", width: 1200, height: 630, alt: "Sprouts" }],
  },
  twitter: { card: "summary_large_image", images: ["https://sprouts.money/og.png"] },
};

const CSS = `
.brief { --paper:#FFFCF6; --sheet:#FBF7EF; --ink:#2B2622; --muted:#6E6A64; --leaf:#1E6B44; --leaf-ink:#145A3C; --rule:#E6DFD2;
  background:var(--paper); color:var(--ink); min-height:100vh; font-family:var(--font-body), "Helvetica Neue", Arial, sans-serif; font-size:17px; line-height:1.55; }
@media (prefers-color-scheme: dark) { .brief { --paper:#0E1A14; --sheet:#16261D; --ink:#FFFCF6; --muted:#C9D8CE; --leaf:#A7F0B6; --leaf-ink:#A7F0B6; --rule:#243A2E; color-scheme:dark; } }
.brief .wrap { max-width:38rem; margin:0 auto; padding:3rem 1.25rem 4rem; display:grid; gap:2.25rem; }
.brief h1 { font-family:var(--font-display), "Avenir Next", sans-serif; font-weight:600; font-size:2.5rem; letter-spacing:-.02em; line-height:1; margin:0 0 1rem; color:var(--leaf-ink); }
.brief .lead { font-family:var(--font-display), "Avenir Next", sans-serif; font-weight:500; font-size:1.3rem; line-height:1.45; margin:0; }
.brief h2 { font-size:.78rem; letter-spacing:.08em; text-transform:uppercase; color:var(--muted); font-weight:600; margin:0 0 .75rem; }
.brief ul { margin:0; padding-left:1.2rem; display:grid; gap:.6rem; }
.brief ol { margin:0; padding:0; display:grid; gap:.6rem; list-style-position:inside; }
.brief ol li { background:var(--sheet); padding:.8rem 1rem; border-radius:.5rem; }
.brief footer { border-top:1px solid var(--rule); padding-top:1rem; font-size:.9rem; color:var(--muted); display:flex; flex-wrap:wrap; gap:.5rem 1.5rem; }
.brief a { color:var(--leaf-ink); }
.brief a:focus-visible { outline:2px solid var(--leaf); outline-offset:2px; }
`;

export default function Brief() {
  return (
    <div className={`brief ${outfit.variable} ${albert.variable}`}>
      <style>{CSS}</style>
      <div className="wrap">
        <header>
          <h1>Sprouts</h1>
          <p className="lead">{LEAD}</p>
        </header>
        <section>
          <h2>Three things</h2>
          <ul>
            <li><strong>AI Yield Manager.</strong> Reads live rates daily and routes to the best safe venue (Kamino, Jupiter Lend).</li>
            <li><strong>Hack-proof by design.</strong> Even if our server is hacked, it can only move your daily round-up (max $5) into your own savings. <em>In progress.</em></li>
            <li><strong>Seeker only.</strong> Seed Vault signs everything; the Genesis Token is the door.</li>
          </ul>
        </section>
        <section>
          <h2>Two questions</h2>
          <ol>
            <li>Sprouts is a Seeker accumulation engine: every swap&apos;s spare change keeps adding SKR to your own wallet, and SKR is always the biggest share (25-50%). Does that count as an SKR integration?</li>
            <li>We deposit into Kamino for users, including in the US. OK for the hackathon?</li>
          </ol>
        </section>
        <footer>
          <span>hello@sprouts.money</span>
          <span>X: @sproutsonseeker</span>
          <a href="/">sprouts.money</a>
        </footer>
      </div>
    </div>
  );
}
