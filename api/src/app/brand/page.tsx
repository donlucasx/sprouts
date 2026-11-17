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
  description: "Garden art, logo, colours and type for partners making Sprouts content.",
  robots: { index: false, follow: false },
};

const STAGES: [string, string, string][] = [
  ["garden-01", "Day one", "Every coin is a seed or a sprout."],
  ["garden-04", "A few weeks in", "The trees start to branch, the geode is still closed."],
  ["garden-08", "A few months in", "The geode cracks open, the bushes fill out."],
  ["garden-11", "Growing", "Flowers on the azalea and orchid, gold spilling from the geode."],
];

const PLANTS: [string, string][] = [
  ["SKR", "the mandarin tree (left)"],
  ["USDC lending", "the round tree (right)"],
  ["SOL lending", "the red maple"],
  ["stORE", "the geode"],
  ["hSOL", "the azalea bush"],
  ["cbBTC", "the orchid in the blue pot"],
];

const COLOURS: [string, string, string][] = [
  ["Sprout green", "#1E6B44", "The mark and primary buttons"],
  ["Deep green", "#145A3C", "Headers, small text on paper"],
  ["Leaf green", "#2E8B57", "Illustration, success"],
  ["Mint", "#A7F0B6", "The mark on dark grounds"],
  ["Paper", "#FFFCF6", "Page and card ground"],
  ["Cream", "#FBF7EF", "Panels and tiles"],
  ["Ink", "#2B2622", "Text and the wordmark"],
  ["Dark", "#0E1A14", "Dark theme ground"],
];

const light = (hex: string) => ["#FFFCF6", "#FBF7EF", "#A7F0B6"].includes(hex);

function Download({ file, label }: { file: string; label: string }) {
  return <a className="bk-dl" href={`/brand/${file}`} download>{label}</a>;
}

export default function Brand() {
  return (
    <main className={`bk ${albert.className}`}>
      <style>{`
        .bk { min-height: 100svh; background: ${paper}; color: ${ink}; display: grid; grid-template-rows: auto 1fr auto; line-height: 1.55; }
        .bk-col { width: 100%; max-width: 960px; margin: 0 auto; padding: 3vh 24px 8vh; display: grid; gap: 64px; align-content: start; }
        .bk h1 { font-size: clamp(34px, 7vw, 52px); letter-spacing: -0.02em; line-height: 1.05; margin: 0; }
        .bk h2 { font-size: 26px; letter-spacing: -0.02em; margin: 0 0 6px; }
        .bk h3 { font-size: 15px; font-weight: 600; margin: 0; }
        .bk p { margin: 0; }
        .bk-lede { font-size: 17px; color: ${muted}; max-width: 560px; margin-top: 14px; }
        .bk-sub { color: ${muted}; font-size: 15px; margin-bottom: 22px; max-width: 620px; }
        .bk-hero { border-radius: 18px; overflow: hidden; border: 1px solid ${rule}; background: #fff; }
        .bk-hero img, .bk-card img { display: block; width: 100%; height: auto; }
        .bk-row { display: flex; flex-wrap: wrap; gap: 8px 16px; align-items: center; margin-top: 12px; }
        .bk-dl { font-size: 13px; font-weight: 600; color: ${sprout}; text-decoration: none; border: 1px solid ${rule}; background: ${cream}; padding: 6px 12px; border-radius: 999px; }
        .bk-dl:hover { border-color: ${sprout}; }
        .bk-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 20px; }
        @media (max-width: 640px) { .bk-grid { grid-template-columns: 1fr; } }
        .bk-card { border: 1px solid ${rule}; border-radius: 14px; overflow: hidden; background: #fff; }
        .bk-card > div { padding: 12px 14px 14px; display: grid; gap: 4px; font-size: 14px; }
        .bk-card .bk-row { margin-top: 6px; }
        .bk-map { display: grid; grid-template-columns: max-content 1fr; gap: 6px 18px; font-size: 15px; margin-top: 18px; }
        .bk-map dt { font-weight: 600; }
        .bk-map dd { margin: 0; color: ${muted}; }
        .bk-marks { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 16px; }
        .bk-tile { border-radius: 14px; border: 1px solid ${rule}; height: 150px; display: grid; place-items: center; }
        .bk-tile img { height: 64px; width: auto; }
        .bk-tile.lock img { height: 40px; }
        .bk-cap { font-size: 13px; color: ${muted}; margin-top: 8px; display: flex; justify-content: space-between; gap: 8px; align-items: center; }
        .bk-rules { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 20px; margin-top: 24px; font-size: 15px; }
        .bk-rules ul { margin: 6px 0 0; padding-left: 18px; display: grid; gap: 4px; }
        .bk-sw { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 14px; }
        .bk-chip { border-radius: 14px; border: 1px solid ${rule}; overflow: hidden; background: #fff; }
        .bk-chip > span { display: block; height: 84px; }
        .bk-chip > div { padding: 10px 12px; font-size: 13px; display: grid; gap: 2px; }
        .bk-chip code { font-size: 13px; color: ${ink}; }
        .bk-type { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 20px; }
        .bk-spec { border: 1px solid ${rule}; border-radius: 14px; padding: 22px; background: ${cream}; display: grid; gap: 8px; }
        .bk-say { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 20px; font-size: 15px; }
        .bk-say ul { margin: 8px 0 0; padding-left: 18px; display: grid; gap: 6px; }
        .bk-note { font-size: 13px; color: ${muted}; text-align: center; }
        .bk a.inl { color: ${sprout}; }
        @media (max-width: 520px) { .bk-map { grid-template-columns: 1fr; gap: 0 0; } .bk-map dd { margin-bottom: 8px; } }
      `}</style>
      <SiteHeader />
      <div className="bk-col">
        <header>
          <h1 className={outfit.className}>Brand kit</h1>
          <p className="bk-lede">
            Art and rules for partners making Sprouts content. Sprouts rounds up your Solana swaps and saves the spare change into the
            coins you pick, and your savings grow as a garden in the app.
          </p>
        </header>

        <section>
          <h2 className={outfit.className}>The garden</h2>
          <p className="bk-sub">Each coin you save into grows as its own plant. This is a garden after about two years of round-ups.</p>
          <div className="bk-hero">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/garden-14.webp" alt="A fully grown Sprouts zen garden: two trees, a red maple, an azalea, an orchid and an open gold geode on raked sand" />
          </div>
          <div className="bk-row">
            <Download file="garden-14.png" label="Download PNG, with signs" />
            <Download file="garden-14-clean.png" label="Download PNG, no signs" />
          </div>
          <dl className="bk-map">
            {PLANTS.map(([coin, plant]) => (
              <div key={coin} style={{ display: "contents" }}>
                <dt>{coin}</dt>
                <dd>{plant}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section>
          <h2 className={outfit.className}>How it grows</h2>
          <p className="bk-sub">The same garden at earlier stages. Plants grow with every daily planting.</p>
          <div className="bk-grid">
            {STAGES.map(([file, title, line]) => (
              <figure key={file} className="bk-card" style={{ margin: 0 }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/brand/${file}.webp`} alt={`The Sprouts garden: ${title.toLowerCase()}`} loading="lazy" />
                <div>
                  <h3>{title}</h3>
                  <p style={{ color: muted }}>{line}</p>
                  <div className="bk-row"><Download file={`${file}.png`} label="Download PNG" /></div>
                </div>
              </figure>
            ))}
          </div>
        </section>

        <section>
          <h2 className={outfit.className}>Logo</h2>
          <p className="bk-sub">A seed cracking open with the sprout already out. Use the version that fits the ground.</p>
          <div className="bk-marks">
            {[
              ["mark-green.svg", paper, "Green on light"],
              ["mark-mint.svg", dark, "Mint on dark"],
              ["mark-ink.svg", cream, "Ink, one colour"],
            ].map(([file, bg, label]) => (
              <div key={file}>
                <div className="bk-tile" style={{ background: bg }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`/brand/${file}`} alt={`Sprouts mark, ${label.toLowerCase()}`} />
                </div>
                <div className="bk-cap"><span>{label}</span><Download file={file} label="SVG" /></div>
              </div>
            ))}
            <div>
              <div className="bk-tile lock" style={{ background: paper }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/brand/lockup-ink.png" alt="Sprouts lockup: the mark and the word sprouts" />
              </div>
              <div className="bk-cap"><span>Lockup</span><Download file="lockup-ink.png" label="PNG" /></div>
            </div>
          </div>
          <div className="bk-rules">
            <div>
              <h3>Do</h3>
              <ul>
                <li>Keep clear space of a quarter of the mark&apos;s height on every side.</li>
                <li>Keep the mark at 24 px or bigger.</li>
                <li>Put the mark left of the word or above it.</li>
                <li>Write the name in lowercase in the lockup: sprouts.</li>
              </ul>
            </div>
            <div>
              <h3>Don&apos;t</h3>
              <ul>
                <li>Rotate, stretch, outline or add shadows to the mark.</li>
                <li>Recolour it outside the versions above.</li>
                <li>Place it on a busy ground without a solid disc behind it.</li>
                <li>Put the word above the mark or the mark on the right.</li>
              </ul>
            </div>
          </div>
        </section>

        <section>
          <h2 className={outfit.className}>Colour</h2>
          <p className="bk-sub">Greens plus warm paper. One green on the mark; the garden art has its own softer greens.</p>
          <div className="bk-sw">
            {COLOURS.map(([name, hex, use]) => (
              <div key={hex} className="bk-chip">
                <span style={{ background: hex, borderBottom: light(hex) ? `1px solid ${rule}` : "none" }} />
                <div>
                  <strong>{name}</strong>
                  <code>{hex}</code>
                  <span style={{ color: muted }}>{use}</span>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section>
          <h2 className={outfit.className}>Type</h2>
          <div className="bk-type">
            <div className="bk-spec">
              <span style={{ fontSize: 13, color: muted }}>Wordmark and headings</span>
              <span className={outfit.className} style={{ fontSize: 40, letterSpacing: "-0.02em", lineHeight: 1.1 }}>sprouts</span>
              <span style={{ fontSize: 14 }}>Outfit 600, tracking -0.02 em. Lowercase for the wordmark.</span>
            </div>
            <div className="bk-spec">
              <span style={{ fontSize: 13, color: muted }}>Body</span>
              <span style={{ fontSize: 22, lineHeight: 1.3 }}>Every swap rounds up. The change grows.</span>
              <span style={{ fontSize: 14 }}>Albert Sans 400 and 600. Both are free on Google Fonts.</span>
            </div>
          </div>
        </section>

        <section>
          <h2 className={outfit.className}>Writing about Sprouts</h2>
          <div className="bk-say">
            <div>
              <h3>Good to say</h3>
              <ul>
                <li>Sprouts rounds up your Solana swaps and saves the change once a day.</li>
                <li>It saves into staked SKR, stORE, hSOL, cbBTC, and USDC or SOL lending, your pick.</li>
                <li>Everything stays in your own wallet. Sprouts can move at most $5 a day, only into your savings.</li>
                <li>Live on the Solana dApp Store for Seeker. 1st place at CLOCK IN.</li>
              </ul>
            </div>
            <div>
              <h3>Please avoid</h3>
              <ul>
                <li>Promising returns or yields. Rates change and can fall to zero.</li>
                <li>Calling it a bank or saying funds are insured.</li>
                <li>Saying Sprouts mines ORE. It buys stORE for you.</li>
                <li>Cashtags in posts about Sprouts.</li>
              </ul>
            </div>
          </div>
        </section>

        <p className="bk-note">
          Questions or something you need: <a className="inl" href="mailto:hello@sprouts.money">hello@sprouts.money</a> or{" "}
          <a className="inl" href="https://x.com/sproutsonseeker">@sproutsonseeker</a>. Please share drafts with us before posting.
        </p>
      </div>
      <SiteFooter />
    </main>
  );
}
