import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth-guard";
import { signOut } from "@/lib/session";

export const runtime = "nodejs";

/** "Sign out": this device's session ends at once (R84). */
export async function POST(request: Request) {
  const session = await requireSession(request);
  if (session instanceof NextResponse) return session;
  await signOut(session.tokenHash);
  return NextResponse.json({ signedOut: true });
}
