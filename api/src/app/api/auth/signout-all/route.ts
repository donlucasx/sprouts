import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth-guard";
import { signOutEverywhere } from "@/lib/session";

export const runtime = "nodejs";

/** "Sign out of all devices": every session of this Seeker ends at once (R84). */
export async function POST(request: Request) {
  const session = await requireSession(request);
  if (session instanceof NextResponse) return session;
  await signOutEverywhere(session.pubkey);
  return NextResponse.json({ signedOut: true, everywhere: true });
}
