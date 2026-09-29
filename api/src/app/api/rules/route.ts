import { NextResponse } from "next/server";
import { z } from "zod";
import { getRepo } from "@/db/repo";
import { rulesRowToRules } from "@/db/types";
import { requireSession } from "@/lib/auth-guard";
import { ReauthSchema, verifyReauth } from "@/lib/reauth";

export const runtime = "nodejs";

// The ranges the app's steppers allow; the allocation stays SKR-only until the stORE leg has been sent once [A19].
const Body = z.object({
  roundupOn: z.boolean().optional(),
  roundupToCents: z.literal(100).optional(),
  pctOn: z.boolean().optional(),
  pctBps: z.number().int().min(0).max(500).optional(),
  pctThresholdCents: z.number().int().min(1_000).max(100_000).optional(),
  plantThresholdCents: z.number().int().min(10).max(5_000).optional(),
  plantMaxDays: z.number().int().min(1).max(30).optional(),
  dailyCapCents: z.number().int().min(100).max(2_000).optional(),
  allocation: z.object({ SKR: z.literal(100), stORE: z.literal(0) }).optional(),
  reauth: ReauthSchema.optional(),
}).strict();

/** Saves the user's rules. Raising the daily limit asks the Seeker for a fresh sign-in (R84); everything else is the session's. */
export async function PUT(request: Request) {
  const session = await requireSession(request);
  if (session instanceof NextResponse) return session;
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Bad request." }, { status: 400 });
  const { reauth, ...patch } = parsed.data;
  const repo = await getRepo();
  const current = await repo.getRules(session.pubkey);
  if (patch.dailyCapCents !== undefined && patch.dailyCapCents > current.dailyCapCents) {
    const check = await verifyReauth(repo, session.pubkey, reauth, "Raising your daily limit");
    if (!check.ok) return NextResponse.json({ error: check.error, reauth: true }, { status: 403 });
  }
  const saved = await repo.saveRules(session.pubkey, patch);
  return NextResponse.json(rulesRowToRules(saved));
}
