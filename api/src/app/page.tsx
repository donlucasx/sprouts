import { Outfit } from "next/font/google";

const outfit = Outfit({ subsets: ["latin"], weight: ["600"] });

/**
 * The front door (his note 10-11: "a fun minimal splash page ... the simple loading screen from the phone (with the tree growing), and
 * instead of loading could say something about Sprouts is coming"). GrowSplash on the web: the stORE tree grows once (the deck's
 * tree-grow.webp, cut from the app's 12 splash frames), the lockup under it, and a small caption where the app says "Loading up your
 * garden...". The old text page described the pre-leash Subscriptions approval; /link, /revoke, /terms and the deck stay as links.
 */
export default function Home() {
  const paper = "#FFFBF5", ink = "#2B2622", muted = "#8A847B";
  const link = { color: muted, textDecoration: "none" };
  return (
    <main style={{ minHeight: "100svh", background: paper, color: ink, display: "grid", gridTemplateRows: "1fr auto", fontFamily: "system-ui, sans-serif" }}>
      <style>{`
        @keyframes sp-dots { 0%, 20% { content: "" } 40% { content: "." } 60% { content: ".." } 80%, 100% { content: "..." } }
        .sp-dots::after { content: "..."; display: inline-block; width: 1.2em; text-align: left; animation: sp-dots 2.4s steps(1) infinite; }
        .sp-foot a:hover { color: ${ink} !important; }
        @media (prefers-reduced-motion: reduce) { .sp-dots::after { animation: none; } }
      `}</style>
      <div style={{ display: "grid", placeItems: "center", alignContent: "center", padding: "6vh 24px 0" }}>
        <picture>
          <source srcSet="/deck/tree-grown.webp" media="(prefers-reduced-motion: reduce)" />
          <img src="/deck/tree-grow.webp" alt="A tree growing on raked sand" style={{ width: "min(72vw, 340px)", height: "auto", display: "block" }} />
        </picture>
        <h1 className={outfit.className} style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 42, fontWeight: 600, letterSpacing: "-0.03em", margin: "4px 0 0" }}>
          <img src="/deck/mark.svg" alt="" style={{ height: 40, width: "auto" }} />
          Sprouts
        </h1>
        <p style={{ color: muted, fontSize: 16, margin: "28px 0 0", textAlign: "center" }}>
          Coming soon to the Solana dApp Store<span className="sp-dots" />
        </p>
      </div>
      <nav className="sp-foot" style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: "8px 20px", padding: "24px 24px 32px", fontSize: 13 }}>
        <a href="/deck" style={link}>Deck</a>
        <a href="/terms" style={link}>Terms</a>
        <a href="/revoke" style={link}>Revoke a wallet</a>
        <a href="mailto:hello@sprouts.money" style={link}>hello@sprouts.money</a>
      </nav>
    </main>
  );
}
