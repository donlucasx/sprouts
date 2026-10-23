import { Outfit } from "next/font/google";

/**
 * His ask 10-23: one header and one footer for the whole site. Every page but the splash gets the header (the mark, back home); every
 * page gets the footer (the links, the X icon, the email). Colours come from the page's --ink / --muted when it sets them (Terms in
 * dark mode), else the splash's paper palette.
 */
const outfit = Outfit({ subsets: ["latin"], weight: ["400", "600"] });

export const X_URL = "https://x.com/sproutsonseeker";
/** The listing has no web page: the store opens this link on a Seeker (read off the dApp Store app 10-23). */
export const STORE_URL = "solanadappstore://details?id=money.sprouts.app";

const LINKS = [["/deck", "DECK"], ["/faqs", "FAQs"], ["/link", "LINK"], ["/terms", "TERMS"], ["/revoke", "REVOKE"]] as const;

const CSS = `
.sc { --sc-ink: var(--ink, #2B2622); --sc-muted: var(--muted, #8A847B); }
.sc-head { width: 100%; max-width: 72rem; margin: 0 auto; padding: 18px 24px; }
.sc-head .sc-mark { display: inline-flex; align-items: center; gap: .3em; font-size: 19px; font-weight: 600; letter-spacing: -0.03em; color: var(--sc-ink); text-decoration: none; opacity: .9; }
.sc-head .sc-mark:hover { opacity: 1; }
.sc-head .sc-mark img { height: .95em; width: auto; filter: brightness(0); opacity: .86; }
.sc-foot { display: grid; justify-items: center; gap: 12px; padding: 24px 24px 32px; font-weight: 400; }
.sc-foot a { color: var(--sc-muted); text-decoration: none; }
.sc-foot a:hover { color: var(--sc-ink); }
.sc-nav { display: flex; flex-wrap: wrap; justify-content: center; align-items: center; row-gap: 8px; font-size: 12px; letter-spacing: .16em; }
.sc-sep { width: 1px; height: 11px; background: var(--sc-muted); opacity: .45; margin: 0 14px; }
.sc-contact { display: flex; align-items: center; gap: 14px; font-size: 13px; letter-spacing: .02em; }
.sc-contact svg { width: 13px; height: 13px; display: block; fill: currentColor; }
@media (prefers-color-scheme: dark) { .sc-darkok .sc-mark img { filter: brightness(0) invert(1); } }
@media print { .sc-head, .sc-foot { display: none; } }
`;

/** The subtle header: the mark and the name, linking home. `darkOk` for a page that follows the system's dark mode. */
export function SiteHeader({ darkOk = false }: { darkOk?: boolean }) {
  return (
    <header className={`sc sc-head ${darkOk ? "sc-darkok" : ""} ${outfit.className}`}>
      <style>{CSS}</style>
      <a className="sc-mark" href="/" aria-label="Sprouts home">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/deck/mark.svg" alt="" />Sprouts
      </a>
    </header>
  );
}

/** DECK | FAQs | LINK | TERMS | REVOKE, then the X icon and the email. */
export function SiteFooter() {
  return (
    <footer className={`sc sc-foot ${outfit.className}`}>
      <style>{CSS}</style>
      <nav className="sc-nav">
        {LINKS.map(([href, label], i) => (
          <span key={href} style={{ display: "inline-flex", alignItems: "center" }}>
            {i > 0 ? <span aria-hidden className="sc-sep" /> : null}
            <a href={href}>{label}</a>
          </span>
        ))}
      </nav>
      <div className="sc-contact">
        <a href={X_URL} aria-label="Sprouts on X" title="@sproutsonseeker">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" /></svg>
        </a>
        <span aria-hidden className="sc-sep" style={{ margin: 0 }} />
        <a href="mailto:hello@sprouts.money">hello@sprouts.money</a>
      </div>
    </footer>
  );
}
