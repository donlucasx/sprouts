import { NextResponse } from "next/server";
import { z } from "zod";
import { getRepo } from "@/db/repo";
import { rulesRowToRules, type RulesRow } from "@/db/types";
import { requireSession } from "@/lib/auth-guard";
import { badRequest } from "@/lib/bad-request";
import { ReauthSchema, verifyReauth } from "@/lib/reauth";
import { isAsset, sameSplit, type Asset } from "@/domain/coins";
import type { Pins } from "@/domain/roundup";
import { validatePins, floorFor, effectiveSplit, STOP_DEFAULTS, STOP_LABEL, PIN_MAX } from "@/domain/split";
import { dayOf } from "@/domain/day";

export const runtime = "nodejs";

// The ranges the app's steppers allow. The daily limit stops at the on-chain cap (queue item 13). The split itself is never set
// directly: the Yield Manager's switch, stop and pins are, and the split follows (spec 3.1, 4.3).
const Body = z.object({
  roundupOn: z.boolean().optional(),
  roundupToCents: z.literal(100).optional(),
  pctOn: z.boolean().optional(),
  pctBps: z.number().int().min(0).max(500).optional(),
  pctThresholdCents: z.number().int().min(1_000).max(100_000).optional(),
  plantThresholdCents: z.number().int().min(10).max(5_000).optional(),
  plantMaxDays: z.number().int().min(1).max(30).optional(),
  dailyCapCents: z.number().int().min(100).max(500).optional(),
  managed: z.boolean().optional(),
  stop: z.enum(["careful", "balanced", "bold"]).optional(),
  pins: z.record(z.string(), z.number().int()).optional(),
  reauth: ReauthSchema.optional(),
}).strict();

const PIN_COPY = (floor: number, stop: string) => ({
  sum: `Pins add up to more than the split allows. SKR keeps at least ${floor}%.`,
  skr_floor: `SKR keeps at least ${floor}% on ${stop}.`,
  range: `Pins go up to ${PIN_MAX.stORE} for stORE and ${PIN_MAX.hSOL} for the other coins.`,
});

/** Saves the user's rules. Raising the daily limit asks the Seeker for a fresh sign-in (R84); everything else is the session's. */
export async function PUT(request: Request) {
  const session = await requireSession(request);
  if (session instanceof NextResponse) return session;
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return badRequest("rules", parsed.error);
  const { reauth, managed, stop, pins: rawPins, ...rest } = parsed.data;
  const repo = await getRepo();
  const current = await repo.getRules(session.pubkey);
  if (rest.dailyCapCents !== undefined && rest.dailyCapCents > current.dailyCapCents) {
    const check = await verifyReauth(repo, session.pubkey, reauth, "Raising your daily limit");
    if (!check.ok) return NextResponse.json({ error: check.error, reauth: true }, { status: 403 });
  }
  // Any save clears the undo (spec 4.5): once you have changed something yourself there is nothing to undo.
  const patch: Partial<Omit<RulesRow, "userPubkey" | "updatedAt">> = { ...rest, prevAllocation: null, allocationDay: null };

  if (managed !== undefined || stop !== undefined || rawPins !== undefined) {
    let pins: Pins = { ...current.pins };
    let pinsByUndo = current.pinsByUndo;
    if (rawPins !== undefined) {
      pins = {};
      for (const [k, v] of Object.entries(rawPins)) {
        if (!isAsset(k)) return NextResponse.json({ error: "Bad request: pins." }, { status: 400 });
        if (v !== 0) pins[k as Asset] = v; // a 0 pin is no pin: the app drops zeros on its side and the API does the same (the audit's P5 note)
      }
      pinsByUndo = false; // pins you send are yours
    }
    const nextManaged = managed ?? current.managed;
    const nextStop = stop ?? current.stop;
    if (nextManaged && !current.managed && pinsByUndo) {
      // R137: the pins an undo made held the manager's old split still; turning it back on frees it. Pins set by hand stay.
      pins = {};
      pinsByUndo = false;
    }
    if (!nextManaged) delete pins.SKR; // spec 4.2: off, SKR is always the rest, so an SKR pin from the manager's time is dropped
    const floor = floorFor(nextManaged, nextStop);
    const problem = validatePins(pins, floor);
    if (problem) return NextResponse.json({ error: PIN_COPY(floor, STOP_LABEL[nextStop])[problem] }, { status: 400 });
    const stopSplit = nextManaged ? ((await repo.latestSplitDay(nextStop))?.split ?? STOP_DEFAULTS[nextStop]) : STOP_DEFAULTS[nextStop];
    const allocation = effectiveSplit({ managed: nextManaged, stop: nextStop, pins, stopSplit });
    Object.assign(patch, { managed: nextManaged, stop: nextStop, pins, pinsByUndo, allocation });
  }
  const saved = await repo.saveRules(session.pubkey, patch);
  // The event follows the save, so a failed save never leaves a change in Activity that did not happen.
  if (patch.allocation && (!sameSplit(patch.allocation, current.allocation) || patch.managed !== current.managed || patch.stop !== current.stop)) {
    await repo.addEvent({ userPubkey: session.pubkey, walletPubkey: null, kind: "split_changed", detail: { by: "you", from: current.allocation, to: patch.allocation, stop: patch.stop, managed: patch.managed, managedWas: current.managed, day: dayOf(new Date()) } });
  }
  return NextResponse.json(rulesRowToRules(saved));
}
