import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { langOf, errorText, lineText, esFixed, esNumbersIn, esDayHourUtc, spanishOf } from "@/lib/i18n";
import { ES_ERRORS, ES_LINES } from "@/lib/i18n/es";
import { apiError, englishErrorOf, API_ERROR_CODES } from "@/lib/api-error";
import { TOPUP_COPY, TOPUP_CONFIRM } from "@/lib/topup";
import { PLANT_COPY, PLANT_CONFIRM } from "@/lib/plant-skr";
import { STILL_WAITING } from "@/lib/user-tx";
import { IN_FLIGHT } from "@/lib/moves";
import { planPick } from "@/lib/withdraw";
import { verifyReauth } from "@/lib/reauth";
import { reminderFor } from "@/domain/reminders";
import { CURRENT_MESSAGE } from "@/domain/messages";
import { foundNote, foundNoteEs } from "@/lib/split-run";

const SRC = join(__dirname, "../../src");
const walk = (d: string): string[] => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : /\.tsx?$/.test(f) ? [join(d, f)] : []));
const files = walk(SRC);
const allSrc = files.filter((f) => !f.includes(join("lib", "i18n"))).map((f) => readFileSync(f, "utf8")).join("\n");
/** Routes no app shows (operator and machine endpoints): English only, no lang. */
const NOT_USER_FACING = /[/\\]api[/\\](ops|cron|webhooks)[/\\]/;
const userRoutes = files.filter((f) => /[/\\]app[/\\]api[/\\]/.test(f) && !NOT_USER_FACING.test(f));

/** Every apiError(...) call's full text in a file (paren-matched, strings and template literals skipped). */
function calls(text: string): string[] {
  const out: string[] = [];
  let i = 0;
  for (;;) {
    const j = text.indexOf("apiError(", i);
    if (j < 0) return out;
    let k = j + 9, depth = 1, q: string | null = null;
    while (depth) {
      const c = text[k];
      if (q) { if (c === "\\") { k += 2; continue; } if (c === q) q = null; }
      else if (c === '"' || c === "'" || c === "`") q = c;
      else if (c === "(") depth++;
      else if (c === ")") depth--;
      k++;
    }
    out.push(text.slice(j, k));
    i = k;
  }
}

describe("langOf", () => {
  it.each([
    [null, "en"], ["", "en"], ["en", "en"], ["en-US,en;q=0.9", "en"], ["es", "es"], ["es-AR", "es"], ["es-419", "es"], ["ES-mx", "es"],
    ["es-419,es;q=0.9,en;q=0.8", "es"], ["en-US,es;q=0.9", "en"], ["es;q=0.5,en;q=0.9", "en"], ["fr;q=0.9,es;q=0.95", "es"],
    ["pt-BR,pt;q=0.9", "en"], ["est", "en"], ["*", "en"], ["es;q=0", "en"], ["garbage;;;", "en"], ["  es  ", "es"],
  ])("%j -> %s", (header, want) => {
    expect(langOf(header)).toBe(want);
    expect(langOf(new Request("http://x", header ? { headers: { "accept-language": header } } : {}))).toBe(want);
  });
  it("a request with no header at all is English (every 0.1.12 app)", () => {
    expect(langOf(new Request("http://x"))).toBe("en");
    expect(langOf(undefined)).toBe("en");
  });
});

describe("Spanish numbers", () => {
  it("$1.234,50 and 0,5% (his ruling 11-25)", () => {
    expect(esFixed(1234.5, 2)).toBe("1.234,50");
    expect(esFixed(0.5, 1)).toBe("0,5");
    expect(esFixed(1234567.891, 4)).toBe("1.234.567,8910");
    expect(esNumbersIn("$1,234.50")).toBe("$1.234,50");
    expect(esNumbersIn("0.01 SOL and $10.00")).toBe("0,01 SOL and $10,00");
    expect(esNumbersIn("$45.2M")).toBe("$45,2M");
  });
  it("a withdrawal's arrival, UTC, 24-hour", () => {
    expect(esDayHourUtc(new Date("2026-11-27T15:00:00Z"))).toBe("27 nov, 15:00 UTC");
    expect(esDayHourUtc(new Date("2026-01-03T00:40:00Z"))).toBe("3 ene, 0:00 UTC");
  });
});

describe("errorText / apiError", () => {
  it("no lang or en: the English unchanged, byte for byte", async () => {
    for (const lang of [undefined, "en"] as const) {
      expect(errorText("sign_in_first", "Sign in first.", lang)).toBe("Sign in first.");
      const res = apiError("move_partial", { error: "Your SOL is back in your wallet; the move did not finish.", partial: true }, { status: 409 }, lang);
      expect(res.status).toBe(409);
      expect(await res.text()).toBe('{"error":"Your SOL is back in your wallet; the move did not finish.","code":"move_partial","partial":true}');
    }
  });
  it("es: the Spanish line, the same code, status, headers and extras", async () => {
    const res = apiError("rate_limited", { error: "Too many requests. Try again in a minute." }, { status: 429, headers: { "Retry-After": "30" } }, "es");
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("30");
    expect(await res.json()).toEqual({ error: "Demasiadas solicitudes. Inténtalo de nuevo en un minuto.", code: "rate_limited" });
    const partial = apiError("move_partial", { error: "Your SOL is back in your wallet; the move did not finish.", partial: true, unwrapTransaction: "T" }, { status: 409 }, "es");
    expect(await partial.json()).toEqual({ error: "Tu SOL volvió a tu billetera; el movimiento no terminó.", code: "move_partial", partial: true, unwrapTransaction: "T" });
  });
  it("a sample of codes: es -> Spanish, same code and status; no header -> exact old English", async () => {
    const sample: [Parameters<typeof apiError>[0], string, number][] = [
      ["sign_in_first", "Sign in first.", 401], ["bad_request", "Bad request: pins.", 400], ["code_unknown", "This code is unknown, expired or already used.", 404],
      ["wallet_taken", "This wallet is linked to another Seeker. Revoke it there first.", 409], ["pool_full", "A venue can pause withdrawals when its pool is fully lent out; your money stays yours.", 409],
      ["topup_bad_amount", "Pick an amount from $2 to $25.", 400], ["plant_off", PLANT_COPY.off, 503], ["still_waiting", STILL_WAITING.revoke, 409],
      ["move_in_flight", IN_FLIGHT, 409], ["tx_failed", TOPUP_CONFIRM.failedToken, 400],
    ];
    for (const [code, english, status] of sample) {
      const es = apiError(code, { error: english }, { status }, "es");
      const body = (await es.json()) as { error: string; code: string };
      expect(body.code).toBe(code);
      expect(es.status).toBe(status);
      expect(body.error).not.toBe(english);
      expect(body.error).toBe(spanishOf((ES_ERRORS as Record<string, Record<string, string>>)[code], english));
      const old = apiError(code, { error: english }, { status });
      expect(await old.text()).toBe(JSON.stringify({ error: english, code }));
    }
    expect((await apiError("bad_request", { error: "Bad request: pins." }, { status: 400 }, "es").json()).error).toBe("Solicitud no válida: pins.");
  });
  it("an English sentence with no Spanish line goes out in English (the fallback), and the failure log always sees the English", async () => {
    expect(errorText("internal", "Cron failed: boom", "es")).toBe("Cron failed: boom");
    expect(errorText("bad_transaction", "Some upstream text.", "es")).toBe("Some upstream text.");
    const res = apiError("code_unknown", { error: "This code is unknown, expired or already used." }, { status: 404 }, "es");
    expect(englishErrorOf(res)).toBe("This code is unknown, expired or already used.");
  });
  it("lib refusals translate from their real English (top-up, plant, reauth, withdraw)", async () => {
    const es = (code: string, e: string) => errorText(code, e, "es");
    expect(es("topup_refused", TOPUP_COPY.noSol(1000, 52_000_000n, 3_000_000n))).toBe("No hay suficiente SOL. Agregar $10,00 en USDC necesita unos 0,052 SOL más 0,01 SOL reservados para comisiones, y esta billetera tiene 0,003 SOL.");
    expect(es("topup_refused", TOPUP_COPY.noRouteFor("SOL"))).toBe("Sprouts no puede hacer el swap de SOL a USDC en este momento. No se le pidió nada a tu billetera. Inténtalo de nuevo en unos minutos.");
    expect(es("topup_refused", TOPUP_COPY.noRouteFor("JUP"))).toBe("Sprouts no puede hacer el swap de JUP a USDC en este momento. No se le pidió nada a tu billetera. Prueba con SOL o inténtalo más tarde.");
    expect(es("topup_refused", TOPUP_COPY.noToken("BONK", 1250))).toBe("No hay suficiente BONK. Agregar $12,50 en USDC necesita más de lo que tiene esta billetera.");
    expect(es("topup_refused", TOPUP_COPY.noSolForFee("JUP"))).toMatch(/^No hay suficiente SOL para la comisión de red\. Agregar USDC desde JUP necesita unos 0,\d+ SOL en esta billetera\.$/);
    for (const f of [TOPUP_COPY.noPriceFor("JUP"), TOPUP_COPY.noFairPrice("JUP"), TOPUP_COPY.notSource, TOPUP_COPY.notNow, TOPUP_COPY.noneHeld, TOPUP_COPY.tooBig, TOPUP_COPY.wouldFail]) expect(es("topup_refused", f)).not.toBe(f);
    for (const f of [PLANT_COPY.badAmount, PLANT_COPY.stale, PLANT_COPY.notNow, PLANT_COPY.wouldFail]) expect(es("plant_refused", f)).not.toBe(f);
    for (const what of ["Raising your daily limit", "Turning Sprouts back on", "Resuming a wallet"]) {
      const r = await verifyReauth({} as never, "P", undefined, what);
      expect(r.ok).toBe(false);
      expect(es("reauth_required", (r as { error: string }).error)).not.toBe((r as { error: string }).error);
    }
    const pot = { skrStakedRaw: 5_000_000n, skrEarnedRaw: 100_000n };
    for (const [mode, amountRaw] of [["earned", undefined], ["amount", 500_000n], ["amount", 9_000_000n]] as const) {
      let msg = "";
      try { planPick({ mode, amountRaw, pot, sharePrice: 1_000_000_000n, skrUsd: null }); } catch (e) { msg = (e as Error).message; }
      const code = msg.includes("more than") ? "withdraw_too_large" : "withdraw_refused";
      expect(es(code, msg)).not.toBe(msg);
    }
  });
  it("basket_busy: the route's Spanish date fills {when}", () => {
    const when = esDayHourUtc(new Date("2026-11-27T15:00:00Z"));
    expect(errorText("basket_busy", "One basket at a time. Your last withdrawal arrives Nov 27, 3 PM UTC.", "es", { when })).toBe("Una canasta a la vez. Tu último retiro llega el 27 nov, 15:00 UTC.");
    expect(errorText("basket_busy", "One basket at a time. Your Seeker's wallet is already ripening a withdrawal; it arrives Nov 27, 3 PM UTC.", "es", { when }))
      .toBe("Una canasta a la vez. La billetera de tu Seeker ya está madurando un retiro; llega el 27 nov, 15:00 UTC.");
    expect(errorText("basket_busy", "One basket at a time. Your Seeker's wallet is already ripening a withdrawal.", "es")).toBe("Una canasta a la vez. La billetera de tu Seeker ya está madurando un retiro.");
  });
});

describe("the dictionary matches what the server really says", () => {
  const table = ES_ERRORS as Record<string, Record<string, string>>;
  it("every code in ES_ERRORS is a documented code", () => {
    for (const code of Object.keys(table)) expect(Object.keys(API_ERROR_CODES)).toContain(code);
  });
  it("every English key is a sentence in src (a template's fixed parts each appear in src)", () => {
    // reauth's sentence is composed (`${what} asks your Seeker to sign in again.`); the reauth test above checks the real ones.
    // So is withdraw/build's "already ripening" line (an optional "; it arrives ..."); the basket_busy test above covers both forms.
    const composed = (en: string) => en.endsWith(" asks your Seeker to sign in again.") || en.includes("already ripening a withdrawal");
    // topup_refused's lines are built by TOPUP_COPY's functions; "lib refusals translate from their real English" calls them.
    for (const [code, lines] of Object.entries(table)) for (const en of Object.keys(lines).filter((x) => !composed(x) && code !== "topup_refused")) {
      // a trailing period may follow an optional piece in the source (`a withdrawal${readyAt ? ... : ""}.`)
      const parts = en.split(/\{\w+\}/).map((p) => p.trim().replace(/\.$/, "")).filter((p) => p.length > 2);
      for (const p of parts) expect({ code, en, part: p, found: allSrc.includes(p) }).toEqual({ code, en, part: p, found: true });
    }
    for (const en of Object.keys(ES_LINES)) expect({ en, found: allSrc.includes(en) }).toEqual({ en, found: true });
  });
  it("Spanish and English keep the same {slots}; no em dash; no English left in a Spanish line's slots", () => {
    const slots = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    for (const lines of [...Object.values(table), ES_LINES]) for (const [en, es] of Object.entries(lines)) {
      expect({ en, slots: slots(es) }).toEqual({ en, slots: slots(en) });
      expect(es).not.toMatch(/—|–/);
    }
  });
  it("every literal error sentence a user-facing route sends has a Spanish line under its code", () => {
    const missing: string[] = [];
    for (const f of userRoutes) for (const c of calls(readFileSync(f, "utf8"))) {
      const m = /^apiError\("(\w+)", \{ error: "([^"]*)"/.exec(c);
      if (m && spanishOf(table[m[1]], m[2]) === null) missing.push(`${m[1]}: ${m[2]}`);
    }
    expect(missing).toEqual([]);
  });
  it("every apiError in a user-facing route passes the request's lang (ops, cron, webhooks stay English)", () => {
    const without: string[] = [];
    let n = 0;
    for (const f of [...userRoutes, join(SRC, "lib/auth-guard.ts"), join(SRC, "lib/bad-request.ts")]) for (const c of calls(readFileSync(f, "utf8"))) {
      n++;
      if (!/, (lang|langOf\(request\))(, .*)?\)$/.test(c.replace(/\s+/g, " "))) without.push(`${f.slice(SRC.length)}: ${c.slice(0, 80)}`);
    }
    expect(without).toEqual([]);
    expect(n).toBeGreaterThan(180);
  });
});

describe("non-error lines", () => {
  it("reminders A1-A9 and the note all have Spanish", () => {
    const at = (d: number) => new Date(Date.UTC(2026, 10, 1) + d * 86_400_000);
    const base = { now: at(30), signedUpAt: at(0), walletsEver: 0, activeWallets: 0, pausedNoUsdcSince: [], stoppedSince: [], lastSwapAt: null, firstActiveLinkAt: null, lastLinkFailAt: null, lastLinkAttemptAfterFail: false };
    const rs = [
      reminderFor({ ...base, now: at(1) }), reminderFor({ ...base, now: at(3) }), reminderFor({ ...base, now: at(7) }),
      reminderFor({ ...base, walletsEver: 1, activeWallets: 1, pausedNoUsdcSince: [{ wallet: "W", since: at(20) }] }),
      reminderFor({ ...base, walletsEver: 1, stoppedSince: [{ wallet: "W", since: at(20) }] }),
      reminderFor({ ...base, walletsEver: 1, activeWallets: 1, firstActiveLinkAt: at(0) }),
      reminderFor({ ...base, now: at(2), lastLinkFailAt: at(1) }),
    ];
    expect(rs.map((r) => r?.kind)).toEqual(["link_new", "link_new", "link_new", "usdc_waiting", "relink", "idle", "link_unfinished"]);
    for (const r of rs) for (const s of [r!.title, r!.body]) expect({ s, es: lineText(s, "es") !== s }).toEqual({ s, es: true });
    for (const s of [CURRENT_MESSAGE.heading, CURRENT_MESSAGE.body, PLANT_CONFIRM.pending, TOPUP_CONFIRM.pending]) expect(lineText(s, "es")).not.toBe(s);
    expect(lineText(CURRENT_MESSAGE.body, "en")).toBe(CURRENT_MESSAGE.body);
    expect(lineText("not a known line", "es")).toBe("not a known line");
  });
  it("the reminder in Spanish never says a top-up goes to the garden", () => {
    for (const es of Object.values(ES_LINES)) expect(es).not.toMatch(/Agreg\w* .*(al|a tu) jardín/);
  });
  it("withdraw brief: English unchanged, Spanish with Spanish numbers", () => {
    const pot = { skrStakedRaw: 5_000_000_000n, skrEarnedRaw: 1_234_560_000n };
    const a = { mode: "amount" as const, amountRaw: 2_000_000_000n, pot, sharePrice: 1_000_000_000n, skrUsd: 0.0183 };
    expect(planPick(a).brief).toEqual(["Withdraw 2000.00 SKR ($36.60). Your SKR plant gets smaller.", "Arrives in your wallet in 48 hours. You can put it back until then.", "Network fee about $0.001."]);
    expect(planPick(a, "es").brief).toEqual(["Retirar 2.000,00 SKR ($36,60). Tu planta de SKR se hace más pequeña.", "Llega a tu billetera en 48 horas. Puedes devolverlo hasta entonces.", "Comisión de red de unos $0,001."]);
    expect(planPick({ ...a, mode: "earned", skrUsd: null }, "es").brief[0]).toBe("Retirar tus ganancias: 1.234,56 SKR.");
  });
  it("foundNoteEs from the same numbers", () => {
    expect(foundNote({ apyBasePct: 9.14, tvlUsd: 850_000 })).toBe("9.1% base, $850K deposited");
    expect(foundNoteEs({ apyBasePct: 9.14, tvlUsd: 850_000 })).toBe("9,1% base, $850K depositados");
    expect(foundNoteEs({ apyBasePct: null, tvlUsd: 1.25e9 })).toBe("$1,3B depositados");
  });
});
