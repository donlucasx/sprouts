import { Outfit } from "next/font/google";
import { ClockInLockup } from "./clockin-lockup";
import { Safety } from "./safety";

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
/** Bumped whenever the clips change: the URL changes too, so no browser replays a cached old cut (seen 10-11, R-S4). */
const CLIPS_V = "14";   // 10-14: geode v8 from the raw MJ takes (build_site_geode_v5.py); azalea re-cut from its original pack (build_site_azalea.py)
const PLANTS = [["store", 1], ["maple", 720 / 428], ["azalea", 720 / 522], ["mandarin", 1], ["geode", 720 / 440]] as const;   // R-D40: stORE's geode (crossfaded stills until its clips land)

export default function Home() {
  const [plant, aspect] = PLANTS[Math.floor(Math.random() * PLANTS.length)];
  const paper = "#FFFBF5", ink = "#2B2622", muted = "#8A847B";
  const link = { color: muted, textDecoration: "none" };
  return (
    <main className={outfitLight.className} style={{ background: paper, color: ink }}>
      <div style={{ minHeight: "100svh", display: "grid", gridTemplateRows: "1fr auto" }}>
      <style>{`
        @keyframes sp-dots { 0%, 20% { content: "" } 40% { content: "." } 60% { content: ".." } 80%, 100% { content: "..." } }
        .sp-dots::after { content: "..."; display: inline-block; width: 1.2em; text-align: left; animation: sp-dots 2.4s steps(1) infinite; }
        .sp-foot a:hover { color: ${ink} !important; }
        .sp-sep { width: 1px; height: 11px; background: ${muted}; opacity: 0.45; margin: 0 14px; }
        .sp-stage { width: min(72vw, 360px); aspect-ratio: 6 / 5; }
        .sp-grow, .sp-grown { width: 100%; height: 100%; display: block; mix-blend-mode: multiply; object-fit: contain; object-position: center bottom; }
        .sp-grown { display: none; }
        .sp-lockup { font-size: clamp(27px, 7.4vw, 36px); margin-top: clamp(20px, 3.4vh, 32px); }   /* R-D96 rhythm; R-D100 a tad smaller (was 30-40px) */
        .sp-main { padding: 0 24px 7vh; }
        @media (max-width: 600px) { .sp-main { padding-bottom: 13vh; } }   /* R-D100: on phones the group sits a little above centre (optical centre) */
        @media (prefers-reduced-motion: reduce) { .sp-dots::after { animation: none; } .sp-grow { display: none; } .sp-grown { display: block; } }
      `}</style>
      <div className="sp-main" style={{ display: "grid", placeItems: "center", alignContent: "center" }}>
        {/* R-D82: one stage for every plant, each sitting on the same ground line, so the lockup and text never move between refreshes */}
        <div className="sp-stage" data-aspect={aspect}>
          <video className="sp-grow" src={`/site/grow-${plant}.mp4?v=${CLIPS_V}`} autoPlay muted playsInline preload="auto" aria-label="A plant growing from seed" />
          <img className="sp-grown" src={`/site/grown-${plant}.webp?v=${CLIPS_V}`} alt="A grown plant" />
        </div>
        {/* R-D93: the stacked co-brand lockup (shared with the deck cover) */}
        <ClockInLockup className="sp-lockup" />
      </div>
      {/* his ask 10-23: "DECK | FAQs | TERMS | REVOKE and underneath the contact email" */}
      <footer className="sp-foot" style={{ display: "grid", justifyItems: "center", gap: 10, padding: "24px 24px 32px", fontWeight: 400 }}>
        <nav style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", alignItems: "center", fontSize: 12, letterSpacing: "0.16em" }}>
          {[["/deck", "DECK"], ["#safe", "FAQs"], ["/terms", "TERMS"], ["/revoke", "REVOKE"]].map(([href, label], i) => (
            <span key={href} style={{ display: "inline-flex", alignItems: "center" }}>
              {i > 0 ? <span aria-hidden className="sp-sep" /> : null}
              <a href={href} style={link}>{label}</a>
            </span>
          ))}
        </nav>
        <a href="mailto:hello@sprouts.money" style={{ ...link, fontSize: 13, letterSpacing: "0.02em" }}>hello@sprouts.money</a>
      </footer>
      </div>
      {/* his ask 10-22: the boundaries, below the splash, so the first screen stays the splash */}
      <div style={{ display: "grid", justifyItems: "center", padding: "8vh 24px 12vh" }}>
        <Safety id="safe" ink={ink} muted={muted} />
      </div>
    </main>
  );
}
