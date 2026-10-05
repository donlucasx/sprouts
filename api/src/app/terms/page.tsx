import type { Metadata } from "next";
import { Outfit, Albert_Sans } from "next/font/google";
import { TERMS_MD } from "@/lib/terms-text";

/** The Terms of Use and Privacy, public (10-05: wallet reviewers asked for the site's terms; the same text the app shows). */
const outfit = Outfit({ subsets: ["latin"], weight: ["600"], variable: "--font-display" });
const albert = Albert_Sans({ subsets: ["latin"], weight: ["400", "600"], variable: "--font-body" });

export const metadata: Metadata = { title: "Sprouts: Terms of Use and Privacy", description: "The Terms of Use and Privacy for Sprouts, version 2026-10-07." };

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

/** A small reader for this one file's shapes: "# ", "## ", "- " list lines and paragraphs. */
function blocks(md: string) {
  return md.trim().split(/\n\n+/).map((b, i) => {
    if (b.startsWith("## ")) return <h2 key={i} id={slug(b.slice(3))}>{b.slice(3)}</h2>;
    if (b.startsWith("# ")) return <h1 key={i}>{b.slice(2)}</h1>;
    if (b.startsWith("- ")) return <ul key={i}>{b.split("\n").map((l, j) => <li key={j}>{l.replace(/^- /, "")}</li>)}</ul>;
    return <p key={i}>{b}</p>;
  });
}

const CSS = `
.terms { --paper:#FFFCF6; --ink:#2B2622; --muted:#6E6A64; --leaf-ink:#145A3C; background:var(--paper); color:var(--ink); min-height:100vh; font-family:var(--font-body), "Helvetica Neue", Arial, sans-serif; font-size:16px; line-height:1.6; }
@media (prefers-color-scheme: dark) { .terms { --paper:#0E1A14; --ink:#FFFCF6; --muted:#C9D8CE; --leaf-ink:#A7F0B6; color-scheme:dark; } }
.terms .wrap { max-width:42rem; margin:0 auto; padding:3rem 1.25rem 4rem; }
.terms h1 { font-family:var(--font-display), sans-serif; font-weight:600; font-size:2rem; line-height:1.15; color:var(--leaf-ink); margin:0 0 1rem; }
.terms h2 { font-family:var(--font-display), sans-serif; font-weight:600; font-size:1.2rem; margin:2rem 0 .5rem; }
.terms p, .terms ul { margin:0 0 .9rem; }
.terms a { color:var(--leaf-ink); }
`;

export default function Terms() {
  return (
    <div className={`terms ${outfit.variable} ${albert.variable}`}>
      <style>{CSS}</style>
      <div className="wrap">{blocks(TERMS_MD)}<p><a href="/">sprouts.money</a></p></div>
    </div>
  );
}
