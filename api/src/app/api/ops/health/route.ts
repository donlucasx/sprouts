import { apiError } from "@/lib/api-error";
import { opsTokenOk } from "@/lib/ops/auth";
import { gatherOps } from "@/lib/ops/gather";
import { errorText } from "@/lib/redact";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Phase 0 of the ops dashboard: the snapshot as JSON behind OPS_TOKEN. Any auth failure, including no token configured, is a 404. */
export async function GET(req: Request): Promise<Response> {
  if (!opsTokenOk(req.headers.get("authorization"))) return apiError("not_found", { error: "Not found." }, { status: 404 });
  const fresh = new URL(req.url).searchParams.get("fresh") === "1";
  try {
    const snap = await gatherOps({ fresh });
    return Response.json(snap, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    console.error("ops health failed:", errorText(e));
    return apiError("internal", { error: "Could not build the snapshot." }, { status: 500 });
  }
}
