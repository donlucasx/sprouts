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
.deck .links { display:flex; flex-wrap:wrap; gap:calc(var(--u)*1) calc(var(--u)*3); font-size:calc(var(--u)*1.6); font-weight:600; color:var(--leaf); }
.deck .hero { max-width:calc(var(--u)*50); }
.deck .phone { position:absolute; left:calc(var(--u)*61); top:calc(var(--u)*6); width:calc(var(--u)*29); height:calc(var(--u)*50.25); overflow:hidden; box-sizing:border-box; border-bottom-left-radius:0; border-bottom-right-radius:0; padding:calc(var(--u)*.9) calc(var(--u)*.9) 0;
  background:#1D2628; border-radius:calc(var(--u)*4.4) calc(var(--u)*4.4) 0 0; box-shadow:0 calc(var(--u)*1.5) calc(var(--u)*5) rgba(43,38,34,.22); }
.deck .phone img { display:block; width:100%; height:auto; border-radius:calc(var(--u)*3.6); }
.deck .sprout { position:absolute; right:calc(var(--u)*9); bottom:calc(var(--u)*6); height:calc(var(--u)*19); width:auto; }
.deck .beat .stage { height:calc(var(--u)*11); width:auto; justify-self:start; margin-bottom:calc(var(--u)*.4); }
.deck .narrow { max-width:calc(var(--u)*62); }
.deck .stack { display:grid; gap:calc(var(--u)*1.8); max-width:calc(var(--u)*44); }
.deck .stack div { display:grid; gap:calc(var(--u)*.4); }
.deck .stack strong { font-family:var(--font-display), sans-serif; font-size:calc(var(--u)*1.9); letter-spacing:-.02em; color:var(--leaf); }
.deck .stack span { font-size:calc(var(--u)*1.5); line-height:1.4; }
.deck .photo { position:absolute; top:0; right:0; bottom:0; width:44%; height:100%; object-fit:cover; }
.deck .on-art .num { display:none; }
.deck .photo-credit { position:absolute; right:calc(var(--u)*1.2); bottom:calc(var(--u)*1); font-size:calc(var(--u)*.8); color:rgba(255,255,255,.55); }
.deck .split.wide { grid-template-columns:.62fr 1.38fr; gap:calc(var(--u)*2); }
.deck .split.wide video, .deck .split.wide .poster { border-radius:0; }
.deck .sand { position:absolute; right:0; bottom:0; width:72%; height:auto; pointer-events:none;
  -webkit-mask-image:linear-gradient(to right, transparent, #000 35%); mask-image:linear-gradient(to right, transparent, #000 35%); }
.deck .in > .grow { position:relative; z-index:1; }
.deck .tree { position:absolute; right:calc(var(--u)*-11); bottom:calc(var(--u)*-9); width:calc(var(--u)*35); height:auto; pointer-events:none; }
.deck .flow.short { max-width:calc(var(--u)*68); }
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
  .deck .phone { position:relative; left:auto; top:auto; width:100%; height:70vh; overflow:hidden; }
  .deck .sprout, .deck .tree { display:none; } .deck .flow.short { max-width:none; } .deck .photo { position:relative; width:100%; height:auto; }
  .deck .sand { width:100%; } .deck .stack, .deck .narrow, .deck .hero { max-width:none; }
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

function Slide({ n, chip, art, children }: { n: number; chip?: string; art?: boolean; children: React.ReactNode }) {
  return (
    <section className={art ? "slide on-art" : "slide"} id={`s${n}`} aria-label={`Slide ${n}`}>
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
      <Slide n={1} art>
        <div className="grow hero">
            <div className="brand">
              <img src="/deck/mark.svg" alt="" />
              Sprouts
            </div>
            <h1>Your spare change, planted on your Seeker.</h1>
            <p className="sub">Sprouts rounds up every swap your linked wallets make, in any app. The change is planted in SKR, kept by your Seed Vault, and grown by an AI&nbsp;Yield&nbsp;Manager.</p>
        </div>
        <div className="phone"><img src="/deck/home.webp" alt="Sprouts on a phone: the garden, and under it the coins it holds" /></div>
        <span className="foot">CLOCK IN · Solana Mobile Hackathon 2026</span>
      </Slide>

      {/* 02 The opportunity (R-D24): the 10-04 problem line, verbatim, turned toward what the swaps make possible */}
      <Slide n={2} chip="The opportunity">
        <div className="grow">
          <h2 style={{ maxWidth: "calc(var(--u)*62)" }}>Traders rarely set money aside. Their swaps can do it for them.</h2>
          <p className="sub" style={{ maxWidth: "calc(var(--u)*48)" }}>Every swap already moves money. Each one can set a little change aside.</p>
        </div>
        <p className="note">Seeker owners who stake SKR swap a median of 23 times a month, mostly under $10 (on-chain sample of 163 recently active stakers, Sept 2026).</p>
        <img className="sprout" src="/deck/sprout.png" alt="A first sprout, from the app's loading screen" />
      </Slide>

      {/* 03 How it works: any swap, any app (his note 2); the decision removed (the cut table, R-D7) */}
      <Slide n={3} chip="How it works">
        <div className="grow">
          <h2 className="h2s">Every swap rounds up. Your Seeker keeps the change.</h2>
          <div className="beats">
            <div className="beat">
              <img className="stage" src="/deck/grow-1.png" alt="" />
              <strong>Any swap, any app</strong>
              <span>Swaps from your linked wallets round up to the next dollar. You set the extras and the daily limit.</span>
            </div>
            <div className="beat">
              <img className="stage" src="/deck/grow-2.png" alt="" />
              <strong>Planted each morning</strong>
              <span>Past $2, your change is planted at 7&nbsp;AM. Up to $5 a day, no decisions.</span>
            </div>
            <div className="beat">
              <img className="stage" src="/deck/grow-3.png" alt="" />
              <strong>Kept on your Seeker</strong>
              <span>SKR and stORE to grow, USDC and SOL lending to steady it, all in your Seed Vault.</span>
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
        <div className="split wide">
          <div className="grow">
            <h2 className="h2s">A garden that grows every time you swap.</h2>
            <ol className="steps">
              <li>Each coin is a plant that grows with every planting.</li>
              <li>A notification when your change is planted.</li>
              <li>Your garden on your home screen.</li>
            </ol>
            <p className="note">
              Two simulated years of an active saver: $32 a month, the top quarter of Seeker traders. <span className="todo">Demo video link goes here.</span>
            </p>
          </div>
          <div>
            <video src="/deck/garden-years.mp4" poster="/deck/garden-years.webp" autoPlay muted loop playsInline preload="metadata" aria-label="A garden growing over two simulated years as an active saver&apos;s round-ups are planted" />
            <img className="poster" src="/deck/garden-years.webp" alt="The garden after two simulated years" />
          </div>
        </div>
      </Slide>

      {/* 06 Yield Manager (his note 6; R-D27 smart + helpful, chip 'Yield Manager'): split-run.ts, lending-leash spec 3-4, R347 */}
      <Slide n={6} chip="Yield Manager">
        <div className="grow">
          <h2 className="h2s" style={{ maxWidth: "calc(var(--u)*64)" }}>Your round-ups, put to work while you sleep.</h2>
          <ol className="steps" style={{ maxWidth: "calc(var(--u)*66)" }}>
            <li>Round-ups go straight into SKR staking, ORE mining and lending. No extra step.</li>
            <li>Each morning it checks live rates on Kamino and Jupiter Lend and leans your new change toward the best one.</li>
            <li>It skips rates propped up by short-term rewards, and never sells what you hold.</li>
          </ol>
          <p className="sub">Careful, Balanced or Bold. Pro, free during launch.</p>
        </div>
        <p className="note">At most 10 points per coin a day, and SKR keeps its share. Code, not the model, picks the lender and moves the money.</p>
        <img className="sand" src="/deck/sand.webp" alt="" />
      </Slide>

      {/* 07 Safety + how it's built (R300 as the sub, R-D6, R-D18 trust line); R-D26: inviting, not defensive */}
      <Slide n={7} chip="Your money stays yours">
        <div className="grow">
          <h2 className="h2s" style={{ maxWidth: "calc(var(--u)*62)" }}>Your money moves one way: into your savings.</h2>
          <p className="sub" style={{ maxWidth: "calc(var(--u)*54)" }}>
            An on-chain leash allows at most $5 a day per linked wallet, only into savings you hold. Not even our server can send it
            anywhere else.
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
            source (GyBmDLN72kg6xwAnZfj9c7fjeaJ3GvhkHNhFns83f8f7). Admin key on the owner&apos;s laptop, not the server.
          </p>
        </div>
        <img className="tree" src="/deck/tree.png" alt="" />
      </Slide>

      {/* 08 Market (R-D3: market data, not our DB) */}
      <Slide n={8} chip="Who it's for">
        <div className="grow">
          <h2 className="h2s">Every Seeker owner, from their first swap.</h2>
          <div className="stats">
            <div className="stat"><strong>120k</strong><span>Seekers activated, each with the dApp Store built in (Aug 2026).</span></div>
            <div className="stat"><strong>23</strong><span>swaps a month by the median active SKR staker.</span></div>
            <div className="stat"><strong>$200</strong><span>a year rounded up by that staker.</span></div>
            <div className="stat"><strong>$20</strong><span>a month rounded up by new owners who swap.</span></div>
          </div>
          <p className="sub">For new owners, Sprouts is a first app worth opening every day.</p>
        </div>
        <p className="note">Sources: Dune, Genesis activations (Aug 2026); our on-chain samples of 163 recently active SKR stakers and 46 recently activated Seekers that swapped, round-up to $1 plus 1% of swaps over $100 (Sept 2026).</p>
      </Slide>

      {/* 09 Business: Seeker and Solana Mobile only (R-D4); Pro = manager + auto-lending + tax pack (R446c); docs/reports/2026-10-09-business-model-analysis.md */}
      <Slide n={9} chip="Business model">
        <div className="grow">
          <h2 className="h2s">Grows with Solana Mobile.</h2>
          <div className="rows">
            <div className="row"><strong>About $200 a saver</strong><span>a year, rounded up by the median active staker and kept on a Seeker.</span></div>
            <div className="row"><strong>0.5% of each coin planting</strong><span>Paid in USDC, inside the same swap.</span></div>
            <div className="row"><strong>Pro subscription</strong><span>Yield Manager, automatic lending, tax export. Free during launch. Round-ups plus a subscription: the model Acorns proved.</span></div>
            <div className="row"><strong>Good for SKR</strong><span>No new token. Every saver buys SKR.</span></div>
          </div>
        </div>
      </Slide>

      {/* 10 Team + links; R-D19 live line */}
      <Slide n={10} chip="Team">
        <div className="grow">
          <h2>Built by donlucas.</h2>
          <p className="sub">
            On Solana since 2021. Founded Validators on Eclipse and, with his team, built some of the chain&apos;s first NFT
            infrastructure, still live today; their blip won Eclipse&apos;s hackathon infrastructure track. Also ships xscapes, an
            open-source tool for AI agents.
          </p>
          <p className="sub">Built with Claude Code: the app, the API and the on-chain leash.</p>
          <p className="sub"><b>Live on Solana mainnet. In review on the Solana dApp Store.</b></p>
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
