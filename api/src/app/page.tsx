import { Outfit } from "next/font/google";

const outfit = Outfit({ subsets: ["latin"], weight: ["600"] });
/** R-S3 (his note "a sleeker font for the 'coming soon...' and buttons underneath"): Outfit light, a little tracking. */
const outfitLight = Outfit({ subsets: ["latin"], weight: ["300", "400"] });

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
const PLANTS = [["store", 1], ["maple", 720 / 428], ["azalea", 720 / 566], ["mandarin", 1]] as const;

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
        .sp-grow, .sp-grown { width: 100%; height: 100%; display: block; mix-blend-mode: multiply; }
        .sp-grown { display: none; }
        @media (prefers-reduced-motion: reduce) { .sp-dots::after { animation: none; } .sp-grow { display: none; } .sp-grown { display: block; } }
      `}</style>
      <div style={{ display: "grid", placeItems: "center", alignContent: "center", padding: "0 24px 7vh" }}>
        <div style={{ width: "min(72vw, 360px)", aspectRatio: aspect }}>
          <video className="sp-grow" src={`/site/grow-${plant}.mp4`} autoPlay muted playsInline preload="auto" aria-label="A plant growing from seed" />
          <img className="sp-grown" src={`/site/grown-${plant}.webp`} alt="A grown plant" />
        </div>
        <h1 className={outfit.className} style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 42, fontWeight: 600, letterSpacing: "-0.03em", margin: "4px 0 0" }}>
          <img src="/deck/mark.svg" alt="" style={{ height: 40, width: "auto" }} />
          Sprouts
        </h1>
        <p style={{ color: muted, fontSize: 17, fontWeight: 300, letterSpacing: "0.01em", margin: "22px 0 0", textAlign: "center" }}>
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
