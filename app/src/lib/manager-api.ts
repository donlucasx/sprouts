import { api } from "./api";

/** The one-tap undo (spec 4.5): the session is enough, never a fresh sign-in. 409 "Nothing to undo." surfaces as an ApiError. */
export async function undoSplit(): Promise<void> {
  await api("/api/rules/undo", { method: "POST" });
}
