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
.deck .ym-flow { display:grid; grid-template-columns:calc(var(--u)*11.5) auto calc(var(--u)*21) auto 1fr; align-items:center; gap:calc(var(--u)*1); }
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
/* R-D70 (his yes R-D73): the video's painted green marker behind the end of each headline (a stretched brush strip, lower half of the line) */
.deck .mk { background:url(/deck/marker.png) no-repeat; background-size:calc(100% + .3em) 52%; background-position:-.12em 92%;
  -webkit-box-decoration-break:clone; box-decoration-break:clone; padding:0 .06em; }
/* R-D70  slide 9: the sources line on clean paper (kept left, where the sand has faded out), a touch darker. No text-shadow: Chrome prints it as boxes */
.deck #s9 .note { color:#8A847B; max-width:calc(var(--u)*44); }
/* R-D73 slide 12 (12b2): the garden placed by where its crowns start (43% down the sky-extended image); the line in the sky */
.deck .eb { position:absolute; height:auto; }
.deck .eb-m { display:none; }   /* R-D74: the phone shows a portrait crop instead */
.deck img.eb { left:0; top:calc(var(--u)*-20.6); width:calc(var(--u)*100); }   /* R-D74: his pick is 12b1 (the whole middle garden), not 12b2 */
.deck .ebt { position:absolute; margin:0; font-family:var(--font-display), sans-serif; font-weight:700; letter-spacing:-.045em; line-height:1; color:var(--ink); z-index:1; }
.deck p.ebt { left:0; right:0; top:calc(var(--u)*5.5); text-align:center; font-size:calc(var(--u)*11); }
.deck .ebl { position:absolute; left:calc(var(--u)*4); top:calc(var(--u)*4); width:calc(var(--u)*9); height:auto; z-index:1; }
/* R-D65 slide 6: three lines; the four concept plants, a stake beside each (the garden's own sprite + lettering, STAKE in
   model/garden2.ts); the hand + Seeker bottom right, at most a third of the width */
.deck .steps.g6 { max-width:calc(var(--u)*64); margin-top:calc(var(--u)*1.4); position:relative; z-index:1; }
.deck .plants { position:absolute; left:calc(var(--u)*6.6); width:calc(var(--u)*40); bottom:calc(var(--u)*3);
  display:grid; grid-template-columns:repeat(4, 1fr); grid-template-rows:auto auto; column-gap:calc(var(--u)*1.6); row-gap:calc(var(--u)*1.2); align-items:end; }
.deck .plants .pnote { grid-column:1 / -1; grid-row:1; margin:0; justify-self:end; font-family:var(--font-display), sans-serif; font-weight:600;
  font-size:calc(var(--u)*1.2); letter-spacing:-.01em; color:var(--ink); }
.deck .plants figure { grid-row:2; margin:0; position:relative; display:flex; justify-content:center; align-items:flex-end; }
.deck .plants figure > img { height:calc(var(--u)*7.4); width:auto; max-width:100%; object-fit:contain; }
.deck .plants .stake { position:absolute; right:calc(var(--u)*-.9); bottom:calc(var(--u)*-.5); width:calc(var(--u)*4.2); height:calc(var(--u)*2.4); }
.deck .plants .stake img { width:100%; height:100%; display:block; }
.deck .plants .stake b { position:absolute; left:calc(2 / 140 * 100%); top:calc((1 + 34 * .05) / 80 * 100%); width:calc(136 / 140 * 100%); height:calc(34 / 80 * 100%);
  display:flex; align-items:center; justify-content:center; font-family:var(--font-display), sans-serif; font-weight:700;
  font-size:calc(var(--u)*4.2 * 27 / 140); line-height:1; color:#3B2A1A; opacity:.9; }
.deck .hand { position:absolute; right:calc(var(--u)*2.4); bottom:0; width:calc(var(--u)*32); height:auto; }
/* R-D47 cover (slide 0): the mature SKR mandarin centred, the ink lockup small at the bottom */
.deck .cover-tree { position:absolute; left:50%; top:calc(var(--u)*8.5); height:calc(var(--u)*36); width:auto; transform:translateX(-50%); }
.deck .sand-lines { position:absolute; right:0; bottom:0; width:78%; height:auto; pointer-events:none; }   /* R-D66 slide 9: the plate's raked lines + upper rings, fades baked */
.deck .in > .note { position:relative; z-index:1; }
.deck .cover-sprout, .deck video.cover-sprout { position:absolute; left:50%; top:calc(var(--u)*13.5); height:calc(var(--u)*30); width:auto; transform:translateX(-50%); border-radius:0; }
.deck .cover-lockup { position:absolute; left:50%; bottom:calc(var(--u)*6.4); width:calc(var(--u)*12); height:auto; transform:translateX(-50%); }
/* R-D47 slide 6: the geode (stORE) and the mandarin's crown (SKR) oversized, poking in from each box's bottom right */
.deck .ym-box.pic { overflow:hidden; min-height:calc(var(--u)*5.6); }
.deck .ym-box.pic > b, .deck .ym-box.pic > small { position:relative; z-index:1; }
.deck .ym-box.pic img { position:absolute; right:calc(var(--u)*-3.2); bottom:calc(var(--u)*-1.5); height:calc(var(--u)*7.6); width:auto; pointer-events:none; }
.deck .ym-box.skr { background:#FBE9D4; box-shadow:inset 0 0 0 2px #E39A4C; }
.deck .ym-box.skr img { right:calc(var(--u)*-2.6); bottom:calc(var(--u)*-2.4); height:calc(var(--u)*8.4); }
.deck .sub.full { max-width:none; }
.deck .sub.dial { max-width:calc(var(--u)*66); }
.deck .grow.founder { justify-content:flex-start; margin-top:calc(var(--u)*2); gap:calc(var(--u)*1.6); max-width:calc(var(--u)*64); }
.deck .grow.founder .sub { font-size:calc(var(--u)*1.7); }
.deck .who { position:absolute; right:calc(var(--u)*6.6); top:calc(var(--u)*10.4); display:grid; justify-items:center; gap:calc(var(--u)*1);
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
  .deck .plants { position:static; width:auto; grid-template-columns:repeat(2, 1fr); } .deck .plants figure { grid-row:auto; } .deck .hand { position:static; width:100%; max-width:360px; align-self:center; } .deck .split.home.above-plants { margin-bottom:0; }
  .deck .sprout, .deck video.sprout { position:static; height:220px; width:auto; align-self:center; } .deck .cover-sprout, .deck video.cover-sprout, .deck .cover-tree, .deck .cover-lockup, .deck .eb, .deck .ebt, .deck .ebl { position:static; transform:none; align-self:center; } .deck .cover-tree { height:300px; } .deck .cover-lockup { width:160px; } .deck .tree { display:none; } .deck .thanks { position:static; font-size:36px; } .deck .flow.short { max-width:none; } .deck .photo { position:relative; width:100%; height:auto; }
  .deck .sand { position:static; width:100%; margin-top:-24px; } .deck .ym, .deck .ym-flow { grid-template-columns:1fr; } .deck .ym-flow > i { transform:rotate(90deg); justify-self:center; } .deck .ym-box b { font-size:17px; } .deck .ym-box.key b { font-size:20px; } .deck .ym-box small, .deck .ym-dial > small { font-size:13px; } .deck .ym-dial > b { font-size:20px; } .deck .ym-row { font-size:15px; grid-template-columns:80px 1fr 44px; } .deck .ym-row strong { font-size:17px; } .deck .ym-track { height:12px; } .deck .ym-box em { font-size:11px; top:-9px; } .deck .ore-band { flex-direction:column; align-items:flex-start; gap:6px; padding:14px 16px; } .deck .ore-band strong { font-size:24px; } .deck .ore-band p { font-size:14px; } .deck .stack, .deck .narrow, .deck .hero { max-width:none; }
  .deck .brand { font-size:22px; } .deck .brand img { width:30px; } .deck .foot, .deck .links { font-size:15px; }
  /* R-D68 phone pass: no sand blocks under the text; stakes inside their cell and readable; the credit readable; the end stack centred */
  .deck .sand, .deck .sand-lines { display:none; }
  .deck .plants .stake { right:0; bottom:-4px; width:64px; height:37px; } .deck .plants .stake b { font-size:12px; } .deck .plants figure > img { height:120px; }
  .deck .photo-credit { position:static; font-size:11px; }
  .deck p.ebt { text-align:center; font-size:48px; } .deck img.eb { width:100%; height:auto; } .deck .ebl { width:110px; align-self:center; }
  .deck img.eb { display:none; } .deck .eb-m { display:block; width:100%; height:auto; }
  /* R-D74 phone pass 2 */
  .deck #s1 .in { align-items:center; justify-content:center; gap:20px; } .deck #s1 .cover-sprout { height:auto; width:78vw; } .deck #s1 .cover-lockup { width:40vw; }
  .deck .stack { justify-items:center; text-align:center; gap:24px; } .deck .stack strong { font-size:21px; } .deck .stack span { font-size:16px; }
  .deck .plants { grid-template-columns:repeat(4, 1fr); width:70%; margin-left:auto; column-gap:8px; } .deck .plants .pnote { justify-self:end; font-size:13px; }
  .deck .plants figure > img { height:64px; } .deck .plants .stake { right:-6px; bottom:-4px; width:40px; height:23px; } .deck .plants .stake b { font-size:8px; }
  .deck .ym-flow { justify-items:center; } .deck .ym-flow > .ym-box:first-child { width:62%; } .deck .ym-box.key { width:88%; }
  .deck .ym-out { grid-template-columns:repeat(3, 1fr); width:100%; gap:8px; } .deck .ym-out .ym-box { min-height:150px; align-content:start; padding:12px 10px; }
  .deck .ym-out .ym-box b { font-size:15px; } .deck .ym-out .ym-box small { font-size:12px; } .deck .ym-box.pic img { height:96px; right:-14px; bottom:-10px; }
  .deck #s11 .chip { order:0; } .deck #s11 .who { order:1; } .deck #s11 .grow { order:2; } .deck #s11 .in { gap:18px; }
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

      {/* 01 Cover (R-D47, R-D53): the app's first-screen sprout swaying (SigninSprout), the ink lockup small at the bottom */}
      <Slide n={1} art>
        <video className="cover-sprout" src="/deck/sprout.mp4" poster="/deck/sprout.webp" autoPlay muted loop playsInline preload="metadata" aria-label="A sprout swaying, from the app's first screen" />
        <img className="cover-sprout poster" src="/deck/sprout.webp" alt="" />
        <img className="cover-lockup" src="/deck/lockup-ink.png" alt="Sprouts" />
      </Slide>

      {/* 02 Hook */}
      <Slide n={2} art>
        <div className="grow hero">
            <div className="brand">
              <img src="/deck/mark.svg" alt="" />
              Sprouts
            </div>
            <h1>Your spare change, planted <span className="mk">on your Seeker.</span></h1>
            <p className="sub">Sprouts rounds up every swap your linked wallets make and plants the change in store of value tokens like SKR and stORE, kept in your Seed Vault and grown by an AI&nbsp;Yield&nbsp;Manager.</p>
        </div>
        <div className="phone"><img src="/deck/home.webp" alt="Sprouts on a phone: the garden, and under it the coins it holds" /></div>
        <span className="foot">CLOCK IN · Solana Mobile Hackathon 2026 · Radiants</span>
      </Slide>

      {/* 03 The opportunity (R-D24): the 10-04 problem line, verbatim, turned toward what the swaps make possible */}
      <Slide n={3} chip="The opportunity">
        <div className="grow">
          <h2 className="one">Traders rarely set money aside.<br />Their swaps can <span className="mk">do it for them.</span></h2>
          <p className="sub full">
            Their money sits in the hot wallet they trade from, and nobody stops mid-trade to save. Every swap can set a little change aside.
          </p>
        </div>
        <p className="note left" style={{ maxWidth: "calc(var(--u)*56)" }}>Seeker owners who stake SKR swap a median of 23 times a month, mostly under $10 (on-chain sample of 163 recently active stakers, Sept 2026).</p>
        {/* R-D47 (R-D31 as he meant it): the sprout swaying on the app's first screen (app/assets/signin, R445 B2), not the splash tree */}
        <video className="sprout" src="/deck/sprout.mp4" poster="/deck/sprout.webp" autoPlay muted loop playsInline preload="metadata" aria-label="A sprout swaying, from the app's first screen" />
        <img className="sprout poster" src="/deck/sprout.webp" alt="" />
      </Slide>

      {/* 04 How it works: any swap, any app (his note 2); the decision removed (the cut table, R-D7) */}
      <Slide n={4} chip="How it works">
        <div className="grow">
          <h2 className="h2s">Every swap rounds up. Your Seeker <span className="mk">keeps the change.</span></h2>
          <div className="beats center big">
            <div className="beat">
              <img className="stage" src="/deck/grow-1-fade.webp" alt="" />
              <strong>Any swap, any app</strong>
              <span>Each swap rounds up to the next dollar. You choose the extras and a daily limit.</span>
            </div>
            <div className="beat">
              <img className="stage" src="/deck/grow-2-fade.webp" alt="" />
              <strong>Planted each morning</strong>
              <span>At 7&nbsp;AM, Sprouts buys your coins with the change you saved, up to $5 a day, split by the AI Yield Manager.</span>
            </div>
            <div className="beat">
              <img className="stage" src="/deck/grow-3-fade.webp" alt="" />
              <strong>Kept on your Seeker</strong>
              <span>Sprouts stakes SKR, mines stORE and lends USDC and SOL, all from your Seed Vault.</span>
            </div>
          </div>
        </div>
      </Slide>

      {/* 04b MOCKUP (R-D74): the mandarin (SKR) growing instead of the orchid; delete one of 04 / 04b after his pick. */}
      {/* 04 How it works: any swap, any app (his note 2); the decision removed (the cut table, R-D7) */}
      <Slide n={4} label="04b" chip="How it works">
        <div className="grow">
          <h2 className="h2s">Every swap rounds up. Your Seeker <span className="mk">keeps the change.</span></h2>
          <div className="beats center big">
            <div className="beat">
              <img className="stage" src="/deck/grow-m1.webp" alt="" />
              <strong>Any swap, any app</strong>
              <span>Each swap rounds up to the next dollar. You choose the extras and a daily limit.</span>
            </div>
            <div className="beat">
              <img className="stage" src="/deck/grow-m2.webp" alt="" />
              <strong>Planted each morning</strong>
              <span>At 7&nbsp;AM, Sprouts buys your coins with the change you saved, up to $5 a day, split by the AI Yield Manager.</span>
            </div>
            <div className="beat">
              <img className="stage" src="/deck/grow-m3.webp" alt="" />
              <strong>Kept on your Seeker</strong>
              <span>Sprouts stakes SKR, mines stORE and lends USDC and SOL, all from your Seed Vault.</span>
            </div>
          </div>
        </div>
      </Slide>

      {/* 05 The Seed Vault (his note 1). Saga is also accepted (R86), so "built for", never "only works on". */}
      <Slide n={5} chip="Built for Seeker" art>
        <div className="grow">
          <h2 className="h2s narrow" style={{ maxWidth: "calc(var(--u)*46)" }}>Your savings live in <span className="mk">the Seed Vault.</span></h2>
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

      {/* 06 Garden (R-D5; R-D65 10-12): three lines, the four concept plants with their stakes, a hand holding a Seeker with our
          home screen + widget (his photo, mirrored and cut out, brand/deck-art/build_hand_phone.py), at most a third of the width */}
      <Slide n={6} chip="Why you come back" art>
        <h2 className="h2s one" style={{ margin: "calc(var(--u)*2.6) 0 calc(var(--u)*1.6)" }}>A garden that grows <span className="mk">every time you swap.</span></h2>
        <ol className="steps g6">
          <li>Each plant or mineral is unique to each token.</li>
          <li>Each coin grows with every planting. stORE is a geode you dig up.</li>
          <li>A home screen widget with your garden.</li>
        </ol>
        <div className="plants">
          <p className="pnote">Concept art: future coins</p>
          {([["pyth", "PYTH", "amethyst in stone"], ["jup", "JUP", "gourd vine on a bamboo hoop"], ["bonk", "BONK", "shiba topiary"], ["jto", "JTO", "lotus in a stone basin"]] as const).map(([f, coin, what]) => (
            <figure key={f}>
              <img src={`/deck/concept-${f}.webp`} alt={`Concept for ${coin}: ${what}`} />
              <span className="stake"><img src="/deck/stake.png" alt="" /><b>{coin}</b></span>
            </figure>
          ))}
        </div>
        <img className="hand" src="/deck/hand-seeker.webp" alt="A hand holding a Seeker: the home screen with the Sprouts garden widget" />
      </Slide>

      {/* 07 Yield Manager (his note 6; R-D27 smart + helpful, chip 'Yield Manager'): split-run.ts, lending-leash spec 3-4, R347 */}
      <Slide n={7} chip="AI Yield Manager">
        <div className="grow">
          <h2 className="h2s one" style={{ marginTop: "calc(var(--u)*1.6)" }}>Your round-ups, put to work <span className="mk">while you sleep.</span></h2>
          <div className="ym">
            <div className="ym-flow">
              <div className="ym-box"><b>Your change</b><small>from every swap</small></div>
              <i>&rarr;</i>
              <div className="ym-box key"><b>AI Yield Manager</b><small>Each morning, Claude Haiku 4.5 reads live rates and sends new change where it pays best. It skips rates propped up by short-term rewards and never sells what you hold.</small></div>
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
        <p className="note">Part of Pro, free during launch. The AI sets the split and skips risky lenders. Code moves the money.</p>
        <img className="sand" src="/deck/sand-fade.webp" alt="" />
      </Slide>

      {/* 08 Safety + how it's built (R300 as the sub, R-D6, R-D18 trust line); R-D26: inviting, not defensive */}
      <Slide n={8} chip="Your money stays yours">
        <div className="grow">
          <h2 className="h2s" style={{ maxWidth: "calc(var(--u)*62)" }}>Your money only moves <span className="mk">into your savings.</span></h2>
          <p className="sub" style={{ maxWidth: "calc(var(--u)*54)" }}>
            An on-chain leash lets Sprouts move at most $5 a day per wallet, and only into savings you hold. Not even our server or its AI can send it anywhere else.
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

      {/* 09 Market (R-D3: market data, not our DB) */}
      <Slide n={9} chip="Who it's for">
        <div className="grow">
          <h2 className="h2s">Every Seeker owner, from <span className="mk">their first swap.</span></h2>
          <div className="stats">
            <div className="stat"><strong>120k</strong><span>Seekers activated, each with the dApp Store built in.</span></div>
            <div className="stat"><strong>$380</strong><span>a year saved by the top quarter of active traders.</span></div>
            <div className="stat"><strong>$240</strong><span>a year saved by a new owner who swaps.</span></div>
            <div className="stat"><strong>$2.9M</strong><span>a year saved on Seeker if 1 in 10 owners joins.</span></div>
          </div>
          <p className="sub">For new owners, Sprouts is a first app worth opening every day.</p>
        </div>
        <img className="sand-lines" src="/deck/sand-lines.webp" alt="" />
        <p className="note">Sources: Dune, Genesis activations (Aug 2026); our on-chain samples of 163 recently active SKR stakers (75th percentile $32 a month) and 46 recently activated Seekers that swapped (median $20 a month), round-up to $1 plus 1% of swaps over $100 (Sept 2026). $2.9M = 12,000 owners at $20 a month.</p>
      </Slide>

      {/* 10 Business: Seeker and Solana Mobile only (R-D4); Pro = manager + auto-lending + tax pack (R446c); docs/reports/2026-10-09-business-model-analysis.md */}
      <Slide n={10} chip="Business model">
        <div className="grow">
          <h2 className="h2s">Sprouts grows with <span className="mk">Solana Mobile.</span></h2>
          <div className="rows">
            <div className="row"><strong>$200 to $380 a year</strong><span>saved by an active trader, from the median to the top quarter. It stays theirs.</span></div>
            <div className="row"><strong>0.5% planting fee</strong><span>We keep half a cent of every dollar planted in coins, paid in USDC.</span></div>
            <div className="row"><strong>Pro subscription</strong><span>AI Yield Manager, automatic lending and tax export. Free during launch. Acorns proved this model.</span></div>
            <div className="row"><strong>Built to hold</strong><span>SKR is the Seeker&apos;s own token, staked right on your phone, and stORE puts ORE to work as it sits. Sprouts has no token of its own. Every round-up buys into the ecosystem the Seeker runs on.</span></div>
          </div>
        </div>
      </Slide>

      {/* 11 Founder + links (R-D66: renamed from Team, his bio lightly edited); R-D19 live line; R-D28 his Validators pfp #14 */}
      <Slide n={11} chip="Founder" art>
        <div className="grow founder">
          <h2>Built by <span className="mk">donlucas.</span></h2>
          <p className="sub">
            On Solana since 2021. A working cinematographer and photographer, donlucas founded Validators on the Eclipse SVM and,
            with his team, built some of the chain&apos;s first NFT infrastructure, still live today. Their blip NFT messaging protocol
            won Eclipse&apos;s hackathon infrastructure track and grew through partnerships across the ecosystem.
          </p>
          <p className="sub">
            He also built xscapes, a thinking screen for terminal agents, and has a groundbreaking video game in development (or so
            he thinks).
          </p>
          <p className="sub">Built with Claude Code (the app, the API and the on-chain leash), Midjourney for the garden, and the occasional second opinion from Kimi.</p>
          <p className="sub"><b>Live on Solana mainnet.</b></p>
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
      </Slide>

      {/* 12 Thank you (R-D71/R-D74, his pick 12b1): the whole garden grown, on extended paper sky, full width and placed by its crown
          line so the trees rise toward the line without touching it; the line oversized with the painted marker; the lockup in the sky */}
      <Slide n={12} art>
        <p className="ebt"><span className="mk">Thank you.</span></p>
        <img className="eb" src="/deck/garden-end-sky.webp" alt="The whole Sprouts garden, fully grown" />
        <img className="eb-m" src="/deck/garden-end-mobile.webp" alt="" />
        <img className="ebl" src="/deck/lockup-ink.png" alt="Sprouts" />
      </Slide>

      <div className="bar">
        <a href="#s1">Top</a>
        <DeckKeys printButton />
      </div>
    </main>
  );
}
