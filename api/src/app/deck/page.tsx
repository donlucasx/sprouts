import type { Metadata } from "next";
import { Outfit, Albert_Sans } from "next/font/google";
import { DeckKeys } from "./keys";

/**
 * The pitch deck: one 16:9 slide per screen, ten slides (R-D2, R-D7): hook, problem, how it works, Seed Vault, garden (demo +
 * why people come back, R-D5), AI Yield Manager, safety + how it's built (R-D6), market, business (Seeker and Solana Mobile only,
 * R-D4), team. Every size is in container units, so the same page prints to a 1920x1080 PDF (one slide per page).
 * Copy follows the rulings: the problem line (10-04), R300 (the guarantee), R103 (no competitors). Numbers: docs/reports/
 * 2026-10-09-business-model-analysis.md and research/new/14.
 */

const outfit = Outfit({ subsets: ["latin"], weight: ["500", "600", "700"], variable: "--font-display" });
const albert = Albert_Sans({ subsets: ["latin"], weight: ["400", "600"], variable: "--font-body" });

export const metadata: Metadata = {
  title: "Sprouts deck",
  description: "Your Seeker's spare change, planted.",
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
.deck h1 { font-size:calc(var(--u)*6.6); }
.deck h2 { font-size:calc(var(--u)*5.6); }
.deck .grow { flex:1; display:flex; flex-direction:column; justify-content:center; gap:calc(var(--u)*2.4); }
.deck .sub { font-size:calc(var(--u)*1.9); line-height:1.4; color:var(--muted); max-width:calc(var(--u)*60); margin:0; }
.deck .sub b { color:var(--ink); font-weight:600; }
.deck .num { position:absolute; right:calc(var(--u)*6.6); bottom:calc(var(--u)*3.4); font-size:calc(var(--u)*1.1); color:#A8A29A; }
.deck .note { font-size:calc(var(--u)*1.05); color:#A8A29A; margin:0; }
.deck .split { display:grid; grid-template-columns:1fr 1fr; align-items:center; gap:calc(var(--u)*3); flex:1; }
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
.deck .links { display:flex; flex-wrap:wrap; gap:calc(var(--u)*1) calc(var(--u)*3); font-size:calc(var(--u)*1.6); font-weight:600; color:var(--leaf); }
.deck .todo { background:#FFF1B8; color:#5C4A00; border-radius:4px; padding:0 .3em; }
.deck .bar { position:fixed; right:16px; bottom:16px; display:flex; gap:8px; z-index:2; }
.deck .bar a, .deck .bar button { font:600 13px var(--font-body), sans-serif; background:var(--ink); color:var(--paper); border:0; border-radius:999px; padding:9px 14px; cursor:pointer; text-decoration:none; }
@media screen and (max-width: 760px) {
  .deck { scroll-snap-type:none; padding:0; gap:0; }
  .deck .slide { --u: 2.1vw; width:100%; aspect-ratio:auto; border-radius:0; box-shadow:none; border-bottom:1px solid var(--rule); }
  .deck .in { position:relative; inset:auto; padding:48px 16px 56px; gap:28px; min-height:80vh; }
  .deck h1 { font-size:42px; } .deck h2 { font-size:36px; }
  .deck .sub { font-size:18px; } .deck .chip { font-size:13px; padding:5px 12px; }
  .deck .split, .deck .beats, .deck .stats, .deck .row { grid-template-columns:1fr; }
  .deck .flow { flex-direction:column; } .deck .flow i { transform:rotate(90deg); align-self:center; }
  .deck .h2s { font-size:30px; } .deck .steps li { font-size:16px; grid-template-columns:28px 1fr; } .deck .steps li::before { font-size:20px; }
  .deck .flow b { font-size:16px; } .deck .flow small { font-size:13px; } .deck .row strong { font-size:20px; } .deck .row span { font-size:15px; }
  .deck .beat strong { font-size:19px; } .deck .beat span, .deck .stat span { font-size:15px; }
  .deck .stat strong { font-size:34px; }
  .deck .num { right:16px; bottom:20px; font-size:12px; } .deck .note, .deck .addr { font-size:12px; }
  .deck .brand { font-size:22px; } .deck .brand img { width:30px; } .deck .foot, .deck .links { font-size:15px; }
}
@page { size:1920px 1080px; margin:0; }
@media print {
  html, body { background:#FFFCF6 !important; }
  .deck { background:none; padding:0; gap:0; display:block; }
  .deck .slide { width:1920px; height:1080px; aspect-ratio:auto; border-radius:0; box-shadow:none; break-after:page; --u: 19.2px; }
  .deck .bar { display:none; }
  .deck video { display:none; } .deck .poster { display:block; }
  .deck * { -webkit-print-color-adjust:exact; print-color-adjust:exact; }
}
`;

function Slide({ n, chip, children }: { n: number; chip?: string; children: React.ReactNode }) {
  return (
    <section className="slide" id={`s${n}`} aria-label={`Slide ${n}`}>
      <div className="in">
        {chip ? <span className="chip">{chip}</span> : null}
        {children}
      </div>
      <span className="num">{String(n).padStart(2, "0")}</span>
    </section>
  );
}

export default function Deck() {
  return (
    <main className={`deck ${outfit.variable} ${albert.variable}`}>
      <style>{CSS}</style>
      <DeckKeys />

      {/* 01 Hook */}
      <Slide n={1}>
        <div className="split">
          <div className="grow">
            <div className="brand">
              <img src="/deck/mark.svg" alt="" />
              Sprouts
            </div>
            <h1>Your Seeker&apos;s spare change, planted.</h1>
            <p className="sub">Every swap you make, in any app, rounds up. The change is staked to your Seed Vault and grown by an AI yield manager.</p>
          </div>
          <img className="art" src="/deck/garden.webp" alt="A watercolour garden: two bonsai trees, an azalea, a maple, an orchid and a pothos" />
        </div>
        <span className="foot">CLOCK IN · Solana Mobile Hackathon 2026</span>
      </Slide>

      {/* 02 Problem: the 10-04 ruling, verbatim */}
      <Slide n={2} chip="The problem">
        <div className="grow">
          <h2>Traders rarely set money aside.</h2>
          <p className="sub">
            Everything sits in the hot wallet they swap from every day. Moving some of it somewhere safer takes a decision nobody
            stops to make in the middle of trading, so it doesn&apos;t happen.
          </p>
        </div>
        <p className="note">Seeker owners who stake SKR swap a median of 23 times a month, most of it under $10 (sample of 163 stakers, Sept 2026).</p>
      </Slide>

      {/* 03 How it works: any swap, any app (his note 2); the decision removed (the cut table, R-D7) */}
      <Slide n={3} chip="How it works">
        <div className="grow">
          <h2>Every swap rounds up. Your Seeker keeps the change.</h2>
          <div className="beats">
            <div className="beat">
              <strong>Any swap, any app</strong>
              <span>Link your wallets to Sprouts once. Every swap they sign, on any platform, rounds up to the next dollar.</span>
            </div>
            <div className="beat">
              <strong>Planted each morning</strong>
              <span>Past $2, the change is planted at 7 AM into SKR, stORE and lending. Up to $5 a day.</span>
            </div>
            <div className="beat">
              <strong>Kept on your Seeker</strong>
              <span>Staked to your Seed Vault, where it earns. No decision to make, nothing left in the hot wallet.</span>
            </div>
          </div>
        </div>
      </Slide>

      {/* 04 The Seed Vault (his note 1). Saga is also accepted (R86), so "built for", never "only works on". */}
      <Slide n={4} chip="Built for Seeker">
        <div className="grow">
          <h2>Your savings live in the Seed Vault.</h2>
          <div className="beats">
            <div className="beat">
              <strong>Not in a hot wallet</strong>
              <span>Savings belong to the key in your Seeker&apos;s secure hardware. A drained trading wallet never reaches them.</span>
            </div>
            <div className="beat">
              <strong>Only you take it out</strong>
              <span>Sprouts adds to your savings every morning. Only your fingerprint on the Seed Vault can withdraw.</span>
            </div>
            <div className="beat">
              <strong>One phone, one garden</strong>
              <span>Sign in with your Genesis Token. Your garden carries your .skr name.</span>
            </div>
          </div>
        </div>
      </Slide>

      {/* 05 Garden: demo + why people come back (R-D5) */}
      <Slide n={5} chip="Why you come back">
        <div className="split">
          <div className="grow">
            <h2 className="h2s">A garden that grows every time you swap.</h2>
            <ol className="steps">
              <li>Each coin is a plant. Every planting grows it.</li>
              <li>A notification each morning when your change is planted.</li>
              <li>The garden lives on your home screen as a widget.</li>
            </ol>
            <p className="note">
              Simulated two years of a typical saver. <span className="todo">Demo video link goes here.</span>
            </p>
          </div>
          <div>
            <video src="/deck/garden-years.mp4" poster="/deck/garden-years.webp" autoPlay muted loop playsInline preload="metadata" aria-label="A garden growing over two simulated years as round-ups are planted" />
            <img className="poster" src="/deck/garden-years.webp" alt="The garden after two simulated years" />
          </div>
        </div>
      </Slide>

      {/* 06 AI Yield Manager (his note 6): split-run.ts, lending-leash spec 3-4, R347 */}
      <Slide n={6} chip="AI Yield Manager">
        <div className="grow">
          <h2 className="h2s">An AI yield manager, inside hard limits.</h2>
          <ol className="steps">
            <li>Each morning it reads live lending rates from Kamino, Jupiter Lend, marginfi and Lulo.</li>
            <li>It tilts your new change toward what pays more, at most 10 points per coin a day. SKR always keeps its share.</li>
            <li>Code, not the model, picks the lender and moves the money. The AI never signs and never sells what you hold.</li>
          </ol>
          <p className="sub">Optional. Careful, Balanced or Bold. Pro, free during launch.</p>
        </div>
      </Slide>

      {/* 07 Safety + how it's built (R300, R-D6) */}
      <Slide n={7} chip="Your money stays yours">
        <div className="grow">
          <h2 className="h2s">Even if our server is hacked, it can only move your daily round-up (max $5) into your own savings.</h2>
          <div className="flow">
            <div><b>Your swap</b><small>any app, any linked wallet</small></div>
            <i>→</i>
            <div><b>Sprouts API</b><small>Helius webhooks · Next.js · Supabase</small></div>
            <i>→</i>
            <div className="key"><b>Leash program</b><small>on chain: $5 a day, only into your savings</small></div>
            <i>→</i>
            <div><b>Jupiter</b><small>buys SKR, stORE</small></div>
            <i>→</i>
            <div><b>Your Seed Vault</b><small>staked SKR · Kamino · Jupiter Lend</small></div>
          </div>
          <p className="note">
            App: Expo, React Native, Mobile Wallet Adapter, Android widget. Leash: build verified against the public source,
            GyBmDLN72kg6xwAnZfj9c7fjeaJ3GvhkHNhFns83f8f7. Pause, revoke or withdraw from your phone.
          </p>
        </div>
      </Slide>

      {/* 08 Market (R-D3: market data, not our DB) */}
      <Slide n={8} chip="Who it's for">
        <div className="grow">
          <h2 className="h2s">Seeker owners trade often, in small amounts.</h2>
          <div className="stats">
            <div className="stat"><strong>120k</strong><span>Seekers activated with a Genesis Token (Aug 2026).</span></div>
            <div className="stat"><strong>91%</strong><span>of SKR stakers swapped in the last 30 days, a median of 23 times.</span></div>
            <div className="stat"><strong>$200</strong><span>a year rounded up by the median staker who trades.</span></div>
            <div className="stat"><strong>86%</strong><span>of circulating SKR is staked. Seeker owners already hold.</span></div>
          </div>
          <p className="note">Sources: Dune (Genesis activations); our on-chain sample of 163 recent SKR stakers, Sept 2026; Solana Mobile SKR page.</p>
        </div>
      </Slide>

      {/* 09 Business: Seeker and Solana Mobile only (R-D4); docs/reports/2026-10-09-business-model-analysis.md */}
      <Slide n={9} chip="Business model">
        <div className="grow">
          <h2 className="h2s">Grows with Solana Mobile.</h2>
          <div className="rows">
            <div className="row"><strong>0.5% of each planting</strong><span>Paid in USDC, inside the same swap. Lending is free.</span></div>
            <div className="row"><strong>Pro subscription</strong><span>The AI Yield Manager. Round-ups plus a subscription is the model Acorns proved with 6M paying customers.</span></div>
            <div className="row"><strong>Good for SKR</strong><span>No new token. Every saver buys and stakes SKR every week, and opens their Seeker every day to see it grow.</span></div>
          </div>
        </div>
      </Slide>

      {/* 10 Team + links */}
      <Slide n={10} chip="Team">
        <div className="grow">
          <h2>Built by donlucas.</h2>
          <p className="sub">
            On Solana since 2021. Founder of Validators, a 3,333-piece NFT community on the SVM since 2024, now on Solana. Built its bridge, holder bot and
            meme studio himself. 15 years in commercial photo and film.
          </p>
          <p className="sub">Built with Claude Code: the app, the API and the on-chain leash.</p>
          <div className="links">
            <span>sprouts.money</span>
            <span>@sproutsonseeker</span>
            <span>github.com/donlucasx/sprouts</span>
          </div>
        </div>
      </Slide>

      <div className="bar">
        <a href="#s1">Top</a>
        <DeckKeys printButton />
      </div>
    </main>
  );
}
