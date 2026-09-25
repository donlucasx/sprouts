import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { getRepo } from "@/db/repo";
import { createSignInPayload } from "@/lib/siws";

export const runtime = "nodejs";

const Body = z.object({ address: z.string().min(32).max(44).optional() });

/** Step one of sign-in: a fresh single-use nonce and the payload the wallet will sign. */
export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Bad request." }, { status: 400 });
  const nonce = randomBytes(16).toString("hex");
  const payload = createSignInPayload({ address: parsed.data.address, nonce });
  await (await getRepo()).putNonce({ nonce, expiresAt: new Date(payload.expirationTime) });
  return NextResponse.json(payload);
}
