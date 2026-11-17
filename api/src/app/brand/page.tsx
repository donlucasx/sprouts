import type { Metadata } from "next";
import { Albert_Sans, Outfit } from "next/font/google";
import { SiteFooter, SiteHeader } from "../site-chrome";

/**
 * His ask 11-17: an unlisted brand kit for partners making Sprouts content (first: SAGASU's collab art). Garden stills from
 * brand/deck-art/build_timelapse_deck.py --still (GEODE=2 GEODE_APP=1, every plant at the same stage), the marks from
 * brand/pyth-thanks, colours and type from the approved brand manual (brand/manual/sprouts-brand-manual.html, v1.0).
 * Not linked from the site and noindex; the repo is public, so nothing here may be secret.
 */
const outfit = Outfit({ subsets: ["latin"], weight: ["600"] });
const albert = Albert_Sans({ subsets: ["latin"], weight: ["400", "600"] });
const paper = "#FFFCF6", cream = "#FBF7EF", ink = "#2B2622", muted = "#7A746B", sprout = "#1E6B44", rule = "#E6DFD2", dark = "#0E1A14";

export const metadata: Metadata = {
  title: "Sprouts: brand kit",
  description: "Garden art, logo and colours for making Sprouts content.",
  robots: { index: false, follow: false },
};

const PLANTS: [string, string][] = [
  ["SKR", "mandarin tree, left"],
  ["USDC lending", "round tree, right"],
  ["SOL lending", "red maple"],
  ["stORE", "geode"],
  ["hSOL", "azalea"],
  ["cbBTC", "orchid in the blue pot"],
];

const STAGES: [string, string][] = [
  ["garden-01", "Day one: seeds and sprouts"],
  ["garden-04", "Weeks in: the geode is still closed"],
  ["garden-08", "Months in: the geode cracks open"],
  ["garden-11", "Nearly grown: flowers and gold"],
];

const MARKS: [string, string, string][] = [
  ["mark-green.svg", paper, "Green"],
  ["mark-mint.svg", dark, "Mint"],
  ["mark-ink.svg", cream, "Ink"],
];

const COLOURS: [string, string][] = [
  ["Sprout green", "#1E6B44"],
  ["Leaf green", "#2E8B57"],
  ["Mint", "#A7F0B6"],
  ["Paper", "#FFFCF6"],
  ["Ink", "#2B2622"],
  ["Dark", "#0E1A14"],
];
const pale = (hex: string) => hex === "#FFFCF6" || hex === "#A7F0B6";

const dl = (file: string, label: string) => <a className="bk-dl" href={`/brand/${file}`} download>{label}</a>;

export default function Brand() {
  return (
    <main className={`bk ${albert.className}`}>
      <style>{`
        .bk { min-height: 100svh; background: ${paper}; color: ${ink}; display: grid; grid-template-rows: auto 1fr auto; line-height: 1.55; }
        .bk-col { width: 100%; max-width: 920px; margin: 0 auto; padding: 3vh 24px 8vh; display: grid; gap: 72px; align-content: start; }
        .bk h1 { font-size: clamp(34px, 7vw, 48px); letter-spacing: -0.02em; line-height: 1.05; margin: 0; }
        .bk h2 { font-size: 24px; letter-spacing: -0.02em; margin: 0 0 18px; }
        .bk p { margin: 0; }
        .bk-lede { font-size: 17px; color: ${muted}; margin-top: 12px; }
        .bk-frame { border: 1px solid ${rule}; border-radius: 16px; overflow: hidden; background: #fff; }
        .bk-frame img { display: block; width: 100%; height: auto; }
        .bk-bar { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 14px; }
        .bk-dl { font-size: 13px; font-weight: 600; color: ${sprout}; text-decoration: none; border: 1px solid ${rule}; background: ${cream}; padding: 6px 12px; border-radius: 999px; white-space: nowrap; }
        .bk-dl:hover { border-color: ${sprout}; }
        .bk-map { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px 24px; margin: 22px 0 0; font-size: 14px; }
        .bk-map div { display: grid; }
        .bk-map dt { font-weight: 600; }
        .bk-map dd { margin: 0; color: ${muted}; }
        .bk-two { display: grid; grid-template-columns: repeat(2, 1fr); gap: 20px; }
        .bk-cap { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 12px 14px; font-size: 14px; }
        .bk-four { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; }
        .bk-tile { height: 140px; display: grid; place-items: center; border-bottom: 1px solid ${rule}; }
        .bk-tile img { height: 60px; width: auto; }
        .bk-tile.lock img { height: 36px; }
        .bk-rules { margin: 18px 0 0; padding-left: 18px; color: ${muted}; font-size: 14px; display: grid; gap: 4px; }
        .bk-six { display: grid; grid-template-columns: repeat(6, 1fr); gap: 12px; }
        .bk-chip span { display: block; height: 72px; border-radius: 12px; }
        .bk-chip div { font-size: 13px; margin-top: 8px; display: grid; }
        .bk-chip code { color: ${muted}; font-size: 12px; }
        .bk-text { font-size: 15px; display: grid; gap: 10px; max-width: 640px; }
        .bk-text ul { margin: 0; padding-left: 18px; display: grid; gap: 4px; }
        .bk-foot { font-size: 14px; color: ${muted}; text-align: center; }
        .bk a.inl { color: ${sprout}; }
        @media (max-width: 760px) {
          .bk-four { grid-template-columns: repeat(2, 1fr); }
          .bk-six { grid-template-columns: repeat(3, 1fr); }
          .bk-map { grid-template-columns: repeat(2, 1fr); }
        }
        @media (max-width: 520px) { .bk-two { grid-template-columns: 1fr; } }
      `}</style>
      <SiteHeader />
      <div className="bk-col">
        <header>
          <h1 className={outfit.className}>Brand kit</h1>
          <p className="bk-lede">Garden art, logo and colours for making Sprouts content.</p>
        </header>

        <section>
          <h2 className={outfit.className}>The garden</h2>
          <div className="bk-frame">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/garden-14.webp" alt="The full-grown Sprouts garden: two trees, a red maple, an azalea, an orchid and an open gold geode on raked sand" />
          </div>
          <div className="bk-bar">
            {dl("garden-14.png", "PNG with signs")}
            {dl("garden-14-clean.png", "PNG without signs")}
          </div>
          <dl className="bk-map">
            {PLANTS.map(([coin, plant]) => (
              <div key={coin}>
                <dt>{coin}</dt>
                <dd>{plant}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section>
          <h2 className={outfit.className}>Growth stages</h2>
          <div className="bk-two">
            {STAGES.map(([file, caption]) => (
              <figure key={file} className="bk-frame" style={{ margin: 0 }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/brand/${file}.webp`} alt={`The Sprouts garden. ${caption}`} loading="lazy" />
                <figcaption className="bk-cap"><span>{caption}</span>{dl(`${file}.png`, "PNG")}</figcaption>
              </figure>
            ))}
          </div>
        </section>

        <section>
          <h2 className={outfit.className}>Logo</h2>
          <div className="bk-four">
            {MARKS.map(([file, bg, label]) => (
              <div key={file} className="bk-frame">
                <div className="bk-tile" style={{ background: bg }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`/brand/${file}`} alt={`Sprouts mark, ${label.toLowerCase()}`} />
                </div>
                <div className="bk-cap"><span>{label}</span>{dl(file, "SVG")}</div>
              </div>
            ))}
            <div className="bk-frame">
              <div className="bk-tile lock" style={{ background: paper }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/brand/lockup-ink.png" alt="Sprouts lockup: the mark and the word sprouts" />
              </div>
              <div className="bk-cap"><span>Lockup</span>{dl("lockup-ink.png", "PNG")}</div>
            </div>
          </div>
          <ul className="bk-rules">
            <li>Leave space around the mark of at least a quarter of its height, and keep it 24 px or bigger.</li>
            <li>Keep it as is: no rotating, stretching, outlines, shadows or other colours.</li>
            <li>On busy art, put it on a solid circle. In a lockup the mark sits left of the word, and the word is lowercase.</li>
          </ul>
        </section>

        <section>
          <h2 className={outfit.className}>Colour and type</h2>
          <div className="bk-six">
            {COLOURS.map(([name, hex]) => (
              <div key={hex} className="bk-chip">
                <span style={{ background: hex, border: pale(hex) ? `1px solid ${rule}` : "none" }} />
                <div><strong>{name}</strong><code>{hex}</code></div>
              </div>
            ))}
          </div>
          <p className="bk-rules" style={{ paddingLeft: 0, display: "block", marginTop: 22 }}>
            Headings and the wordmark use <span className={outfit.className} style={{ color: ink }}>Outfit 600</span>. Body text uses
            Albert Sans. Both are free on Google Fonts.
          </p>
        </section>

        <section>
          <h2 className={outfit.className}>Writing about Sprouts</h2>
          <div className="bk-text">
            <p>
              Sprouts rounds up your Solana swaps and saves the change once a day into coins you pick. Everything stays in your own wallet.
              It&apos;s live on the Solana dApp Store for Seeker and won 1st place at CLOCK IN.
            </p>
            <ul>
              <li>Please don&apos;t promise returns or call it a bank. Rates change.</li>
              <li>Sprouts doesn&apos;t mine ORE. It buys stORE for you.</li>
              <li>No cashtags.</li>
            </ul>
          </div>
        </section>

        <p className="bk-foot">
          Please share drafts with us before posting: <a className="inl" href="https://x.com/sproutsonseeker">@sproutsonseeker</a> or{" "}
          <a className="inl" href="mailto:hello@sprouts.money">hello@sprouts.money</a>.
        </p>
      </div>
      <SiteFooter />
    </main>
  );
}
