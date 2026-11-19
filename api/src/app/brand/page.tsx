import type { Metadata } from "next";
import { Outfit, Albert_Sans } from "next/font/google";
import { SiteFooter, SiteHeader } from "../site-chrome";

/** His ask 11-19: the brand manual, simplified, public, with the logo files downloadable (Seeker Season partners asked for an SVG). */
const outfit = Outfit({ subsets: ["latin"], weight: ["600"], variable: "--font-display" });
const albert = Albert_Sans({ subsets: ["latin"], weight: ["400", "600"], variable: "--font-body" });

export const metadata: Metadata = { title: "Sprouts: Brand", description: "The Sprouts logo, colours and type, with files to download." };

const K = "/brand/kit/";
const LOGOS = [
  { file: "sprouts-logo-green.svg", name: "Green", note: "on light grounds", bg: "#FFFCF6" },
  { file: "sprouts-logo-mint.svg", name: "Mint", note: "on dark grounds", bg: "#0E1A14" },
  { file: "sprouts-logo-white.svg", name: "White", note: "on brand green and photos", bg: "#1E6B44" },
  { file: "sprouts-logo-ink.svg", name: "Ink", note: "one-colour print", bg: "#FFFCF6" },
  { file: "sprouts-logo-two-tone.svg", name: "Two-tone", note: "the app icon's colours", bg: "#FFFCF6" },
  { file: "sprouts-app-icon.svg", name: "App icon", note: "SVG, or PNG 1024", bg: "transparent", png: "sprouts-app-icon-1024.png" },
];
const LOCKUPS = [
  { file: "sprouts-lockup-horizontal-green.svg", name: "Horizontal", note: "green and ink", bg: "#FFFCF6" },
  { file: "sprouts-lockup-horizontal-reversed.svg", name: "Horizontal", note: "on dark", bg: "#0E1A14" },
  { file: "sprouts-lockup-horizontal-white.svg", name: "Horizontal", note: "white", bg: "#1E6B44" },
  { file: "sprouts-lockup-horizontal-ink.svg", name: "Horizontal", note: "ink, one colour", bg: "#FFFCF6" },
  { file: "sprouts-lockup-stacked-green.svg", name: "Stacked", note: "green and ink", bg: "#FFFCF6" },
  { file: "sprouts-lockup-stacked-reversed.svg", name: "Stacked", note: "on dark", bg: "#0E1A14" },
  { file: "sprouts-lockup-stacked-white.svg", name: "Stacked", note: "white", bg: "#1E6B44" },
  { file: "sprouts-lockup-stacked-ink.svg", name: "Stacked", note: "ink, one colour", bg: "#FFFCF6" },
  { file: "sprouts-wordmark-ink.svg", name: "Wordmark", note: "ink", bg: "#FFFCF6" },
  { file: "sprouts-wordmark-green.svg", name: "Wordmark", note: "green", bg: "#FFFCF6" },
  { file: "sprouts-wordmark-white.svg", name: "Wordmark", note: "white", bg: "#1E6B44" },
];
const COLOURS = [
  ["Sprout green", "#1E6B44", "the logo, buttons"], ["Leaf green", "#2E8B57", "illustration, success"], ["Deep green", "#145A3C", "small text on paper"],
  ["Mint", "#A7F0B6", "the logo and accents on dark"], ["Icon ground", "#F4EEDF", "app icon background"], ["Paper", "#FFFCF6", "page background"],
  ["Ink", "#2B2622", "text"], ["Dark", "#0E1A14", "dark background"],
];

const CSS = `
.brand { --paper:#FFFCF6; --ink:#2B2622; --muted:#6E6A64; --line:#E6E0D4; --leaf-ink:#145A3C; background:var(--paper); color:var(--ink); min-height:100vh; font-family:var(--font-body), "Helvetica Neue", Arial, sans-serif; font-size:16px; line-height:1.55; }
@media (prefers-color-scheme: dark) { .brand { --paper:#0E1A14; --ink:#FFFCF6; --muted:#C9D8CE; --line:#25362C; --leaf-ink:#A7F0B6; color-scheme:dark; } }
.brand .wrap { max-width:60rem; margin:0 auto; padding:1.5rem 1.25rem 3rem; }
.brand h1 { font-family:var(--font-display), sans-serif; font-weight:600; font-size:2.2rem; line-height:1.1; color:var(--leaf-ink); margin:0 0 .5rem; }
.brand h2 { font-family:var(--font-display), sans-serif; font-weight:600; font-size:1.25rem; margin:2.5rem 0 .75rem; }
.brand p { margin:0 0 .8rem; max-width:40rem; }
.brand .muted { color:var(--muted); }
.brand .grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(14rem,1fr)); gap:1rem; }
.brand .card { border:1px solid var(--line); border-radius:14px; overflow:hidden; }
.brand .tile { aspect-ratio:1; display:flex; align-items:center; justify-content:center; }
.brand .tile img { width:62%; height:62%; }
.brand .tile img.full { width:100%; height:100%; }
.brand .tile.wide { aspect-ratio:16/10; }
.brand .tile.wide img { width:80%; height:70%; }
.brand .meta { display:flex; align-items:center; gap:.5rem; padding:.7rem .9rem; font-size:.9rem; }
.brand .meta b { font-weight:600; }
.brand .meta span { color:var(--muted); flex:1; min-width:0; }
.brand .dl { font-size:.8rem; font-weight:600; letter-spacing:.04em; color:var(--leaf-ink); text-decoration:none; border:1px solid var(--line); border-radius:999px; padding:.25rem .65rem; white-space:nowrap; }
.brand .dl:hover { border-color:var(--leaf-ink); }
.brand .sw { display:grid; grid-template-columns:repeat(auto-fill,minmax(11rem,1fr)); gap:.75rem; }
.brand .chip { border:1px solid var(--line); border-radius:12px; overflow:hidden; font-size:.85rem; }
.brand .chip i { display:block; height:4.5rem; }
.brand .chip div { padding:.55rem .75rem; }
.brand .chip code { font-size:.8rem; color:var(--muted); }
.brand ul { margin:0 0 .8rem; padding-left:1.2rem; }
.brand .type { display:grid; grid-template-columns:repeat(auto-fill,minmax(16rem,1fr)); gap:1rem; }
.brand .type .card { padding:1rem 1.1rem; }
.brand .big { font-size:2.4rem; line-height:1.1; margin:.2rem 0 .4rem; }
.brand a { color:var(--leaf-ink); }
`;

export default function Brand() {
  return (
    <div className={`brand ${outfit.variable} ${albert.variable}`}>
      <style>{CSS}</style>
      <SiteHeader darkOk />
      <main className="wrap">
        <h1>Sprouts brand</h1>
        <p className="muted">The logo, colours and type. Download what you need.</p>

        <h2>Logo</h2>
        <div className="grid">
          {LOGOS.map((l) => (
            <div className="card" key={l.file}>
              <div className="tile" style={{ background: l.bg }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img className={l.png ? "full" : ""} src={K + l.file} alt={`Sprouts logo, ${l.name}`} />
              </div>
              <div className="meta">
                <b>{l.name}</b><span>{l.note}</span>
                <a className="dl" href={K + l.file} download>SVG</a>
                {l.png ? <a className="dl" href={K + l.png} download>PNG</a> : null}
              </div>
            </div>
          ))}
        </div>

        <h2>Wordmark and lockups</h2>
        <p className="muted">The word is &ldquo;sprouts&rdquo; in Outfit 600, lowercase. The logo always sits to the left of it or above it, never to the right.</p>
        <div className="grid">
          {LOCKUPS.map((l) => (
            <div className="card" key={l.file}>
              <div className="tile wide" style={{ background: l.bg }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={K + l.file} alt={`Sprouts ${l.name.toLowerCase()}, ${l.note}`} />
              </div>
              <div className="meta"><b>{l.name}</b><span>{l.note}</span><a className="dl" href={K + l.file} download>SVG</a></div>
            </div>
          ))}
        </div>

        <h2>Using the logo</h2>
        <ul>
          <li>Leave clear space of a quarter of the logo&apos;s height on every side.</li>
          <li>Keep it 24 px or larger, so the crack in the seed reads.</li>
          <li>Don&apos;t rotate, stretch, outline, add shadows or change its colours.</li>
          <li>On busy images, use the white logo or the app icon.</li>
        </ul>

        <h2>Colours</h2>
        <div className="sw">
          {COLOURS.map(([name, hex, use]) => (
            <div className="chip" key={hex}>
              <i style={{ background: hex }} />
              <div><b>{name}</b><br /><code>{hex}</code><br /><span className="muted">{use}</span></div>
            </div>
          ))}
        </div>

        <h2>Type</h2>
        <div className="type">
          <div className="card">
            <div className="big" style={{ fontFamily: "var(--font-display)", fontWeight: 600 }}>Sprouts</div>
            <b>Outfit 600</b><br /><span className="muted">The name, titles and big numbers. </span>
            <a href="https://fonts.google.com/specimen/Outfit">Google Fonts</a>
          </div>
          <div className="card">
            <div className="big" style={{ fontFamily: "var(--font-body)" }}>Round up every swap</div>
            <b>Albert Sans 400 and 600</b><br /><span className="muted">Everything people read. </span>
            <a href="https://fonts.google.com/specimen/Albert+Sans">Google Fonts</a>
          </div>
        </div>

        <h2>Name and line</h2>
        <p>In sentences, write <b>Sprouts</b>: one word, capital S. Only the wordmark is lowercase. On X it is <a href="https://x.com/sproutsonseeker">@sproutsonseeker</a>.</p>
        <p>The one line: <b>Round up every swap and plant the change.</b></p>
      </main>
      <SiteFooter />
    </div>
  );
}
