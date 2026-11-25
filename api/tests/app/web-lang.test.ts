import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";

// 0.1.13 Spanish pass P9: /link, /revoke and /faqs render in Spanish when the browser's Accept-Language prefers it, else English.
const { acceptLanguage } = vi.hoisted(() => ({ acceptLanguage: { value: null as string | null } }));
vi.mock("next/headers", () => ({ headers: async () => new Headers(acceptLanguage.value ? { "accept-language": acceptLanguage.value } : {}) }));
vi.mock("next/font/google", () => {
  const font = () => ({ className: "font" });
  return { Outfit: font, Albert_Sans: font, Geist: font, Geist_Mono: font };
});
import LinkPage from "@/app/link/page";
import RevokePage from "@/app/revoke/page";
import FaqsPage from "@/app/faqs/page";
import { CAN, CANT, SAFETY_ES } from "@/lib/link-safety-copy";

const render = async (page: () => Promise<ReactElement>, lang: string | null) => {
  acceptLanguage.value = lang;
  // React escapes quotes and apostrophes in text; compare against the plain text.
  return renderToStaticMarkup(await page()).replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
};

describe("web pages follow Accept-Language", () => {
  beforeEach(() => { acceptLanguage.value = null; });

  it("/link: English without the header (exactly today's lines), Spanish for es-419", async () => {
    const en = await render(LinkPage, null);
    expect(en).toContain("Link your trading wallets");
    expect(en).toContain("What Sprouts can and can't do");
    for (const l of [...CAN, ...CANT]) expect(en).toContain(l);
    expect(en).toContain('lang="en"');
    const es = await render(LinkPage, "es-419,es;q=0.9,en;q=0.8");
    expect(es).toContain("Vincula tus billeteras de trading");
    expect(es).toContain(SAFETY_ES.heading);
    for (const l of [...SAFETY_ES.can, ...SAFETY_ES.cant]) expect(es).toContain(l);
    expect(es).toContain('placeholder="CÓDIGO"');
    expect(es).toContain("VINCULAR");
    expect(es).not.toContain("Link your trading wallets");
    expect(es).toContain('lang="es"');
    expect(await render(LinkPage, "en-US,es;q=0.9")).toContain("Link your trading wallets");
  });

  it("/revoke: English without the header, Spanish with es", async () => {
    expect(await render(RevokePage, null)).toContain("Revoke Sprouts");
    const es = await render(RevokePage, "es");
    expect(es).toContain("Revocar Sprouts");
    expect(es).toContain("También puedes revocar en la app, en Ajustes.");
  });

  it("/faqs: English without the header, Spanish (with the Spanish can / can't card) with es-AR", async () => {
    const en = await render(FaqsPage, null);
    expect(en).toContain("How does it work?");
    for (const l of CAN) expect(en).toContain(l);
    const es = await render(FaqsPage, "es-AR");
    expect(es).toContain("¿Cómo funciona?");
    expect(es).toContain("Preguntas frecuentes");
    for (const l of SAFETY_ES.can) expect(es).toContain(l);
    expect(es).not.toContain("How does it work?");
    expect(es).not.toMatch(/—/);
  });
});
