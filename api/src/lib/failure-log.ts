import { getRepo } from "@/db/repo";
import { errorText } from "./redact";

/**
 * 10-31 (his "add logging for failed sign-ins and links"): the 10-30 sweep found Seeker owners holding USDC who never linked, and a
 * reviewer who never signed in, and nothing on the server said why. Each sign-in and link route is wrapped here: a failed answer or a
 * throw is written as an event, so a drop-off can be read afterwards (spikes/activity-events.ts). The response is never changed, and
 * a failed write never fails the request.
 *
 * Not recorded: a malformed body (400 "Bad request.", a client bug or a bot) and a rate-limit 429 (written per request, a loop would
 * fill the table). `userPubkey` is set only when the request is tied to someone real (a verified signature, a live link code): only
 * those rows reach the founder's webhook (founder-alert.ts), so an anonymous caller cannot flood it.
 */
export type FailureWho = { userPubkey: string | null; walletPubkey: string | null };
type Kind = "signin_failed" | "link_failed";
type WhoFn<A extends unknown[]> = (req: Request, failure: { status: number; error: string }, ...rest: A) => Promise<FailureWho>;

/** A base58 Solana address as typed (32 to 44 characters): anything else is not stored. */
export const addressOrNull = (v: unknown): string | null => (typeof v === "string" && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(v) ? v : null);

export function withFailureLog<A extends unknown[]>(kind: Kind, step: string, who: WhoFn<A>, handler: (req: Request, ...rest: A) => Promise<Response>) {
  return async (req: Request, ...rest: A): Promise<Response> => {
    const copy = req.clone();
    let res: Response;
    try {
      res = await handler(req, ...rest);
    } catch (e) {
      await recordFailure(kind, step, { status: 500, error: errorText(e) }, () => who(copy, { status: 500, error: errorText(e) }, ...rest));
      throw e;
    }
    if (res.status >= 400 && res.status !== 429) {
      const error = String(((await res.clone().json().catch(() => ({}))) as { error?: unknown }).error ?? "");
      if (!(res.status === 400 && error === "Bad request.")) await recordFailure(kind, step, { status: res.status, error }, () => who(copy, { status: res.status, error }, ...rest));
    }
    return res;
  };
}

/** Writes one failure event; never throws (the request's own answer stands). */
export async function recordFailure(kind: Kind, step: string, f: { status: number; error: string; from?: string; reason?: string }, who: () => Promise<FailureWho>): Promise<void> {
  try {
    const w = await who();
    await (await getRepo()).addEvent({ kind, userPubkey: w.userPubkey, walletPubkey: w.walletPubkey, detail: { step, status: f.status, error: f.error.slice(0, 200), ...(f.from ? { from: f.from } : {}), ...(f.reason ? { reason: f.reason } : {}) } });
  } catch (e) {
    console.error(`${kind} not recorded: ${e instanceof Error ? e.name : "error"}`);
  }
}

/** The live link code's owner (null for an unknown, expired or used code: an anonymous caller stays anonymous). */
export async function linkOwner(code: unknown): Promise<string | null> {
  if (typeof code !== "string" || code.length !== 6) return null;
  return (await (await getRepo()).peekLinkCode(code.toUpperCase()))?.userPubkey ?? null;
}
