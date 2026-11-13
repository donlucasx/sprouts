import { clientIp, rateLimited, rateExhausted } from "@/lib/auth-guard";
import { OPS_COOKIE, OPS_COOKIE_MAX_AGE_S, opsPasswordOk, signOpsCookie } from "@/lib/ops/auth";
import { config } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ATTRS = "HttpOnly; Secure; SameSite=Strict; Path=/";

/** Password login for the /ops page. Unset password or secret is a 404 (never open, never a 500); 5 WRONG tries an hour per address. */
export async function POST(req: Request): Promise<Response> {
  const c = config();
  if (!c.opsPassword || !c.opsSecret) return Response.json({ error: "Not found." }, { status: 404 });
  // Before the rate limit: a cross-site text/plain form post must not burn the 5-an-hour budget.
  if (!(req.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) return Response.json({ error: "Bad request." }, { status: 400 });
  // Kimi L6: only FAILED tries spend the budget; a right password is never throttled unless 5 wrong ones already used it up.
  // The body is read FIRST; the check and the spend below have no await between them, so parallel attempts cannot all pass the check.
  const bucket = `ops-login:${clientIp(req)}`;
  let password = "";
  let bad = false;
  try {
    const body = (await req.json()) as { password?: unknown };
    if (typeof body?.password === "string") password = body.password;
  } catch {
    bad = true;
  }
  if (rateExhausted(bucket, 5, 3_600_000)) return Response.json({ error: "Too many tries. Wait an hour." }, { status: 429 });
  if (bad) {
    rateLimited(bucket, 5, 3_600_000);   // an unparseable body is a failed try too
    return Response.json({ error: "Bad request." }, { status: 400 });
  }
  if (!opsPasswordOk(password)) {
    rateLimited(bucket, 5, 3_600_000);   // spends one try
    return Response.json({ error: "Wrong password." }, { status: 401 });
  }
  const value = signOpsCookie(Date.now() + OPS_COOKIE_MAX_AGE_S * 1000);
  return new Response(null, { status: 204, headers: { "Set-Cookie": `${OPS_COOKIE}=${value}; ${ATTRS}; Max-Age=${OPS_COOKIE_MAX_AGE_S}`, "Cache-Control": "no-store" } });
}

/** Log out: expire the cookie. */
export async function DELETE(): Promise<Response> {
  return new Response(null, { status: 204, headers: { "Set-Cookie": `${OPS_COOKIE}=; ${ATTRS}; Max-Age=0`, "Cache-Control": "no-store" } });
}
