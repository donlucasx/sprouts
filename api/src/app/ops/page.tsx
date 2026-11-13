import type { Metadata } from "next";
import { cookies } from "next/headers";
import { OPS_COOKIE, verifyOpsCookie } from "@/lib/ops/auth";
import { gatherOps, type OpsSnapshot } from "@/lib/ops/gather";
import type { LightState } from "@/lib/ops/lights";
import { LoginForm } from "./login-form";
import { LogoutButton } from "./logout-button";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Sprouts ops", robots: { index: false, follow: false } };

const paper = "#FFFBF5", ink = "#2B2622", muted = "#8A847B";
const CSS = `
.ops { background: ${paper}; color: ${ink}; min-height: 100svh; font-family: Arial, Helvetica, sans-serif; padding: 20px 16px 40px; max-width: 720px; margin: 0 auto; font-size: 15px; line-height: 1.4; }
.ops h1 { font-size: 22px; font-weight: 600; } .ops h2 { font-size: 13px; letter-spacing: .06em; text-transform: uppercase; color: ${muted}; margin: 28px 0 8px; font-weight: 600; }
.ops .sub { color: ${muted}; font-size: 13px; margin-top: 2px; }
.ops ul { list-style: none; } .ops .row { display: grid; grid-template-columns: 14px 1fr; gap: 10px; padding: 10px 0; border-bottom: 1px solid ${muted}33; }
.ops .dot { width: 12px; height: 12px; border-radius: 50%; margin-top: 4px; display: inline-block; }
.ops .st { font-weight: 600; } .ops .fact { color: ${muted}; display: block; }
.ops table { width: 100%; border-collapse: collapse; font-size: 13px; } .ops th, .ops td { text-align: left; padding: 5px 6px 5px 0; border-bottom: 1px solid ${muted}22; } .ops td.n, .ops th.n { text-align: right; padding-right: 0; padding-left: 6px; font-variant-numeric: tabular-nums; }
.ops .scroll { overflow-x: auto; } .ops p, .ops li.bs { margin: 4px 0; }
.ops .bs { color: ${muted}; font-size: 13px; padding-left: 12px; text-indent: -12px; } .ops .bs::before { content: "- "; }
.ops .bar { display: flex; gap: 16px; align-items: center; margin-top: 24px; font-size: 13px; }
.ops a, .ops .ops-link { color: ${muted}; text-decoration: underline; background: none; border: 0; font: inherit; cursor: pointer; padding: 0; }
.ops-form { display: grid; gap: 10px; margin-top: 24px; max-width: 320px; } .ops-form label { font-size: 13px; color: ${muted}; }
.ops-form input { font: inherit; font-size: 16px; padding: 10px 12px; border: 1px solid ${muted}88; border-radius: 8px; background: #fff; color: ${ink}; }
.ops-form button { font: inherit; padding: 10px 12px; border-radius: 999px; border: 1px solid ${ink}; background: ${ink}; color: ${paper}; cursor: pointer; } .ops-form button:disabled { opacity: .5; }
.ops .ops-err { color: #C8423B; font-size: 13px; }
`;

const STATE: Record<LightState, { text: string; color: string; ring?: boolean }> = {
  green: { text: "Green", color: "#2E8B57" },
  amber: { text: "Amber", color: "#D9A400" },
  red: { text: "Red", color: "#C8423B" },
  unknown: { text: "Unknown", color: "#9AA0A6" },
  info: { text: "Info", color: muted, ring: true },
};

const utc = (iso: string) => `${iso.slice(0, 16).replace("T", " ")} UTC`;
const usd = (cents: number | null) => (cents == null ? "n/a" : `$${(cents / 100).toFixed(2)}`);

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="ops">
      <style>{CSS}</style>
      {children}
    </main>
  );
}

function Dashboard({ snap }: { snap: OpsSnapshot }) {
  const n = snap.numbers;
  const stale = n && snap.numbersAt && snap.numbersAt < snap.at;
  return (
    <Shell>
      <h1>Sprouts ops</h1>
      <p className="sub">as of {utc(snap.at)}</p>
      <h2>Lights</h2>
      <ul>
        {snap.lights.map((l) => {
          const s = STATE[l.state];
          return (
            <li key={l.key} className="row">
              <span className="dot" aria-hidden="true" style={s.ring ? { border: `2px solid ${s.color}` } : { background: s.color }} />
              <span><span className="st">{l.label}: {s.text}</span><span className="fact">{l.fact}</span></span>
            </li>
          );
        })}
      </ul>
      <h2>Numbers</h2>
      {!n ? <p>Numbers unavailable</p> : (
        <>
          {stale ? <p className="sub">numbers as of {utc(snap.numbersAt!)}</p> : null}
          <div className="scroll">
            <table>
              <thead><tr><th>Funnel</th><th className="n">1 d</th><th className="n">7 d</th><th className="n">All</th></tr></thead>
              <tbody>
                {([["Signed in", "signIns"], ["Tried to link", "triedLink"], ["Linked ever", "linkedEver"], ["Linked now", "linkedNow"], ["Active 7 d", "active7d"]] as const).map(([label, k]) => (
                  <tr key={k}><td>{label}</td><td className="n">{n.funnel.d1[k]}</td><td className="n">{n.funnel.d7[k]}</td><td className="n">{n.funnel.all[k]}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
          <h2>Link failures, 7 d</h2>
          {Object.keys(n.linkFailures7d).length === 0 ? <p>None</p> : (
            <table><tbody>{Object.entries(n.linkFailures7d).map(([k, v]) => <tr key={k}><td>{k}</td><td className="n">{v}</td></tr>)}</tbody></table>
          )}
          <h2>Activity, 7 d</h2>
          <table>
            <tbody>
              <tr><td>Swaps</td><td className="n">{n.activity7d.swaps}</td></tr>
              <tr><td>Swapped</td><td className="n">{usd(n.activity7d.usdSwappedCents)}</td></tr>
              <tr><td>Round-ups</td><td className="n">{usd(n.activity7d.roundupCents)}</td></tr>
              <tr><td>Fees</td><td className="n">{usd(n.activity7d.feeCents)}</td></tr>
            </tbody>
          </table>
          <h2>By coin, 7 d</h2>
          {Object.keys(n.activity7d.byCoin).length === 0 ? <p>None</p> : (
            <table>
              <thead><tr><th>Coin</th><th className="n">Plantings</th><th className="n">Amount</th></tr></thead>
              <tbody>{Object.entries(n.activity7d.byCoin).map(([c, v]) => <tr key={c}><td>{c}</td><td className="n">{v.plantings}</td><td className="n">{usd(v.usdCents)}</td></tr>)}</tbody>
            </table>
          )}
          <h2>Recent swaps</h2>
          <div className="scroll">
            <table>
              <thead><tr><th>When</th><th>Wallet</th><th className="n">Amount</th><th>Status</th></tr></thead>
              <tbody>{n.recentSwaps.length === 0 ? <tr><td colSpan={4}>None</td></tr> : n.recentSwaps.map((r, i) => <tr key={i}><td>{utc(r.at)}</td><td>{r.wallet}</td><td className="n">{usd(r.usdCents)}</td><td>{r.status}</td></tr>)}</tbody>
            </table>
          </div>
          <h2>Recent plantings</h2>
          <div className="scroll">
            <table>
              <thead><tr><th>When</th><th>Wallet</th><th>Coin</th><th className="n">Amount</th><th>Status</th></tr></thead>
              <tbody>{n.recentPlantings.length === 0 ? <tr><td colSpan={5}>None</td></tr> : n.recentPlantings.map((r, i) => <tr key={i}><td>{utc(r.at)}</td><td>{r.wallet}</td><td>{r.coin}</td><td className="n">{usd(r.usdCents)}</td><td>{r.status}</td></tr>)}</tbody>
            </table>
          </div>
        </>
      )}
      <h2>Known blind spots</h2>
      <ul>{snap.blindSpots.map((b) => <li key={b} className="bs">{b}</li>)}</ul>
      <div className="bar"><a href="/ops">Refresh</a><LogoutButton /></div>
    </Shell>
  );
}

export default async function OpsPage() {
  const jar = await cookies();
  // No valid cookie: only the login form is rendered and nothing is gathered.
  if (!verifyOpsCookie(jar.get(OPS_COOKIE)?.value, Date.now())) {
    return (
      <Shell>
        <h1>Sprouts ops</h1>
        <LoginForm />
      </Shell>
    );
  }
  return <Dashboard snap={await gatherOps()} />;
}
