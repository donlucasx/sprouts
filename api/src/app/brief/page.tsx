import type { Metadata } from "next";
import Image from "next/image";
import { Outfit, Albert_Sans } from "next/font/google";

/** R316: the one-screen brief for the Solana Mobile / Radiants team (R314, R315), a temporary page until the site becomes the deck. */

const outfit = Outfit({ subsets: ["latin"], weight: ["500", "600"], variable: "--font-display" });
const albert = Albert_Sans({ subsets: ["latin"], weight: ["400", "600"], variable: "--font-body" });

const LEAD =
  "Your Seeker's spare change, planted. Every swap rounds up into SKR and stORE that only your Seed Vault can unlock, and an AI yield manager grows the rest in lending. Watch your garden grow. Withdraw any time."; // R354

export const metadata: Metadata = {
  title: "Sprouts brief",
  description: "Your Seeker's spare change, planted: round-ups into SKR and stORE, grown by an AI yield manager.",
  openGraph: {
    title: "Sprouts brief",
    description: "Your Seeker's spare change, planted: round-ups into SKR and stORE, grown by an AI yield manager.",
    url: "https://sprouts.money/brief",
    siteName: "Sprouts",
    type: "website",
    images: [{ url: "https://sprouts.money/brief/og-v2.png", width: 1200, height: 630, alt: "Sprouts: your Seeker's spare change, planted" }],
  },
  twitter: { card: "summary_large_image", images: ["https://sprouts.money/brief/og-v2.png"] },
};

const CSS = `
.brief { --paper:#FFFCF6; --sheet:#FBF7EF; --ink:#2B2622; --muted:#6E6A64; --leaf:#1E6B44; --leaf-ink:#145A3C; --rule:#E6DFD2;
  background:var(--paper); color:var(--ink); min-height:100vh; font-family:var(--font-body), "Helvetica Neue", Arial, sans-serif; font-size:17px; line-height:1.55; }
@media (prefers-color-scheme: dark) { .brief { --paper:#0E1A14; --sheet:#16261D; --ink:#FFFCF6; --muted:#C9D8CE; --leaf:#A7F0B6; --leaf-ink:#A7F0B6; --rule:#243A2E; color-scheme:dark; } }
.brief .wrap { max-width:62rem; margin:0 auto; padding:3rem 1.25rem 4rem; display:grid; gap:2.5rem; }
.brief .copy { display:grid; gap:2rem; max-width:38rem; }
.brief .phone { justify-self:center; width:min(17.5rem, 78vw); border-radius:2.6rem; padding:.6rem; background:#1C1B1A; box-shadow:0 24px 60px rgba(30,60,40,.22), 0 2px 6px rgba(0,0,0,.18); }
.brief .phone img { display:block; width:100%; height:auto; border-radius:2.05rem; }
.brief .phone figcaption { font-size:.75rem; color:#9C978F; text-align:center; padding:.5rem 0 .1rem; }
@media (min-width: 860px) { .brief .wrap { grid-template-columns:minmax(0,1fr) auto; align-items:start; column-gap:4rem; } .brief .phone { position:sticky; top:2.5rem; } .brief footer { grid-column:1 / -1; } }
.brief p { margin:0; }
.brief .feat { display:grid; gap:.8rem; }
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
        <div className="copy">
          <header>
            <h1>Sprouts</h1>
            <p className="lead">{LEAD}</p>
          </header>
          <section>
            <h2>How it works</h2>
            <ol className="feat">
              <li><strong>Savings that fill themselves.</strong> Every swap rounds up. Each day the change is planted into SKR, stORE and lending.</li>
              <li><strong>AI Yield Manager</strong> (optional, Pro, free at launch). Built on top: each morning it reads live rates and tilts your split toward what pays more. It never sells what you hold.</li>
            </ol>
          </section>
          <section>
            <h2>Made for Seeker</h2>
            <p>Genesis Token sign-in. Only your Seed Vault can unlock your SKR. Your .skr name on a garden you watch grow, right on your home screen.</p>
          </section>
          <section>
            <h2>Good for SKR and stORE</h2>
            <p>Everyday swaps become steady SKR demand, and stORE puts ORE to work.</p>
          </section>
          <section>
            <h2>Your money stays yours</h2>
            <p>An on-chain leash lets our server move only your daily round-up (up to $5), and only into your own savings. Build verified against the public source.</p>
          </section>
          <section>
            <h2>Two questions</h2>
            <ol>
              <li>Sprouts keeps adding SKR to your own wallet from every swap, with SKR at least a quarter of the split. Does that count as an SKR integration?</li>
              <li>The AI Yield Manager deposits into Kamino, which geoblocks the US/UK on its own site; our deposits are on-chain, opt-in. OK for the hackathon, or skip Kamino there?</li>
            </ol>
          </section>
        </div>
        <figure className="phone" style={{ margin: 0 }}>
          <Image src="/brief/home-420.webp" width={540} height={1200} priority alt="The Sprouts app on a Seeker: a painted garden with an SKR tree and a stORE succulent, $420.69 in the garden" />
          <figcaption>Demo garden</figcaption>
        </figure>
        <footer>
          <span>hello@sprouts.money</span>
          <span>X: @sproutsonseeker</span>
          <a href="/">sprouts.money</a>
        </footer>
      </div>
    </div>
  );
}
