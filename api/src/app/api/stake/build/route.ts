import { langOf } from "@/lib/i18n";
import { apiError } from "@/lib/api-error";
import { NextResponse } from "next/server";
import { z } from "zod";
import { address } from "@solana/kit";
import { rateLimited, requireSession } from "@/lib/auth-guard";
import { withAppErrorLog } from "@/lib/failure-log";
import { getRepo } from "@/db/repo";
import { buildPlantSkr, PLANT_COPY, PlantRefused, stakePlantOff, STAKE_BUILD_LIMIT, STAKE_BUILD_WINDOW_MS } from "@/lib/plant-skr";

export const runtime = "nodejs";

// Not .strict(): an unknown key from a newer app is dropped, never refused (as topup/build).
const Body = z.object({ amountRaw: z.string().regex(/^\d{1,20}$/) });

/**
 * 0.1.13 Plant my SKR: the unsigned stake of `amountRaw` of the signed-in Seed Vault wallet's own SKR into its garden position (lib/
 * plant-skr.ts buildPlantSkr). Answers { transaction, amountRaw } or { error } with a sentence the app shows as it is. 503 while
 * STAKE_PLANT_OFF=1 (Kimi #3); 429 past STAKE_BUILD_LIMIT a minute for this session's wallet (Kimi #7: each build reads the chain
 * fresh and simulates). Moves and records nothing: the user signs, POST /api/stake/confirm sends.
 */
async function postHandler(request: Request) {
  const lang = langOf(request);
  if (stakePlantOff()) return apiError("plant_off", { error: PLANT_COPY.off }, { status: 503 }, lang);
  const session = await requireSession(request);
  if (session instanceof NextResponse) return session;
  if (rateLimited(`stake-build:${session.pubkey}`, STAKE_BUILD_LIMIT, STAKE_BUILD_WINDOW_MS)) return apiError("rate_limited", { error: PLANT_COPY.busy }, { status: 429 }, lang);
  const parsed = Body.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return apiError("plant_bad_amount", { error: PLANT_COPY.badAmount }, { status: 400 }, lang);
  const user = await (await getRepo()).getUser(session.pubkey);
  if (!user) return apiError("sign_in_first", { error: "Sign in first." }, { status: 401 }, lang);
  try {
    return NextResponse.json(await buildPlantSkr(address(user.seedVaultPubkey), BigInt(parsed.data.amountRaw)));
  } catch (e) {
    if (e instanceof PlantRefused) return apiError("plant_refused", { error: e.message }, { status: e.status }, lang);
    console.error(`/api/stake/build: ${e instanceof Error ? e.message : String(e)}`);
    return apiError("plant_not_now", { error: PLANT_COPY.notNow }, { status: 503 }, lang);
  }
}
export const POST = withAppErrorLog("stake/build", postHandler);
