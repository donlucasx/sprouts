import { ES_ERRORS, ES_LINES } from "./es";

/**
 * 0.1.13 Spanish pass P9: the server's user-facing text in the asking app's language. English is the default and the source:
 * every English sentence the server sends stays byte for byte what it was. A request with no accept-language (every 0.1.12 app,
 * curl, the crons) is English. The 0.1.13 app sends its chosen language; a browser sends its own preference.
 */
export type Lang = "en" | "es";

type HeaderSource = Request | Headers | string | null | undefined;

/**
 * "es" when the first preferred language of accept-language is Spanish (es, es-AR, es-419, ...), else "en". "First preferred" is the
 * highest q, ties by order; q=0 means "not this one". A malformed header is English.
 */
export function langOf(from: HeaderSource): Lang {
  const raw = typeof from === "string" ? from : from == null ? null : from instanceof Headers ? from.get("accept-language") : from.headers.get("accept-language");
  if (!raw) return "en";
  let best: { tag: string; q: number } | null = null;
  for (const part of raw.split(",").slice(0, 20)) {
    const [tagRaw, ...params] = part.trim().split(";");
    const tag = tagRaw.trim().toLowerCase();
    if (!tag) continue;
    let q = 1;
    for (const p of params) {
      const m = /^\s*q\s*=\s*([0-9.]+)\s*$/i.exec(p);
      if (m) q = Number(m[1]);
    }
    if (!Number.isFinite(q) || q <= 0) continue;
    if (!best || q > best.q) best = { tag, q };
  }
  return best && (best.tag === "es" || best.tag.startsWith("es-")) ? "es" : "en";
}

/** Fills {name} slots; a slot with no value stays as written. */
export const fill = (template: string, vars: Record<string, string | number> = {}): string =>
  template.replace(/\{(\w+)\}/g, (all, k: string) => (k in vars ? String(vars[k]) : all));

// ---- Spanish numbers (his ruling 11-25: "$1.234,50", "0,5%", US dollars) ----

/** "1234.5" -> "1.234,5": thousands with ".", decimals with ",". Takes the plain toFixed string. */
export function esGrouped(n: string): string {
  const neg = n.startsWith("-");
  const [whole, frac] = (neg ? n.slice(1) : n).split(".");
  const g = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${neg ? "-" : ""}${frac === undefined ? g : `${g},${frac}`}`;
}
/** A number at fixed decimals, Spanish style: (1234.5, 2) -> "1.234,50". */
export const esFixed = (n: number, places: number): string => esGrouped(n.toFixed(places));

/** Every English-formatted number inside a captured value ("$1,234.50", "0.01", "12") rewritten Spanish style. */
export function esNumbersIn(s: string): string {
  return s.replace(/\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?/g, (m) => esGrouped(m.replace(/,/g, "")));
}

/** Slots whose captured value is a number or an amount: their English separators become Spanish. Others are kept as captured. */
const NUMERIC_SLOTS = new Set(["usd", "need", "have", "sol", "min", "amount", "pct", "n"]);

type Compiled = { re: RegExp; slots: string[]; es: string };
const compiledCache = new Map<Record<string, string>, Compiled[]>();
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
function compile(table: Record<string, string>): Compiled[] {
  const hit = compiledCache.get(table);
  if (hit) return hit;
  const out: Compiled[] = [];
  for (const [en, es] of Object.entries(table)) {
    if (!/\{\w+\}/.test(en)) continue;
    const slots: string[] = [];
    const pattern = en.split(/(\{\w+\})/).map((piece) => {
      const m = /^\{(\w+)\}$/.exec(piece);
      if (!m) return escapeRe(piece);
      slots.push(m[1]);
      return "(.+?)";
    }).join("");
    out.push({ re: new RegExp(`^${pattern}$`, "s"), slots, es });
  }
  compiledCache.set(table, out);
  return out;
}

/**
 * The Spanish for one English sentence from `table` (English template -> Spanish template), or null. An exact entry wins; else the
 * first template whose English matches, its captured slots carried over (numbers re-formatted) unless `vars` gives a slot's Spanish.
 */
export function spanishOf(table: Record<string, string> | undefined, english: string, vars: Record<string, string> = {}): string | null {
  if (!table) return null;
  const exact = Object.prototype.hasOwnProperty.call(table, english) ? table[english] : undefined;
  if (exact !== undefined) return fill(exact, vars);
  for (const c of compile(table)) {
    const m = c.re.exec(english);
    if (!m) continue;
    const got: Record<string, string> = {};
    c.slots.forEach((slot, i) => { got[slot] = NUMERIC_SLOTS.has(slot) ? esNumbersIn(m[i + 1]) : m[i + 1]; });
    return fill(c.es, { ...got, ...vars });
  }
  return null;
}

/** An error's sentence for this request: the Spanish line for `code` when lang is es and one exists, else the English unchanged. */
export function errorText(code: string, english: string, lang: Lang | undefined, vars?: Record<string, string>): string {
  if (lang !== "es") return english;
  return spanishOf((ES_ERRORS as Record<string, Record<string, string>>)[code], english, vars) ?? english;
}

/** A non-error line the app shows as received (reminders, the note, briefs, found-venue notes): Spanish when lang is es and known. */
export function lineText(english: string, lang: Lang | undefined, vars?: Record<string, string>): string {
  if (lang !== "es") return english;
  return spanishOf(ES_LINES, english, vars) ?? english;
}

const MONTHS_ES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sept", "oct", "nov", "dic"];
/** A withdrawal's arrival in UTC, as the app says it in Spanish: "27 nov, 15:00 UTC" (en: "Nov 27, 3 PM UTC"). */
export const esDayHourUtc = (d: Date): string => `${d.getUTCDate()} ${MONTHS_ES[d.getUTCMonth()]}, ${String(d.getUTCHours()).padStart(2, "0")}:00 UTC`;
