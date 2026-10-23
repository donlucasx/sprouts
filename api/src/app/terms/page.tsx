import type { Metadata } from "next";
import { Outfit, Albert_Sans } from "next/font/google";
import { TERMS_MD } from "@/lib/terms-text";
import { SiteFooter, SiteHeader } from "../site-chrome";

/** The Terms of Use and Privacy, public (10-05: wallet reviewers asked for the site's terms; the same text the app shows). */
const outfit = Outfit({ subsets: ["latin"], weight: ["600"], variable: "--font-display" });
const albert = Albert_Sans({ subsets: ["latin"], weight: ["400", "600"], variable: "--font-body" });

export const metadata: Metadata = { title: "Sprouts: Terms of Use and Privacy", description: "The Terms of Use and Privacy for Sprouts." };

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

/** His ask 10-23: the section names under the title, so the long page can be skipped through. */
function contents(md: string) {
  const heads = md.split("\n").filter((l) => l.startsWith("## ")).map((l) => l.slice(3)).filter((h) => !h.startsWith("In three lines"));
  return <nav className="toc" aria-label="Sections">{heads.map((h) => <a key={h} href={`#${slug(h)}`}>{h}</a>)}</nav>;
}

const CSS = `
.terms { --paper:#FFFCF6; --ink:#2B2622; --muted:#6E6A64; --leaf-ink:#145A3C; background:var(--paper); color:var(--ink); min-height:100vh; font-family:var(--font-body), "Helvetica Neue", Arial, sans-serif; font-size:16px; line-height:1.6; }
@media (prefers-color-scheme: dark) { .terms { --paper:#0E1A14; --ink:#FFFCF6; --muted:#C9D8CE; --leaf-ink:#A7F0B6; color-scheme:dark; } }
.terms .wrap { max-width:42rem; margin:0 auto; padding:1.5rem 1.25rem 3rem; }
.terms .toc { display:flex; flex-wrap:wrap; gap:.4rem 1.1rem; font-size:.9rem; margin:0 0 2rem; padding:0 0 1.25rem; border-bottom:1px solid color-mix(in srgb, var(--muted) 30%, transparent); }
.terms .toc a { text-decoration:none; }
.terms .toc a:hover { text-decoration:underline; }
.terms h2 { scroll-margin-top:1rem; }
.terms h1 { font-family:var(--font-display), sans-serif; font-weight:600; font-size:2rem; line-height:1.15; color:var(--leaf-ink); margin:0 0 1rem; }
.terms h2 { font-family:var(--font-display), sans-serif; font-weight:600; font-size:1.2rem; margin:2rem 0 .5rem; }
.terms p, .terms ul { margin:0 0 .9rem; }
.terms a { color:var(--leaf-ink); }
`;

/** The title, then the section links, then the text. */
function withContents(md: string) {
  const [first, ...rest] = blocks(md);
  return [first, <div key="toc">{contents(md)}</div>, ...rest];
}

export default function Terms() {
  return (
    <div className={`terms ${outfit.variable} ${albert.variable}`}>
      <style>{CSS}</style>
      <SiteHeader darkOk />
      <div className="wrap">{withContents(TERMS_MD)}</div>
      <SiteFooter />
    </div>
  );
}
