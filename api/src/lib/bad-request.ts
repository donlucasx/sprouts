import { NextResponse } from "next/server";
import type { z } from "zod";

/**
 * The field a body failed on, in the API's own sentence (the app shows it as is; the audit's note): the zod detail goes to the log
 * only. A key name is the client's own text: capped and stripped of control characters before it reaches the log or the answer.
 */
export function badRequest(where: string, error: z.ZodError): NextResponse {
  const issue = error.issues[0];
  const raw = issue === undefined ? undefined : issue.code === "unrecognized_keys" ? issue.keys[0] : issue.path[0];
  const field = raw === undefined ? undefined : String(raw).replace(/\p{C}/gu, "").slice(0, 32);
  console.error(`${where}: bad request${field === undefined ? "" : ` at ${field}`}: ${issue?.message ?? "no body"}`);
  return NextResponse.json({ error: field === undefined ? "Bad request." : `Bad request: ${field}.` }, { status: 400 });
}
