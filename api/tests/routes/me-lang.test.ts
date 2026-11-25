import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { MemoryRepo } from "@/db/memory";
import { setRepoForTests } from "@/db/repo";
import { issueSession } from "@/lib/session";
import { dayOf } from "@/domain/day";
import { foundNote } from "@/lib/split-run";

// 0.1.13 Spanish pass P9: /api/me's reminder and one-time note follow the asking app's accept-language; no header is today's English.
const SP = 1_146_000_000n;
const U = "HJCJKRQLV2HVKfe3sFdTF5jjBY1xfWgnK8cLcjH7qnHd";
vi.mock("@/lib/staking", () => ({
  readPosition: vi.fn(async () => ({ shares: 0n, stakedRaw: 0n, unstakingRaw: 0n, unstakeTs: null })),
  sharePrice: vi.fn(async () => SP),
}));
vi.mock("@/lib/jupiter", () => ({ priceUsd: vi.fn(async () => 0.0183) }));
vi.mock("@/lib/store", () => ({ storeBalanceRaw: vi.fn(async () => 0n), storeRedeemRate: vi.fn(async () => 1_048_350_000n) }));
vi.mock("@/lib/holdings", async (orig) => ({ ...(await orig<object>()), readHoldings: vi.fn(async () => ({})), readLendingPositions: vi.fn(async () => []) }));
vi.mock("@/lib/leash", async (orig) => ({ ...(await orig<object>()), readLeashConfig: vi.fn(async () => { throw new Error("not deployed"); }) }));
vi.mock("@/lib/subscriptions", () => ({ readDelegation: vi.fn(async () => ({ exists: false, amountPerPeriodRaw: 0n, pulledInPeriodRaw: 0n, periodStartTs: 0n, periodLengthS: 0n })) }));
import { GET as me } from "@/app/api/me/route";
import { GET as venues } from "@/app/api/venues/route";
import { GET as activity } from "@/app/api/activity/route";

const req = (token: string, lang?: string) =>
  new Request("http://x/api/me", { headers: { authorization: `Bearer ${token}`, ...(lang ? { "accept-language": lang, "x-sprouts-app": "0.1.13" } : {}) } });

describe("P9: /api/me in the app's language", () => {
  let repo: MemoryRepo;
  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-20T12:00:00Z"));
    repo = new MemoryRepo();
    setRepoForTests(repo);
    await repo.upsertUser({ seedVaultPubkey: U, sgtMint: "M", skrName: "lucas.skr" });   // signed up, no wallet yet
    vi.setSystemTime(new Date("2026-11-21T13:00:00Z"));   // a day later: the first link reminder (nolink-1)
  });
  afterEach(() => vi.useRealTimers());

  it("no accept-language (0.1.12): the reminder and the note exactly in English", async () => {
    const token = await issueSession(U, "M");
    const body = await (await me(req(token))).json();
    expect(body.reminder).toEqual({ id: "nolink-1", kind: "link_new", route: "/connect", title: "Your garden is ready to plant", body: "Link a wallet and your swaps start rounding up. It takes about 30 seconds." });
    expect(body.message).toEqual({ id: "lucas-2026-11-b", heading: "From Lucas", body: "You're one of the first people using Sprouts. If you have any questions, ideas or feedback, please reach out!", action: "message_us" });
  });

  it("accept-language es: the same reminder (id, kind, route) and note in Spanish", async () => {
    const token = await issueSession(U, "M");
    const body = await (await me(req(token, "es"))).json();
    expect(body.reminder).toEqual({ id: "nolink-1", kind: "link_new", route: "/connect", title: "Tu jardín está listo para plantar", body: "Vincula una billetera y tus swaps empiezan a redondearse. Toma unos 30 segundos." });
    expect(body.message).toEqual({ id: "lucas-2026-11-b", heading: "De Lucas", body: "Eres de las primeras personas en usar Sprouts. Si tienes preguntas, ideas o comentarios, ¡escríbeme!", action: "message_us" });
  });

  it("the repeat-read memo keeps each language's answer apart (es then en within the window)", async () => {
    const token = await issueSession(U, "M");
    expect((await (await me(req(token, "es-AR"))).json()).reminder.title).toBe("Tu jardín está listo para plantar");
    expect((await (await me(req(token, "en"))).json()).reminder.title).toBe("Your garden is ready to plant");
    expect((await (await me(req(token, "es-AR"))).json()).reminder.title).toBe("Tu jardín está listo para plantar");
  });

  it("a 401 follows the language too, with the same code", async () => {
    const es = await me(new Request("http://x/api/me", { headers: { "accept-language": "es" } }));
    expect(es.status).toBe(401);
    expect(await es.json()).toEqual({ error: "Primero inicia sesión.", code: "sign_in_first" });
    const en = await me(new Request("http://x/api/me"));
    expect(await en.text()).toBe(JSON.stringify({ error: "Sign in first.", code: "sign_in_first" }));
  });

  it("found venues: a note built from the numbers is rebuilt in Spanish; a stored model note and English stay as stored", async () => {
    const day = dayOf(new Date());
    const ours = { day, poolId: "p1", project: "drift", symbol: "USDC", asset: "USDC" as const, apyBasePct: 9.14, tvlUsd: 45_200_000, note: "" };
    ours.note = foundNote(ours);
    expect(ours.note).toBe("9.1% base, $45.2M deposited");
    await repo.putFoundVenues([ours, { day, poolId: "p2", project: "kamino-lend", symbol: "SOL", asset: "SOL", apyBasePct: 5.64, tvlUsd: 2.5e7, note: "Kamino SOL pool at 5.6% a year." }]);
    const token = await issueSession(U, "M");
    const notes = async (fn: typeof venues, lang?: string) => ((await (await fn(req(token, lang))).json()).found as { poolId?: string; project: string; note: string }[]).map((f) => [f.project, f.note]).sort();
    expect(await notes(venues, "es")).toEqual([["drift", "9,1% base, $45,2M depositados"], ["kamino-lend", "Kamino SOL pool at 5.6% a year."]]);
    expect(await notes(venues)).toEqual([["drift", "9.1% base, $45.2M deposited"], ["kamino-lend", "Kamino SOL pool at 5.6% a year."]]);
    expect(await notes(activity as typeof venues, "es")).toEqual([["drift", "9,1% base, $45,2M depositados"], ["kamino-lend", "Kamino SOL pool at 5.6% a year."]]);
  });
});
