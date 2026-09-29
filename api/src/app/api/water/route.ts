import { NextResponse } from "next/server";
import { getRepo } from "@/db/repo";
import { requireSession } from "@/lib/auth-guard";

export const runtime = "nodejs";

/** Watering is the reveal (R55): the moment the user opened the buds. Nothing moves on chain. */
export async function POST(request: Request) {
  const session = await requireSession(request);
  if (session instanceof NextResponse) return session;
  const wateredAt = new Date();
  await (await getRepo()).setWateredAt(session.pubkey, wateredAt);
  return NextResponse.json({ wateredAt });
}
