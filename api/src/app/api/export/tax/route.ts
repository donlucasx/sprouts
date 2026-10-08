import { NextResponse } from "next/server";
import { getRepo } from "@/db/repo";
import { dayOf } from "@/domain/day";
import { requireSession } from "@/lib/auth-guard";
import { plantingRows, withdrawalRows, lendWithdrawalRows, selectRows, toCsv, type TaxRow } from "@/lib/tax-export";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Supabase's API returns at most 1,000 rows per read. A list that comes back this long may be cut short, and a cut-short tax record
 * is worse than none, so the export refuses rather than answer with part of the history.
 */
const MAX_ROWS = 1000;

/**
 * R447: the signed-in Seeker's Sprouts events as one CSV in Koinly's Universal import format (see lib/tax-export.ts), oldest first;
 * `?year=YYYY` keeps one UTC calendar year. It is a record to import into a tax tool, not tax advice and not a tax form: the tool
 * computes gains and produces Form 8949 and Schedule D. Rows: one trade per leg of each confirmed planting (coin legs and lending
 * deposits), each delivered SKR withdrawal (a reward deposit for the SKR earned, then the withdrawal), each lending withdrawal.
 */
export async function GET(request: Request) {
  const session = await requireSession(request);
  if (session instanceof NextResponse) return session;
  const yearParam = new URL(request.url).searchParams.get("year");
  if (yearParam !== null && !/^\d{4}$/.test(yearParam)) return NextResponse.json({ error: "year must be four digits, like 2026." }, { status: 400 });
  const year = yearParam === null ? null : Number(yearParam);

  const repo = await getRepo();
  const [plantings, withdrawals, lendEvents] = await Promise.all([
    repo.listConfirmedPlantings(session.pubkey),
    repo.listWithdrawals(session.pubkey, MAX_ROWS),
    repo.listEvents(session.pubkey, ["lend_withdrawn"], MAX_ROWS),
  ]);
  if (plantings.length >= MAX_ROWS || withdrawals.length >= MAX_ROWS || lendEvents.length >= MAX_ROWS) {
    return NextResponse.json({ error: "Your history is too long for one export yet. Contact support for the full file." }, { status: 503 });
  }
  const legs = await Promise.all(plantings.map((p) => repo.plantingLegs(p.id)));

  // The stored SKR price of each withdrawal's day, for the earned SKR's worth; none stored leaves the worth blank.
  const days = [...new Set(withdrawals.map((w) => dayOf(w.unstakeTs)))];
  const skrPrice = new Map<string, number | null>();
  await Promise.all(days.map(async (d) => skrPrice.set(d, (await repo.getCoinDay(d, "SKR"))?.priceUsd ?? null)));

  const rows: TaxRow[] = [
    ...plantings.flatMap((p, i) => plantingRows(p, legs[i])),
    ...withdrawals.flatMap((w) => withdrawalRows(w, skrPrice.get(dayOf(w.unstakeTs)) ?? null)),
    ...lendEvents.flatMap((e) => lendWithdrawalRows(e)),
  ];
  const csv = toCsv(selectRows(rows, year));
  const filename = `sprouts-tax-${year ?? "all"}-${dayOf(new Date())}.csv`;
  return new Response(csv, {
    status: 200,
    headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${filename}"`, "cache-control": "no-store" },
  });
}
