import { JetBrains_Mono, Outfit } from "next/font/google";

const outfit = Outfit({ subsets: ["latin"], weight: ["600"] });
/** R-S3 (his note "a sleeker font for the 'coming soon...' and buttons underneath"): Outfit light, a little tracking. */
const outfitLight = Outfit({ subsets: ["latin"], weight: ["300", "400"] });
/** His note 10-12 (monochrome lockup 'Sprouts' 'Clock in' under the art): the hackathon's CRT wordmark is heavy system monospace
 *  (weight 900, tracking .06em; sub-lines ~.21em size, tracking .32em); JetBrains Mono 800 so it reads the same on every device. */
const mono = JetBrains_Mono({ subsets: ["latin"], weight: ["400", "800"] });

/**
 * The front door (his note 10-11: "a fun minimal splash page ... the simple loading screen from the phone (with the tree growing), and
 * instead of loading could say something about Sprouts is coming"). GrowSplash on the web: a plant grows once, the lockup under it, and
 * a small caption where the app says "Loading up your garden...". R-S2 ("a whole lifecycle growth timelapse ... every time the user
 * reloads its a different one"): one of five pack lifecycles (brand/garden2/splash/build_site_lifecycle.py), drawn per request; the
 * clips are on white and multiply onto the paper. The old text page described the pre-leash Subscriptions approval; /link, /revoke,
 * /terms and the deck stay as links.
 */
export const dynamic = "force-dynamic";
// R-S3: the orchid is out (its sand and flower clip); each clip is cropped to its grown plant (width / height), so no empty sky above
/** Bumped whenever the clips change: the URL changes too, so no browser replays a cached old cut (seen 10-11, R-S4). */
const CLIPS_V = "7";
const PLANTS = [["store", 1], ["maple", 720 / 428], ["azalea", 720 / 566], ["mandarin", 1], ["geode", 720 / 410]] as const;   // R-D40: stORE's geode (crossfaded stills until its clips land)

export default function Home() {
  const [plant, aspect] = PLANTS[Math.floor(Math.random() * PLANTS.length)];
  const paper = "#FFFBF5", ink = "#2B2622", muted = "#8A847B";
  const link = { color: muted, textDecoration: "none" };
  return (
    <main className={outfitLight.className} style={{ minHeight: "100svh", background: paper, color: ink, display: "grid", gridTemplateRows: "1fr auto" }}>
      <style>{`
        @keyframes sp-dots { 0%, 20% { content: "" } 40% { content: "." } 60% { content: ".." } 80%, 100% { content: "..." } }
        .sp-dots::after { content: "..."; display: inline-block; width: 1.2em; text-align: left; animation: sp-dots 2.4s steps(1) infinite; }
        .sp-foot a:hover { color: ${ink} !important; }
        .sp-stage { width: min(72vw, 360px); aspect-ratio: 6 / 5; }
        .sp-grow, .sp-grown { width: 100%; height: 100%; display: block; mix-blend-mode: multiply; object-fit: contain; object-position: center bottom; }
        .sp-grown { display: none; }
        .sp-lock { display: flex; align-items: center; gap: clamp(14px, 4vw, 22px); margin: 4px 0 0; color: ${ink}; }
        .sp-lock h1 { display: flex; align-items: center; gap: 10px; font-size: clamp(32px, 9vw, 42px); font-weight: 600; letter-spacing: -0.03em; margin: 0; }
        .sp-lock h1 img { height: 0.95em; width: auto; filter: brightness(0); opacity: .86; }   /* monochrome: the mark in ink */
        .sp-rule { width: 1px; align-self: stretch; margin: 6px 0; background: ${ink}; opacity: .35; }
        .sp-ci { display: grid; justify-items: start; line-height: 1; font-size: clamp(24px, 6.6vw, 31px); }
        .sp-ci b { font-size: 1em; font-weight: 800; letter-spacing: 0.06em; }
        .sp-ci small { font-size: 0.226em; font-weight: 400; letter-spacing: 0.32em; margin-top: 0.22em; white-space: nowrap; }   /* spans CLOCK IN's width: 5.16em vs 22.7 x .226 */
        @media (prefers-reduced-motion: reduce) { .sp-dots::after { animation: none; } .sp-grow { display: none; } .sp-grown { display: block; } }
      `}</style>
      <div style={{ display: "grid", placeItems: "center", alignContent: "center", padding: "0 24px 7vh" }}>
        {/* R-D82: one stage for every plant, each sitting on the same ground line, so the lockup and text never move between refreshes */}
        <div className="sp-stage" data-aspect={aspect}>
          <video className="sp-grow" src={`/site/grow-${plant}.mp4?v=${CLIPS_V}`} autoPlay muted playsInline preload="auto" aria-label="A plant growing from seed" />
          <img className="sp-grown" src={`/site/grown-${plant}.webp?v=${CLIPS_V}`} alt="A grown plant" />
        </div>
        <div className="sp-lock">
          <h1 className={outfit.className}><img src="/deck/mark.svg" alt="" />Sprouts</h1>
          <span className="sp-rule" aria-hidden="true" />
          <div className={`sp-ci ${mono.className}`} aria-label="CLOCK IN, a Solana Mobile hackathon">
            <b>CLOCK IN</b>
            <small>A SOLANA MOBILE HACKATHON</small>
          </div>
        </div>
        <p style={{ color: ink, fontSize: 16, fontWeight: 400, letterSpacing: "0.01em", margin: "22px 0 0", textAlign: "center", maxWidth: 340, lineHeight: 1.45 }}>
          Built for the CLOCK IN Solana Mobile Hackathon, hosted by Radiants
        </p>
        <p style={{ color: muted, fontSize: 15, fontWeight: 300, letterSpacing: "0.01em", margin: "8px 0 0", textAlign: "center" }}>
          Coming soon to the Solana dApp Store<span className="sp-dots" />
        </p>
      </div>
      <nav className="sp-foot" style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: "8px 20px", padding: "24px 24px 32px", fontSize: 13, fontWeight: 400, letterSpacing: "0.04em" }}>
        <a href="/deck" style={link}>Deck</a>
        <a href="/terms" style={link}>Terms</a>
        <a href="/revoke" style={link}>Revoke a wallet</a>
        <a href="mailto:hello@sprouts.money" style={link}>hello@sprouts.money</a>
      </nav>
    </main>
  );
}
