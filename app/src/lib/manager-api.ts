import { api, type MeResponse } from "./api";

/** The one-tap undo (spec 4.5): the session is enough, never a fresh sign-in. 409 "Nothing to undo." surfaces as an ApiError. Answers the rules as they now stand (the shape of me.rules). */
export async function undoSplit(): Promise<MeResponse["rules"]> {
  return api<MeResponse["rules"]>("/api/rules/undo", { method: "POST" });
}
