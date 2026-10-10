import type { Metadata } from "next";
import { Outfit, Albert_Sans } from "next/font/google";
import { DeckKeys } from "./keys";

/**
 * The pitch deck: one 16:9 slide per screen, ten slides in the order of "Decks to win any hackathon" (hook, problem, solution,
 * demo, why Seeker, what sets it apart, safety, first users, money, team). Every size is in container units, so the same page
 * prints to a 1920x1080 PDF (one slide per page) and renders each slide as an image for Google Slides.
 * Copy follows the rulings: the problem line (10-04), R271 (why only on Seeker), R300 (the guarantee), R103 (no competitors).
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
.deck table { border-collapse:collapse; width:100%; font-size:calc(var(--u)*1.65); }
.deck th { text-align:left; font-size:calc(var(--u)*1.2); color:var(--muted); font-weight:600; letter-spacing:.06em; text-transform:uppercase; padding:0 0 calc(var(--u)*1); }
.deck td { padding:calc(var(--u)*1.05) 0; border-top:1px solid var(--rule); width:50%; }
.deck td + td { color:var(--leaf); font-weight:600; }
.deck .stats { display:grid; grid-template-columns:repeat(3, 1fr); gap:calc(var(--u)*2.5); }
.deck .stat strong { display:block; font-family:var(--font-display), sans-serif; font-size:calc(var(--u)*4.2); letter-spacing:-.03em; color:var(--leaf); line-height:1; }
.deck .stat span { display:block; font-size:calc(var(--u)*1.4); line-height:1.4; margin-top:calc(var(--u)*.8); }
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
  .deck .split, .deck .beats, .deck .stats { grid-template-columns:1fr; }
  .deck .beat strong { font-size:19px; } .deck .beat span, .deck .stat span { font-size:15px; }
  .deck .stat strong { font-size:34px; } .deck table { font-size:15px; } .deck th { font-size:11px; }
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
            <p className="sub">Every swap rounds up into savings that only your Seed Vault can unlock, and an AI yield manager grows them.</p>
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
        <p className="note">Seeker owners who stake SKR swap a median of 23 times a month (sample of 149 active wallets, Sept 2026).</p>
      </Slide>

      {/* 03 Solution + why onchain */}
      <Slide n={3} chip="The fix">
        <div className="grow">
          <h2>Every swap rounds up. Your Seeker keeps the change.</h2>
          <div className="beats">
            <div className="beat">
              <strong>Automatic</strong>
              <span>Any swap, in any app, from any wallet you link, rounds up. No decision to make.</span>
            </div>
            <div className="beat">
              <strong>Somewhere safer</strong>
              <span>Each morning the change is planted into SKR and stORE staked to your Seed Vault key.</span>
            </div>
            <div className="beat">
              <strong>It grows</strong>
              <span>An AI Yield Manager reads live rates and tilts the rest toward the lending that pays more.</span>
            </div>
          </div>
          <p className="sub">
            <b>Why onchain:</b> an on-chain leash lets our server move only your daily round-up, and only into your own savings.
          </p>
        </div>
      </Slide>

      {/* 04 Demo */}
      <Slide n={4} chip="Demo">
        <div className="split">
          <div className="grow">
            <h2>Watch it grow.</h2>
            <p className="sub">Each coin is a plant. Every planting grows it. The garden lives in the app and on your home screen.</p>
            <p className="note">
              Simulated two years of a typical saver. <span className="todo">Demo video link goes here.</span>
            </p>
          </div>
          <div>
            <video src="/deck/garden-years.mp4" poster="/deck/garden-years.webp" autoPlay muted loop playsInline preload="metadata" aria-label="A garden growing over two simulated years as round-ups are planted" />
            <img className="poster" src="/deck/garden-years.webp" alt="The garden after two simulated years: $391 saved" />
          </div>
        </div>
      </Slide>

      {/* 05 Why only on Seeker (R271) */}
      <Slide n={5} chip="Built for Seeker">
        <div className="grow">
          <h2>It only works on a Seeker.</h2>
          <div className="beats">
            <div className="beat">
              <strong>Seed Vault</strong>
              <span>Your savings are staked to the key in your phone&apos;s secure hardware. It signs no dApp approvals.</span>
            </div>
            <div className="beat">
              <strong>Genesis Token</strong>
              <span>Sign in with the token your Seeker came with. One phone, one garden.</span>
            </div>
            <div className="beat">
              <strong>Your .skr name</strong>
              <span>Your garden carries your name, on a widget on your home screen.</span>
            </div>
          </div>
        </div>
      </Slide>

      {/* 06 What sets it apart: next to how people save today (R103: no competitors named) */}
      <Slide n={6} chip="What sets it apart">
        <div className="grow">
          <h2>Saving, without deciding to save.</h2>
          <table>
            <thead>
              <tr><th>Today</th><th>With Sprouts</th></tr>
            </thead>
            <tbody>
              <tr><td>A decision, every time</td><td>Automatic, on every swap</td></tr>
              <tr><td>Sits in the hot wallet</td><td>Staked to your Seed Vault</td></tr>
              <tr><td>Idle</td><td>Earns in SKR staking and lending</td></tr>
              <tr><td>Nothing to look at</td><td>A garden that grows on your home screen</td></tr>
            </tbody>
          </table>
        </div>
      </Slide>

      {/* 07 Safety (R300) */}
      <Slide n={7} chip="Your money stays yours">
        <div className="grow">
          <h2>Even if our server is hacked, it can only move your daily round-up (max $5) into your own savings.</h2>
          <p className="sub">Never anywhere else. Withdraw any time. The leash program is live on mainnet and its build is verified against the public source.</p>
          <span className="addr">Leash program GyBmDLN72kg6xwAnZfj9c7fjeaJ3GvhkHNhFns83f8f7</span>
        </div>
      </Slide>

      {/* 08 First users */}
      <Slide n={8} chip="First users">
        <div className="grow">
          <h2>Seeker owners who trade.</h2>
          <div className="stats">
            <div className="stat"><strong>150,000+</strong><span>Seekers shipped to 50+ countries (Breakpoint 2025).</span></div>
            <div className="stat"><strong>9,000+</strong><span>daily active Seeker users (Solana Mobile, June 2026).</span></div>
            <div className="stat"><strong>91%</strong><span>of sampled SKR stakers swapped in the last 30 days.</span></div>
          </div>
          <p className="sub">We reach them where they already are: the Solana dApp Store and the Seeker community. <span className="todo">Beta / live user count goes here.</span></p>
        </div>
      </Slide>

      {/* 09 Money (R105, R347) */}
      <Slide n={9} chip="Business model">
        <div className="grow">
          <h2>0.5% of each planting.</h2>
          <p className="sub">
            Paid in USDC, inside the same swap. Later, the AI Yield Manager becomes a Pro subscription; it is free during launch.
          </p>
          <p className="sub"><b>Good for SKR:</b> everyday swaps become steady SKR demand, and stORE puts ORE to work.</p>
        </div>
      </Slide>

      {/* 10 Team + links */}
      <Slide n={10} chip="Team">
        <div className="grow">
          <h2>Built by Lucas Garzoli.</h2>
          <p className="sub"><span className="todo">One line on Lucas: what he has shipped and why he is the one to build this.</span></p>
          <p className="sub">Built with Claude Code: the app, the API and the on-chain leash, reviewed by independent AI audits before mainnet.</p>
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
