import type { Metadata } from "next";
import { Outfit, Albert_Sans } from "next/font/google";
import { DeckKeys } from "./keys";

/**
 * The pitch deck: one 16:9 slide per screen, ten slides (R-D2, R-D7): hook, problem, how it works, Seed Vault, garden (demo +
 * why people come back, R-D5), Yield Manager, safety + how it's built (R-D6), market, business (Seeker and Solana Mobile only,
 * R-D4), team. Every size is in container units, so the same page prints to a 1920x1080 PDF (one slide per page).
 * Copy follows the rulings: the problem line (10-04), R300 (the guarantee), R103 (no competitors). Numbers: docs/reports/
 * 2026-10-09-business-model-analysis.md and research/new/14.
 */

const outfit = Outfit({ subsets: ["latin"], weight: ["500", "600", "700"], variable: "--font-display" });
const albert = Albert_Sans({ subsets: ["latin"], weight: ["400", "600"], variable: "--font-body" });

export const metadata: Metadata = {
  title: "Sprouts deck",
  description: "Your spare change, planted on your Seeker.",
  robots: { index: false },
};

const CSS = `
.deck { --paper:#FFFCF6; --sheet:#F4EEDF; --ink:#2B2622; --muted:#6E6A64; --leaf:#1E6B44; --chip:#DCEBDD; --rule:#E6DFD2;
  background:#E9E3D6; color:var(--ink); font-family:var(--font-body), "Helvetica Neue", Arial, sans-serif;
  min-height:100vh; padding:2vh 0; display:grid; gap:2vh; justify-items:center; scroll-snap-type:y mandatory; }
.deck .slide { --u: 1cqw; position:relative; width:min(96vw, calc(96vh * 16 / 9)); aspect-ratio:16 / 9; container-type:inline-size;
  background:var(--paper); border-radius:.6vw; overflow:hidden; scroll-snap-align:center; box-shadow:0 1px 3px rgba(0,0,0,.08); }
.deck .in { position:absolute; inset:0; padding:calc(var(--u)*6.6) calc(var(--u)*6.6) calc(var(--u)*5); display:flex; flex-direction:column; }
.deck .chip { align-self:flex-start; background:var(--chip); color:var(--leaf); font-weight:600; font-size:calc(var(--u)*1.35);
  padding:calc(var(--u)*.45) calc(var(--u)*1.2); border-radius:999px; letter-spacing:.01em; }
.deck h1, .deck h2 { font-family:var(--font-display), "Avenir Next", sans-serif; font-weight:700; letter-spacing:-.035em; line-height:.98; margin:0; color:var(--ink); }
.deck h1, .deck h2 { text-wrap:balance; }
.deck .steps li, .deck .sub { text-wrap:pretty; }
.deck h1 { font-size:calc(var(--u)*5.8); }
.deck h2 { font-size:calc(var(--u)*5.6); }
.deck .grow { flex:1; display:flex; flex-direction:column; justify-content:center; gap:calc(var(--u)*2.4); }
.deck .sub { font-size:calc(var(--u)*1.9); line-height:1.4; color:var(--muted); max-width:calc(var(--u)*60); margin:0; }
.deck .sub b { color:var(--ink); font-weight:600; }
.deck .num { position:absolute; right:calc(var(--u)*6.6); bottom:calc(var(--u)*3.4); font-size:calc(var(--u)*1.1); color:#A8A29A; }
.deck .note { font-size:calc(var(--u)*1.05); color:#A8A29A; margin:0; }
.deck .split { display:grid; grid-template-columns:1.1fr .9fr; align-items:center; gap:calc(var(--u)*3); flex:1; }
.deck .split .grow { flex:none; }
.deck .art { width:100%; height:auto; display:block; }
.deck .brand { display:flex; align-items:center; gap:calc(var(--u)*1); font-family:var(--font-display), sans-serif; font-weight:600;
  letter-spacing:-.02em; font-size:calc(var(--u)*2.2); color:var(--leaf); }
.deck .brand img { width:calc(var(--u)*3.2); height:auto; }
.deck .foot { font-size:calc(var(--u)*1.3); color:var(--muted); font-weight:600; }
.deck .beats { display:grid; grid-template-columns:repeat(3, 1fr); gap:calc(var(--u)*2); }
.deck .beat { background:var(--sheet); border-radius:calc(var(--u)*1); padding:calc(var(--u)*1.8); display:grid; gap:calc(var(--u)*.6); align-content:start; }
.deck .beat strong { font-family:var(--font-display), sans-serif; font-size:calc(var(--u)*1.9); letter-spacing:-.02em; color:var(--leaf); }
.deck .beat span { font-size:calc(var(--u)*1.45); line-height:1.4; }
.deck .h2s { font-size:calc(var(--u)*4.4); }
.deck .stats { display:grid; grid-template-columns:repeat(4, 1fr); gap:calc(var(--u)*2.5); }
.deck .stat strong { display:block; font-family:var(--font-display), sans-serif; font-size:calc(var(--u)*4); letter-spacing:-.03em; color:var(--leaf); line-height:1; }
.deck .stat span { display:block; font-size:calc(var(--u)*1.35); line-height:1.4; margin-top:calc(var(--u)*.8); }
.deck .steps { display:grid; gap:calc(var(--u)*1.1); margin:0; padding:0; list-style:none; counter-reset:st; }
.deck .steps li { counter-increment:st; display:grid; grid-template-columns:calc(var(--u)*3.4) 1fr; align-items:baseline; font-size:calc(var(--u)*1.75); line-height:1.4; }
.deck .steps li::before { content:counter(st); font-family:var(--font-display), sans-serif; font-weight:700; color:var(--leaf); font-size:calc(var(--u)*2.2); }
.deck .flow { display:flex; align-items:stretch; gap:calc(var(--u)*.8); }
.deck .flow div { flex:1; background:var(--sheet); border-radius:calc(var(--u)*.8); padding:calc(var(--u)*1.1) calc(var(--u)*1.2); display:grid; gap:calc(var(--u)*.35); align-content:start; }
.deck .flow div.key { background:var(--leaf); color:var(--paper); }
.deck .flow b { font-family:var(--font-display), sans-serif; font-size:calc(var(--u)*1.45); letter-spacing:-.01em; }
.deck .flow small { font-size:calc(var(--u)*1.05); line-height:1.35; opacity:.8; }
.deck .flow i { align-self:center; font-style:normal; color:var(--muted); font-size:calc(var(--u)*1.6); }
.deck .rows { display:grid; gap:calc(var(--u)*1.2); }
.deck .row { display:grid; grid-template-columns:calc(var(--u)*20) 1fr; gap:calc(var(--u)*2); align-items:baseline; border-top:1px solid var(--rule); padding-top:calc(var(--u)*1.2); }
.deck .row strong { font-family:var(--font-display), sans-serif; font-size:calc(var(--u)*2); letter-spacing:-.02em; color:var(--leaf); }
.deck .row span { font-size:calc(var(--u)*1.6); line-height:1.4; }
.deck .addr { font-family:ui-monospace, Menlo, monospace; font-size:calc(var(--u)*1.25); color:var(--muted); }
.deck video, .deck .poster { width:100%; height:auto; display:block; border-radius:calc(var(--u)*.8); }
.deck .poster { display:none; }
.deck .links { display:flex; flex-wrap:wrap; gap:calc(var(--u)*1) calc(var(--u)*3); font-size:calc(var(--u)*1.35); font-weight:600; color:var(--leaf); }
.deck .hero { max-width:calc(var(--u)*50); }
.deck .phone { position:absolute; left:calc(var(--u)*61); top:calc(var(--u)*6); width:calc(var(--u)*29); height:calc(var(--u)*50.25); overflow:hidden; box-sizing:border-box; border-bottom-left-radius:0; border-bottom-right-radius:0; padding:calc(var(--u)*.9) calc(var(--u)*.9) 0;
  background:#1D2628; border-radius:calc(var(--u)*4.4) calc(var(--u)*4.4) 0 0; box-shadow:0 calc(var(--u)*1.5) calc(var(--u)*5) rgba(43,38,34,.22); }
.deck .phone img { display:block; width:100%; height:auto; border-radius:calc(var(--u)*3.6); }
.deck .sprout { position:absolute; right:calc(var(--u)*8); bottom:calc(var(--u)*2.4); height:calc(var(--u)*15); width:auto; }
.deck video.sprout { border-radius:0; }
.deck .print-only { display:none; }
.deck .note.left { max-width:calc(var(--u)*62); }
.deck .beats.center .beat { text-align:center; justify-items:center; }
.deck .beat .stage { height:calc(var(--u)*12); width:auto; margin-bottom:calc(var(--u)*.4); }
.deck .beats.big .beat { background:none; padding:0 calc(var(--u)*1); }
.deck .beats.big .stage { height:calc(var(--u)*20); margin-bottom:0; mix-blend-mode:multiply; }
.deck .narrow { max-width:calc(var(--u)*62); }
.deck .stack { display:grid; gap:calc(var(--u)*1.8); max-width:calc(var(--u)*44); }
.deck .stack div { display:grid; gap:calc(var(--u)*.4); }
.deck .stack strong { font-family:var(--font-display), sans-serif; font-size:calc(var(--u)*1.9); letter-spacing:-.02em; color:var(--leaf); }
.deck .stack span { font-size:calc(var(--u)*1.5); line-height:1.4; }
.deck .photo { position:absolute; top:0; right:0; bottom:0; width:44%; height:100%; object-fit:cover; }
.deck .on-art .num { display:none; }
.deck .photo-credit { position:absolute; left:calc(var(--u)*6.6); bottom:calc(var(--u)*3.4); font-size:calc(var(--u)*.9); color:#A8A29A; }
.deck .split.wide { grid-template-columns:.62fr 1.38fr; gap:calc(var(--u)*2); }
.deck .split.home { grid-template-columns:1fr auto; gap:calc(var(--u)*5); }
.deck .split.home video, .deck .split.home .poster { width:auto; height:calc(var(--u)*22); border-radius:calc(var(--u)*2); }
.deck .split.wide video, .deck .split.wide .poster { border-radius:0; }
.deck .sand { position:absolute; right:0; bottom:0; width:72%; height:auto; pointer-events:none; }   /* fades baked in (R-D50: Preview blocks CSS masks) */
.deck .in > .grow, .deck .in > .note { position:relative; z-index:1; }
.deck .tree { position:absolute; right:calc(var(--u)*-11); bottom:calc(var(--u)*-9); width:calc(var(--u)*35); height:auto; pointer-events:none; }
.deck .flow.short { max-width:calc(var(--u)*68); }
/* R-D34 slide 6 as a graph: change -> Yield Manager -> SKR / stORE / lending, and the dial's SKR floors as bars (manager.ts STOP_FLOOR) */
.deck .ym { display:grid; grid-template-columns:1fr calc(var(--u)*27); gap:calc(var(--u)*3); align-items:center; margin-top:calc(var(--u)*2.6); }
.deck .ym-flow { display:grid; grid-template-columns:calc(var(--u)*11.5) auto calc(var(--u)*18) auto 1fr; align-items:center; gap:calc(var(--u)*1); }
.deck .ym-flow > i { font-style:normal; color:var(--muted); font-size:calc(var(--u)*2.2); }
.deck .ym-box { position:relative; background:var(--sheet); border-radius:calc(var(--u)*.8); padding:calc(var(--u)*1.1) calc(var(--u)*1.3); display:grid; gap:calc(var(--u)*.35); }
.deck .ym-box b { font-family:var(--font-display), sans-serif; font-size:calc(var(--u)*1.6); letter-spacing:-.01em; }
.deck .ym-box small { font-size:calc(var(--u)*1.15); line-height:1.35; color:var(--muted); }
.deck .ym-box.key { background:var(--leaf); color:var(--paper); padding:calc(var(--u)*1.6) calc(var(--u)*1.5); }
.deck .ym-box.key b { font-size:calc(var(--u)*2.1); }
.deck .ym-box.key small { color:var(--paper); opacity:.85; }
.deck .ym-out { display:grid; gap:calc(var(--u)*1.3); }
.deck .ym-box.lend { border:2px solid var(--leaf); background:var(--paper); }
/* R-D36 (kemosabe via his note: brand stORE; his pick Option 2 = a band on this slide): ORE gold on the stORE box and a band under the graph */
.deck .ym-box.ore { background:#F3E6BE; box-shadow:inset 0 0 0 2px #C9A23A; }
.deck .ore-band { position:relative; z-index:1; display:flex; align-items:center; gap:calc(var(--u)*2.2); margin:calc(var(--u)*2.2) 0 calc(var(--u)*1.4); max-width:calc(var(--u)*86);
  background:linear-gradient(90deg, #2B2622, #3A3127); color:#F6EFD9; border-radius:calc(var(--u)*.9); padding:calc(var(--u)*1.3) calc(var(--u)*2); }
.deck .ore-band strong { font-family:var(--font-display), sans-serif; font-size:calc(var(--u)*2.6); letter-spacing:-.03em; color:#E2B84A; }
/* R-D51 MOCKUP 06b: the band as "Built to hold", SKR and stORE side by side (the script's line) */
.deck .hold-band { position:relative; z-index:1; display:grid; grid-template-columns:auto auto 1fr; align-items:center; gap:calc(var(--u)*2);
  margin:calc(var(--u)*1.6) 0 calc(var(--u)*1.2); max-width:calc(var(--u)*86); background:linear-gradient(90deg, #2B2622, #3A3127); color:#F6EFD9;
  border-radius:calc(var(--u)*.9); padding:calc(var(--u)*1.1) calc(var(--u)*2.2); }
.deck .hold-band > b { font-family:var(--font-display), sans-serif; font-size:calc(var(--u)*2.3); letter-spacing:-.03em; line-height:1; }
.deck .hold-band div { display:grid; gap:calc(var(--u)*.3); border-left:1px solid rgba(246,239,217,.18); padding-left:calc(var(--u)*2.2); }
.deck .hold-band strong { font-family:var(--font-display), sans-serif; font-size:calc(var(--u)*2); letter-spacing:-.03em; }
.deck .hold-band .skr strong { color:#F0A562; } .deck .hold-band .ore strong { color:#E2B84A; }
.deck .hold-band span { font-size:calc(var(--u)*1.3); line-height:1.35; }
.deck .ore-band p { margin:0; font-size:calc(var(--u)*1.45); line-height:1.4; }
.deck .ym-box em { position:absolute; top:calc(var(--u)*-.9); right:calc(var(--u)*1); font-style:normal; font-weight:700; font-size:calc(var(--u)*1); background:var(--leaf); color:var(--paper); border-radius:999px; padding:calc(var(--u)*.25) calc(var(--u)*.8); }
.deck .ym-dial { display:grid; gap:calc(var(--u)*1); background:var(--paper); border:1px solid var(--rule); border-radius:calc(var(--u)*.8); padding:calc(var(--u)*1.8) calc(var(--u)*2); }
.deck .ym-dial > b { font-family:var(--font-display), sans-serif; font-size:calc(var(--u)*2); letter-spacing:-.02em; }
.deck .ym-dial > small { font-size:calc(var(--u)*1.3); color:var(--muted); margin-top:calc(var(--u)*-.8); }
.deck .ym-row { display:grid; grid-template-columns:calc(var(--u)*7.6) 1fr calc(var(--u)*4.2); align-items:center; gap:calc(var(--u)*1); font-size:calc(var(--u)*1.45); }
.deck .ym-row strong { font-family:var(--font-display), sans-serif; color:var(--leaf); font-size:calc(var(--u)*1.8); text-align:right; }
.deck .ym-track { height:calc(var(--u)*1.6); background:var(--rule); border-radius:999px; overflow:hidden; }
.deck .ym-track div { height:100%; background:var(--leaf); border-radius:999px; }
.deck .one { white-space:nowrap; }
/* R-D49 slide 5: a row of plants along the bottom, five equal slots (azalea + maple now, future-coin concepts in the rest) */
.deck .split.home.above-plants { margin-bottom:calc(var(--u)*13); }
.deck .plants { position:absolute; left:calc(var(--u)*6.6); right:calc(var(--u)*6.6); bottom:calc(var(--u)*3); height:calc(var(--u)*11);
  display:grid; grid-template-columns:repeat(5, 1fr); gap:calc(var(--u)*2); align-items:end; justify-items:center; pointer-events:none; }
.deck .plants img { max-height:100%; max-width:100%; width:auto; height:calc(var(--u)*8.2); object-fit:contain; }
/* R-D47 cover (slide 0): the mature SKR mandarin centred, the ink lockup small at the bottom */
.deck .cover-tree { position:absolute; left:50%; top:calc(var(--u)*6); height:calc(var(--u)*36); width:auto; transform:translateX(-50%); }
.deck .cover-lockup { position:absolute; left:50%; bottom:calc(var(--u)*4.2); width:calc(var(--u)*12); height:auto; transform:translateX(-50%); }
/* R-D47 slide 6: the geode (stORE) and the mandarin's crown (SKR) oversized, poking in from each box's bottom right */
.deck .ym-box.pic { overflow:hidden; min-height:calc(var(--u)*5.6); }
.deck .ym-box.pic > b, .deck .ym-box.pic > small { position:relative; z-index:1; }
.deck .ym-box.pic img { position:absolute; right:calc(var(--u)*-3.2); bottom:calc(var(--u)*-1.5); height:calc(var(--u)*7.6); width:auto; pointer-events:none; }
.deck .ym-box.skr { background:#FBE9D4; box-shadow:inset 0 0 0 2px #E39A4C; }
.deck .ym-box.skr img { right:calc(var(--u)*-2.6); bottom:calc(var(--u)*-2.4); height:calc(var(--u)*8.4); }
.deck .sub.full { max-width:none; }
.deck .sub.dial { max-width:calc(var(--u)*66); }
.deck .who { position:absolute; right:calc(var(--u)*6.6); top:calc(var(--u)*6.6); display:grid; justify-items:center; gap:calc(var(--u)*1);
  font-size:calc(var(--u)*1.6); font-weight:600; color:var(--leaf); text-decoration:none; }
.deck .pfp { width:calc(var(--u)*14); height:calc(var(--u)*14); border-radius:calc(var(--u)*1.4); image-rendering:pixelated; flex:none; }
.deck .thanks { position:absolute; right:calc(var(--u)*6.6); bottom:calc(var(--u)*4.4); font-family:var(--font-display), sans-serif; font-weight:700;
  letter-spacing:-.035em; font-size:calc(var(--u)*5.6); color:var(--leaf); margin:0; }
.deck .links a { color:inherit; text-decoration:none; }
.deck .on-art .links { max-width:calc(var(--u)*56); }
.deck .todo { background:#FFF1B8; color:#5C4A00; border-radius:4px; padding:0 .3em; }
.deck .bar { position:fixed; right:16px; bottom:16px; display:flex; gap:8px; z-index:2; }
.deck .bar a, .deck .bar button { font:600 13px var(--font-body), sans-serif; background:var(--ink); color:var(--paper); border:0; border-radius:999px; padding:9px 14px; cursor:pointer; text-decoration:none; }
@media screen and (max-width: 760px) {
  .deck { scroll-snap-type:none; padding:0; gap:0; }
  .deck .one { white-space:normal; } .deck .who { position:static; justify-items:start; } .deck .pfp { width:96px; height:96px; }
  .deck .slide { --u: 2.1vw; width:100%; aspect-ratio:auto; border-radius:0; box-shadow:none; border-bottom:1px solid var(--rule); }
  .deck .in { position:relative; inset:auto; padding:48px 16px 56px; gap:28px; min-height:80vh; }
  .deck h1 { font-size:42px; } .deck h2 { font-size:36px; }
  .deck .sub { font-size:18px; } .deck .chip { font-size:13px; padding:5px 12px; }
  .deck .split, .deck .split.wide, .deck .split.home, .deck .beats, .deck .stats, .deck .row { grid-template-columns:1fr; }
  .deck .bar { display:none; }
  .deck .flow { flex-direction:column; } .deck .flow i { transform:rotate(90deg); align-self:center; }
  .deck .h2s { font-size:30px; } .deck .steps li { font-size:16px; grid-template-columns:28px 1fr; } .deck .steps li::before { font-size:20px; }
  .deck .flow b { font-size:16px; } .deck .flow small { font-size:13px; } .deck .row strong { font-size:20px; } .deck .row span { font-size:15px; }
  .deck .beat strong { font-size:19px; } .deck .beat span, .deck .stat span { font-size:15px; }
  .deck .stat strong { font-size:34px; }
  .deck .num { right:16px; bottom:20px; font-size:12px; } .deck .note, .deck .addr { font-size:12px; }
  .deck .phone { position:relative; left:auto; top:auto; width:100%; height:auto; overflow:hidden; border-radius:36px; padding:8px; }
  .deck .phone img { border-radius:30px; }
  .deck .split.home video, .deck .split.home .poster { width:100%; height:auto; }
  .deck .hold-band { grid-template-columns:1fr; gap:12px; padding:16px; } .deck .hold-band div { border-left:0; padding-left:0; } .deck .hold-band > b { font-size:22px; } .deck .hold-band strong { font-size:20px; } .deck .hold-band span { font-size:14px; }
  .deck .plants { position:static; height:auto; grid-template-columns:repeat(2, 1fr); } .deck .split.home.above-plants { margin-bottom:0; }
  .deck .sprout, .deck video.sprout { position:static; height:220px; width:auto; align-self:center; } .deck .cover-tree, .deck .cover-lockup { position:static; transform:none; align-self:center; } .deck .cover-tree { height:300px; } .deck .cover-lockup { width:160px; } .deck .tree { display:none; } .deck .thanks { position:static; font-size:36px; } .deck .flow.short { max-width:none; } .deck .photo { position:relative; width:100%; height:auto; }
  .deck .sand { position:static; width:100%; margin-top:-24px; } .deck .ym, .deck .ym-flow { grid-template-columns:1fr; } .deck .ym-flow > i { transform:rotate(90deg); justify-self:center; } .deck .ym-box b { font-size:17px; } .deck .ym-box.key b { font-size:20px; } .deck .ym-box small, .deck .ym-dial > small { font-size:13px; } .deck .ym-dial > b { font-size:20px; } .deck .ym-row { font-size:15px; grid-template-columns:80px 1fr 44px; } .deck .ym-row strong { font-size:17px; } .deck .ym-track { height:12px; } .deck .ym-box em { font-size:11px; top:-9px; } .deck .ore-band { flex-direction:column; align-items:flex-start; gap:6px; padding:14px 16px; } .deck .ore-band strong { font-size:24px; } .deck .ore-band p { font-size:14px; } .deck .stack, .deck .narrow, .deck .hero { max-width:none; }
  .deck .brand { font-size:22px; } .deck .brand img { width:30px; } .deck .foot, .deck .links { font-size:15px; }
}
@page { size:1920px 1080px; margin:0; }
@media print {
  html, body { background:#FFFCF6 !important; }
  .deck { background:none; padding:0; gap:0; display:block; }
  .deck .slide { width:1920px; height:1080px; aspect-ratio:auto; border-radius:0; box-shadow:none; break-after:page; --u: 19.2px; }
  .deck .bar { display:none; }
  .deck .phone { box-shadow:none; }   /* R-D47: Chrome prints the blurred shadow as a raster tile that Preview draws as a grey box */
  .deck video { display:none; } .deck .poster { display:block; }
  .deck .screen-only { display:none !important; } .deck .print-only { display:block; }
  .deck * { -webkit-print-color-adjust:exact; print-color-adjust:exact; }
}
`;

function Slide({ n, label, chip, art, children }: { n: number; label?: string; chip?: string; art?: boolean; children: React.ReactNode }) {
  return (
    <section className={art ? "slide on-art" : "slide"} id={`s${label ?? n}`} aria-label={`Slide ${label ?? n}`}>
      <div className="in">
        {chip ? <span className="chip">{chip}</span> : null}
        {children}
      </div>
      <span className="num">{label ?? String(n).padStart(2, "0")}</span>
    </section>
  );
}

export default function Deck() {
  return (
    <main className={`deck ${outfit.variable} ${albert.variable}`}>
      <style>{CSS}</style>
      <DeckKeys />

      {/* 00 Cover (R-D47): the mature SKR mandarin, the ink lockup small under it */}
      <Slide n={0} art>
        <img className="cover-tree" src="/deck/cover-tree.webp" alt="A grown mandarin tree, painted" />
        <img className="cover-lockup" src="/deck/lockup-ink.png" alt="Sprouts" />
      </Slide>

      {/* 01 Hook */}
      <Slide n={1} art>
        <div className="grow hero">
            <div className="brand">
              <img src="/deck/mark.svg" alt="" />
              Sprouts
            </div>
            <h1>Your spare change, planted on your Seeker.</h1>
            <p className="sub">Sprouts rounds up every swap your linked wallets make and plants the change in store of value tokens like SKR and stORE, kept in your Seed Vault and grown by an AI&nbsp;Yield&nbsp;Manager.</p>
        </div>
        <div className="phone"><img src="/deck/home.webp" alt="Sprouts on a phone: the garden, and under it the coins it holds" /></div>
        <span className="foot">CLOCK IN · Solana Mobile Hackathon 2026</span>
      </Slide>

      {/* 02 The opportunity (R-D24): the 10-04 problem line, verbatim, turned toward what the swaps make possible */}
      <Slide n={2} chip="The opportunity">
        <div className="grow">
          <h2 className="one">Traders rarely set money aside.<br />Their swaps can do it for them.</h2>
          <p className="sub full">
            Their money sits in the hot wallet they trade from, and nobody stops mid-trade to save. Every swap can set a little change aside.
          </p>
        </div>
        <p className="note left" style={{ maxWidth: "calc(var(--u)*56)" }}>Seeker owners who stake SKR swap a median of 23 times a month, mostly under $10 (on-chain sample of 163 recently active stakers, Sept 2026).</p>
        {/* R-D47 (R-D31 as he meant it): the sprout swaying on the app's first screen (app/assets/signin, R445 B2), not the splash tree */}
        <video className="sprout" src="/deck/sprout.mp4" poster="/deck/sprout.webp" autoPlay muted loop playsInline preload="metadata" aria-label="A sprout swaying, from the app's first screen" />
        <img className="sprout poster" src="/deck/sprout.webp" alt="" />
      </Slide>

      {/* 03 How it works: any swap, any app (his note 2); the decision removed (the cut table, R-D7) */}
      <Slide n={3} chip="How it works">
        <div className="grow">
          <h2 className="h2s">Every swap rounds up. Your Seeker keeps the change.</h2>
          <div className="beats center big">
            <div className="beat">
              <img className="stage" src="/deck/grow-1-fade.webp" alt="" />
              <strong>Any swap, any app</strong>
              <span>Each swap rounds up to the next dollar. You choose the extras and a daily limit.</span>
            </div>
            <div className="beat">
              <img className="stage" src="/deck/grow-2-fade.webp" alt="" />
              <strong>Planted each morning</strong>
              <span>At 7&nbsp;AM, Sprouts buys your coins with the change you saved, up to $5 a day.</span>
            </div>
            <div className="beat">
              <img className="stage" src="/deck/grow-3-fade.webp" alt="" />
              <strong>Kept on your Seeker</strong>
              <span>Sprouts stakes SKR, mines stORE and lends USDC and SOL, all from your Seed Vault.</span>
            </div>
          </div>
        </div>
      </Slide>

      {/* 04 The Seed Vault (his note 1). Saga is also accepted (R86), so "built for", never "only works on". */}
      <Slide n={4} chip="Built for Seeker" art>
        <div className="grow">
          <h2 className="h2s narrow" style={{ maxWidth: "calc(var(--u)*46)" }}>Your savings live in the Seed Vault.</h2>
          <div className="stack">
            <div>
              <strong>Not in a hot wallet</strong>
              <span>Held by your Seeker&apos;s secure hardware, away from your trading wallet.</span>
            </div>
            <div>
              <strong>Only you take it out</strong>
              <span>Withdrawals need your fingerprint on the Seed Vault.</span>
            </div>
            <div>
              <strong>One phone, one garden</strong>
              <span>Sign in with your Genesis Token. Your garden carries your .skr name.</span>
            </div>
          </div>
        </div>
        <img className="photo" src="/deck/seeker-vault.webp" alt="A Solana Seeker, Seed Vault on the back, Sprouts on the screen" />
        <span className="photo-credit">Seeker render: Solana Mobile press kit. Screen: Sprouts.</span>
      </Slide>

      {/* 05 Garden: demo + why people come back (R-D5) */}
      <Slide n={5} chip="Why you come back">
        <h2 className="h2s one" style={{ margin: "calc(var(--u)*2.6) 0 calc(var(--u)*1.2)" }}>A garden that grows every time you swap.</h2>
        <div className="split home above-plants">
          <div className="grow">
            <ol className="steps">
              <li>Each coin grows with every planting. stORE is a geode you dig up.</li>
              <li>A notification when your change is planted.</li>
              <li>A home screen widget with your garden.</li>
            </ol>
            <p className="note">
              Two simulated years at $32 a month, the top quarter of Seeker traders. <span className="todo">Demo video link goes here.</span>
            </p>
          </div>
          <div>
            <video src="/deck/widget-years.mp4" poster="/deck/widget-years.webp" autoPlay muted loop playsInline preload="metadata" aria-label="The Sprouts widget on a Seeker home screen, its garden growing over two simulated years" />
            <img className="poster" src="/deck/widget-years.webp" alt="The Sprouts widget on a Seeker home screen after two simulated years" />
          </div>
        </div>
        <div className="plants" aria-hidden="true">
          <img src="/deck/plant-azalea.webp" alt="" />
          <img src="/deck/plant-maple.webp" alt="" />
        </div>
      </Slide>

      {/* 06 Yield Manager (his note 6; R-D27 smart + helpful, chip 'Yield Manager'): split-run.ts, lending-leash spec 3-4, R347 */}
      <Slide n={6} chip="Yield Manager">
        <div className="grow">
          <h2 className="h2s one">Your round-ups, put to work while you sleep.</h2>
          <div className="ym">
            <div className="ym-flow">
              <div className="ym-box"><b>Your change</b><small>from every swap</small></div>
              <i>&rarr;</i>
              <div className="ym-box key"><b>Yield Manager</b><small>Each morning it reads live rates and sends new change where it pays best. It skips rates propped up by short-term rewards and never sells what you hold.</small></div>
              <i>&rarr;</i>
              <div className="ym-out">
                <div className="ym-box pic skr"><b>SKR</b><small>staked</small><img src="/deck/box-skr-fade.webp" alt="" /></div>
                <div className="ym-box pic ore"><b>stORE</b><small>mining ORE</small><img src="/deck/box-geode-fade.webp" alt="" /></div>
                <div className="ym-box lend"><b>USDC and SOL</b><small>lent on Kamino or Jupiter Lend</small><em>Pro</em></div>
              </div>
            </div>
            <div className="ym-dial">
              <b>The risk dial you set</b>
              <small>the least it keeps in SKR</small>
              {([["Careful", 50], ["Balanced", 35], ["Bold", 25]] as const).map(([k, v]) => (
                <div className="ym-row" key={k}><span>{k}</span><div className="ym-track"><div style={{ width: `${v}%` }} /></div><strong>{v}%</strong></div>
              ))}
            </div>
          </div>
        </div>
        <div className="ore-band">
          <strong>stORE</strong>
          <p>Staked ORE, a store of value token that keeps mining. Your change mines ORE from the first planting, free on every plan.</p>
        </div>
        <p className="note">Part of Pro, free during launch. The AI model never picks the lender or moves money. Code does both.</p>
        <img className="sand" src="/deck/sand-fade.webp" alt="" />
      </Slide>

      {/* 06b MOCKUP (R-D51, his Option 1): slide 6 with the band as 'Built to hold', SKR + stORE. Delete one of 06 / 06b after his pick. */}
      {/* 06 Yield Manager (his note 6; R-D27 smart + helpful, chip 'Yield Manager'): split-run.ts, lending-leash spec 3-4, R347 */}
      <Slide n={6} label="06b" chip="Yield Manager">
        <div className="grow">
          <h2 className="h2s one">Your round-ups, put to work while you sleep.</h2>
          <div className="ym">
            <div className="ym-flow">
              <div className="ym-box"><b>Your change</b><small>from every swap</small></div>
              <i>&rarr;</i>
              <div className="ym-box key"><b>Yield Manager</b><small>Each morning it reads live rates and sends new change where it pays best. It skips rates propped up by short-term rewards and never sells what you hold.</small></div>
              <i>&rarr;</i>
              <div className="ym-out">
                <div className="ym-box pic skr"><b>SKR</b><small>staked</small><img src="/deck/box-skr-fade.webp" alt="" /></div>
                <div className="ym-box pic ore"><b>stORE</b><small>mining ORE</small><img src="/deck/box-geode-fade.webp" alt="" /></div>
                <div className="ym-box lend"><b>USDC and SOL</b><small>lent on Kamino or Jupiter Lend</small><em>Pro</em></div>
              </div>
            </div>
            <div className="ym-dial">
              <b>The risk dial you set</b>
              <small>the least it keeps in SKR</small>
              {([["Careful", 50], ["Balanced", 35], ["Bold", 25]] as const).map(([k, v]) => (
                <div className="ym-row" key={k}><span>{k}</span><div className="ym-track"><div style={{ width: `${v}%` }} /></div><strong>{v}%</strong></div>
              ))}
            </div>
          </div>
        </div>
        <div className="hold-band">
          <b>Built to hold.</b>
          <div className="skr"><strong>SKR</strong><span>The Seeker&apos;s own token, staked right on your phone.</span></div>
          <div className="ore"><strong>stORE</strong><span>Puts ORE to work as it sits. Free on every plan.</span></div>
        </div>
        <p className="note">Part of Pro, free during launch. The AI model never picks the lender or moves money. Code does both.</p>
        <img className="sand" src="/deck/sand-fade.webp" alt="" />
      </Slide>

      {/* 07 Safety + how it's built (R300 as the sub, R-D6, R-D18 trust line); R-D26: inviting, not defensive */}
      <Slide n={7} chip="Your money stays yours">
        <div className="grow">
          <h2 className="h2s" style={{ maxWidth: "calc(var(--u)*62)" }}>Your money only moves into your savings.</h2>
          <p className="sub" style={{ maxWidth: "calc(var(--u)*54)" }}>
            An on-chain leash lets Sprouts move at most $5 a day per wallet, and only into savings you hold. Not even our server can send it anywhere else.
          </p>
          <div className="flow short">
            <div><b>You swap</b><small>in any app</small></div>
            <i>→</i>
            <div><b>Sprouts sets it aside</b><small>the round-up</small></div>
            <i>→</i>
            <div className="key"><b>The leash checks it</b><small>$5 a day, only into your savings</small></div>
            <i>→</i>
            <div><b>Your Seed Vault keeps it</b><small>bought on Jupiter, staked or lent</small></div>
          </div>
          <p className="note" style={{ maxWidth: "calc(var(--u)*64)" }}>
            Built with Expo, React Native, Mobile Wallet Adapter, Helius, Next.js and Supabase. Leash build verified against its public
            source (GyBmDLN72kg6xwAnZfj9c7fjeaJ3GvhkHNhFns83f8f7).
          </p>
        </div>
        <img className="tree" src="/deck/tree.png" alt="" />
      </Slide>

      {/* 08 Market (R-D3: market data, not our DB) */}
      <Slide n={8} chip="Who it's for">
        <div className="grow">
          <h2 className="h2s">Every Seeker owner, from their first swap.</h2>
          <div className="stats">
            <div className="stat"><strong>120k</strong><span>Seekers activated, each with the dApp Store built in.</span></div>
            <div className="stat"><strong>$380</strong><span>a year saved by the top quarter of active traders.</span></div>
            <div className="stat"><strong>$240</strong><span>a year saved by a new owner who swaps.</span></div>
            <div className="stat"><strong>$2.9M</strong><span>a year saved on Seeker if 1 in 10 owners joins.</span></div>
          </div>
          <p className="sub">For new owners, Sprouts is a first app worth opening every day.</p>
        </div>
        <p className="note">Sources: Dune, Genesis activations (Aug 2026); our on-chain samples of 163 recently active SKR stakers (75th percentile $32 a month) and 46 recently activated Seekers that swapped (median $20 a month), round-up to $1 plus 1% of swaps over $100 (Sept 2026). $2.9M = 12,000 owners at $20 a month.</p>
      </Slide>

      {/* 09 Business: Seeker and Solana Mobile only (R-D4); Pro = manager + auto-lending + tax pack (R446c); docs/reports/2026-10-09-business-model-analysis.md */}
      <Slide n={9} chip="Business model">
        <div className="grow">
          <h2 className="h2s">Sprouts grows with Solana Mobile.</h2>
          <div className="rows">
            <div className="row"><strong>$200 to $380 a year</strong><span>saved by an active trader, from the median to the top quarter. It stays theirs.</span></div>
            <div className="row"><strong>0.5% planting fee</strong><span>We keep half a cent of every dollar planted in coins, paid in USDC.</span></div>
            <div className="row"><strong>Pro subscription</strong><span>Yield Manager, automatic lending and tax export. Free during launch. Acorns proved this model.</span></div>
            <div className="row"><strong>Good for SKR</strong><span>Sprouts has no token of its own, and every saver buys SKR.</span></div>
          </div>
        </div>
      </Slide>

      {/* 10 Team + links; R-D19 live line; R-D28 his Validators pfp #14, x.com/donlucas, a Thank you opposite the title */}
      <Slide n={10} chip="Team" art>
        <div className="grow">
          <h2>Built by donlucas.</h2>
          <p className="sub">
            On Solana since 2021. Founded Validators on Eclipse and, with his team, built some of the chain&apos;s first NFT
            infrastructure, which is still live. Their blip won Eclipse&apos;s hackathon infrastructure track. Also ships xscapes, an
            open-source tool for AI agents.
          </p>
          <p className="sub">Built with Claude Code: the app, the API and the on-chain leash.</p>
          <p className="sub"><b>Live on Solana mainnet and in review on the Solana dApp Store.</b></p>
          <div className="links">
            <a href="https://sprouts.money">sprouts.money</a>
            <a href="https://x.com/sproutsonseeker">@sproutsonseeker</a>
            <a href="mailto:hello@sprouts.money">hello@sprouts.money</a>
          </div>
        </div>
        <a className="who" href="https://x.com/donlucas">
          <img className="pfp" src="/deck/pfp.png" alt="donlucas: Validators #14" />
          <span>@donlucas</span>
        </a>
        <p className="thanks">Thank you.</p>
      </Slide>

      <div className="bar">
        <a href="#s1">Top</a>
        <DeckKeys printButton />
      </div>
    </main>
  );
}
