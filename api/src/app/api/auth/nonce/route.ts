import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { getRepo } from "@/db/repo";
import { createSignInPayload } from "@/lib/siws";
import { rateLimited } from "@/lib/auth-guard";

export const runtime = "nodejs";

const Body = z.object({ address: z.string().min(32).max(44).optional() });

/** Step one of sign-in: a fresh single-use nonce and the payload the wallet will sign. Rate limited per address (review M10). */
export async function POST(request: Request) {
  const ip = request.headers.get("x-forwarded-for") ?? "local";
  if (rateLimited(`nonce:${ip}`, 20)) return NextResponse.json({ error: "Too many requests. Try again in a minute." }, { status: 429 });
  const parsed = Body.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Bad request." }, { status: 400 });
  const nonce = randomBytes(16).toString("hex");
  const payload = createSignInPayload({ address: parsed.data.address, nonce });
  await (await getRepo()).putNonce({ nonce, expiresAt: new Date(payload.expirationTime) });
  return NextResponse.json(payload);
}
