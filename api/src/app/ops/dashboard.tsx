import type { ReactNode } from "react";
import type { OpsSnapshot } from "@/lib/ops/gather";
import type { Light, LightState } from "@/lib/ops/lights";
import { verdict, STATE_WORD, relativeAgo, hhmmUtc, linkFailureName, savedIntoCoinsCents } from "@/lib/ops/view";
import { LogoutButton } from "./logout-button";

const paper = "#FFFBF5", ink = "#2B2622", muted = "#8A847B";
export const OPS_CSS = `
.ops { background: ${paper}; color: ${ink}; min-height: 100svh; font-family: Arial, Helvetica, sans-serif; padding: 20px 16px 40px; max-width: 720px; margin: 0 auto; font-size: 15px; line-height: 1.4; }
.ops h1 { font-size: 22px; font-weight: 600; } .ops h2 { font-size: 13px; letter-spacing: .06em; text-transform: uppercase; color: ${muted}; margin: 28px 0 8px; font-weight: 600; }
.ops .sub { color: ${muted}; font-size: 13px; margin-top: 2px; }
.ops ul { list-style: none; padding: 0; margin: 0; } .ops dl, .ops dd, .ops h1, .ops h3 { margin: 0; } .ops h1 { margin-bottom: 2px; } .ops .row { display: grid; grid-template-columns: 14px 1fr; gap: 10px; padding: 10px 0; border-bottom: 1px solid ${muted}33; }
.ops .dot { width: 12px; height: 12px; border-radius: 50%; margin-top: 4px; display: inline-block; }
.ops .st { font-weight: 600; } .ops .fact { color: ${muted}; display: block; }
.ops table { width: 100%; border-collapse: collapse; font-size: 13px; } .ops th, .ops td { text-align: left; padding: 5px 6px 5px 0; border-bottom: 1px solid ${muted}22; } .ops td.n, .ops th.n { text-align: right; padding-right: 0; padding-left: 6px; font-variant-numeric: tabular-nums; }
.ops td.n + td, .ops th.n + th { padding-left: 14px; } .ops .scroll { overflow-x: auto; } .ops p, .ops li.bs { margin: 4px 0; }
.ops .bs { color: ${muted}; font-size: 13px; padding-left: 12px; text-indent: -12px; } .ops .bs::before { content: "- "; }
.ops .bar { display: flex; gap: 16px; align-items: center; margin-top: 24px; font-size: 13px; }
.ops a, .ops .ops-link { color: ${muted}; text-decoration: underline; background: none; border: 0; font: inherit; cursor: pointer; padding: 0; }
.ops .box { border: 1px solid ${muted}66; border-radius: 10px; padding: 2px 14px 4px; margin-top: 16px; background: #fff; } .ops .box .row:last-child { border-bottom: 0; }
.ops .good { margin-top: 16px; font-size: 17px; font-weight: 600; } .ops .do { display: block; margin-top: 2px; }
.ops .fine { margin-top: 14px; } .ops .sub2 { color: ${muted}; font-size: 13px; margin-top: 6px; }
.ops .big { display: grid; grid-template-columns: 1fr auto; gap: 6px 12px; } .ops .big dd { text-align: right; font-weight: 600; font-variant-numeric: tabular-nums; }
.ops details { border-top: 1px solid ${muted}33; margin-top: 12px; padding-top: 10px; } .ops summary { cursor: pointer; font-weight: 600; padding: 4px 0; }
.ops details h3 { font-size: 12px; letter-spacing: .06em; text-transform: uppercase; color: ${muted}; margin: 18px 0 6px; font-weight: 600; }
.ops-form { display: grid; gap: 10px; margin-top: 24px; max-width: 320px; } .ops-form label { font-size: 13px; color: ${muted}; }
.ops-form input { font: inherit; font-size: 16px; padding: 10px 12px; border: 1px solid ${muted}88; border-radius: 8px; background: #fff; color: ${ink}; }
.ops-form button { font: inherit; padding: 10px 12px; border-radius: 999px; border: 1px solid ${ink}; background: ${ink}; color: ${paper}; cursor: pointer; } .ops-form button:disabled { opacity: .5; }
.ops .ops-err { color: #C8423B; font-size: 13px; }
`;

const COLOR: Record<LightState, string> = { green: "#2E8B57", amber: "#D9A400", red: "#C8423B", unknown: "#9AA0A6", info: muted };

const utc = (iso: string) => `${iso.slice(0, 16).replace("T", " ")} UTC`;
const usd = (cents: number | null) => (cents == null ? "n/a" : `$${(cents / 100).toFixed(2)}`);
const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

export function Shell({ children }: { children: ReactNode }) {
  return (
    <main className="ops">
      <style>{OPS_CSS}</style>
      {children}
    </main>
  );
}

function Dot({ state }: { state: LightState }) {
  return <span className="dot" aria-hidden="true" style={state === "info" ? { border: `2px solid ${COLOR.info}` } : { background: COLOR[state] }} />;
}

/** One light: dot, state written as a word, label, fact, and (only when asked) the "Do:" line. */
function LightRow({ l, withAction }: { l: Light; withAction: boolean }) {
  return (
    <li className="row">
      <Dot state={l.state} />
      <span>
        <span className="st">{STATE_WORD[l.state]}: {l.label}</span>
        <span className="fact">{l.fact}</span>
        {withAction && l.action ? <span className="do">Do: {l.action}</span> : null}
      </span>
    </li>
  );
}

export function Dashboard({ snap, nowMs }: { snap: OpsSnapshot; nowMs: number }) {
  const n = snap.numbers;
  const stale = n && snap.numbersAt && snap.numbersAt < snap.at;
  const v = verdict(snap.lights);
  const support = snap.lights.find((l) => l.key === "support" && l.state === "info");
  return (
    <Shell>
      <h1>Sprouts ops</h1>
      <p className="sub">Updated {relativeAgo(snap.at, nowMs)} ({hhmmUtc(snap.at)}) &middot; <a href="/ops">Refresh</a></p>

      {v.attention.length === 0 ? <p className="good">{v.headline}</p> : (
        <div className="box">
          <h2 style={{ marginTop: 12 }}>{v.headline}</h2>
          <ul>{v.attention.map((l) => <LightRow key={l.key} l={l} withAction />)}</ul>
        </div>
      )}
      {v.fine.length ? <p className="fine">{v.attention.length ? "Everything else is fine" : "Fine"}: {v.fine.map((l) => lower(l.label)).join(", ")}.</p> : null}
      {snap.liveOff ? <p className="sub2">The live savings switch is off.</p> : null}
      {support ? <p className="sub2">{support.fact}.</p> : null}

      <h2>How Sprouts is doing (last 7 days)</h2>
      {!n ? <p>Numbers unavailable</p> : (
        <>
          {stale ? <p className="sub">numbers as of {utc(snap.numbersAt!)}</p> : null}
          <dl className="big">
            <dt>Active savers</dt><dd>{n.now.active7d}</dd>
            <dt>Wallets linked now</dt><dd>{n.now.linkedNow}</dd>
            <dt>New users</dt><dd>{n.funnel.d7.signIns}</dd>
            <dt>Round-ups collected</dt><dd>{usd(n.activity7d.roundupCents)}</dd>
            <dt>Saved into coins</dt><dd>{usd(savedIntoCoinsCents(n.activity7d.byCoin))}</dd>
          </dl>
          <p className="sub2">Counts exclude Sprouts test wallets.{n.activity7d.unpriced7d > 0 ? " Swaps without a dollar value are left out of dollar totals." : ""}</p>
        </>
      )}

      <details>
        <summary>All {snap.lights.length} system checks</summary>
        <ul>{snap.lights.map((l) => <LightRow key={l.key} l={l} withAction={false} />)}</ul>
      </details>

      <details>
        <summary>Full numbers</summary>
        {!n ? <p>Numbers unavailable</p> : (
          <>
            <h3>Right now</h3>
            <table><tbody>
              <tr><td>Wallets linked now</td><td className="n">{n.now.linkedNow}</td></tr>
              <tr><td>Active savers (saved in the last 7 days)</td><td className="n">{n.now.active7d}</td></tr>
            </tbody></table>
            <h3>Over time</h3>
            <div className="scroll"><table>
              <thead><tr><th></th><th className="n">Last 24 h</th><th className="n">7 days</th><th className="n">All time</th></tr></thead>
              <tbody>
                {([["New users", "signIns"], ["Started linking", "triedLink"], ["Finished linking", "linkedEver"]] as const).map(([label, k]) => (
                  <tr key={k}><td>{label}</td><td className="n">{n.funnel.d1[k]}</td><td className="n">{n.funnel.d7[k]}</td><td className="n">{n.funnel.all[k]}</td></tr>
                ))}
              </tbody>
            </table></div>
            <h3>Sign-in problems</h3>
            <table><tbody><tr><td>Failed sign-ins, last 24 h</td><td className="n">{n.signInFailures24h}</td></tr></tbody></table>
            <h3>Link problems, 7 days</h3>
            {Object.keys(n.linkFailures7d).length === 0 ? <p>None</p> : (
              <table><tbody>{Object.entries(n.linkFailures7d).map(([k, c]) => <tr key={k}><td>{linkFailureName(k)}</td><td className="n">{c}</td></tr>)}</tbody></table>
            )}
            <h3>Activity, 7 days</h3>
            <table><tbody>
              <tr><td>Swaps</td><td className="n">{n.activity7d.swaps}</td></tr>
              <tr><td>Swapped</td><td className="n">{usd(n.activity7d.usdSwappedCents)}</td></tr>
              <tr><td>Round-ups</td><td className="n">{usd(n.activity7d.roundupCents)}</td></tr>
              <tr><td>Sprouts fees collected</td><td className="n">{usd(n.activity7d.feeCents)}</td></tr>
            </tbody></table>
            <h3>By coin, 7 days</h3>
            {Object.keys(n.activity7d.byCoin).length === 0 ? <p>None</p> : (
              <table>
                <thead><tr><th>Coin</th><th className="n">Saves</th><th className="n">Amount</th></tr></thead>
                <tbody>{Object.entries(n.activity7d.byCoin).map(([c, x]) => <tr key={c}><td>{c}</td><td className="n">{x.plantings}</td><td className="n">{usd(x.usdCents)}</td></tr>)}</tbody>
              </table>
            )}
          </>
        )}
      </details>

      <details>
        <summary>Recent swaps and savings</summary>
        {!n ? <p>Numbers unavailable</p> : (
          <>
            <h3>Recent swaps</h3>
            <div className="scroll"><table>
              <thead><tr><th>When</th><th className="n">Amount</th><th>Status</th></tr></thead>
              <tbody>{n.recentSwaps.length === 0 ? <tr><td colSpan={3}>None</td></tr> : n.recentSwaps.map((r, i) => <tr key={i}><td>{utc(r.at)}</td><td className="n">{usd(r.usdCents)}</td><td>{r.status}</td></tr>)}</tbody>
            </table></div>
            <h3>Recent savings</h3>
            <div className="scroll"><table>
              <thead><tr><th>When</th><th>Coin</th><th className="n">Amount</th><th>Status</th></tr></thead>
              <tbody>{n.recentPlantings.length === 0 ? <tr><td colSpan={4}>None</td></tr> : n.recentPlantings.map((r, i) => <tr key={i}><td>{utc(r.at)}</td><td>{r.coin}</td><td className="n">{usd(r.usdCents)}</td><td>{r.status}</td></tr>)}</tbody>
            </table></div>
          </>
        )}
      </details>

      <details>
        <summary>What this page can&apos;t see</summary>
        <ul>{snap.blindSpots.map((b) => <li key={b} className="bs">{b}</li>)}</ul>
      </details>

      <div className="bar"><LogoutButton /></div>
    </Shell>
  );
}
