const SKR_DECIMALS = 6;
const ONE_SKR = 1_000_000n;

/** Typed SKR ("1.5" or "1,5") to raw units, or null when it is not a number; digits past the sixth decimal are dropped. */
export function parseSkr(text: string): bigint | null {
  const t = text.trim().replace(",", ".");
  if (!/^\d*\.?\d*$/.test(t) || t === "" || t === ".") return null;
  const [whole, frac = ""] = t.split(".");
  return BigInt(whole || "0") * ONE_SKR + BigInt((frac + "000000").slice(0, SKR_DECIMALS));
}

/** Why Continue is off for a typed amount, in the server's own words (planPick), or null when it is fine. */
export function amountProblem(text: string, heldRaw: bigint): string | null {
  const raw = parseSkr(text);
  if (raw === null) return "Enter an amount in SKR.";
  if (raw < ONE_SKR) return "The smallest withdrawal is 1 SKR.";
  if (raw > heldRaw) return "That is more than your garden holds.";
  return null;
}

/** Everything the garden holds, as the field shows it (Max). */
export function maxAmountText(heldRaw: bigint): string {
  const whole = heldRaw / ONE_SKR;
  const frac = (heldRaw % ONE_SKR).toString().padStart(SKR_DECIMALS, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : `${whole}`;
}

/** The rules a draft changes, and whether it raises the daily limit (one fresh sign-in for the whole save, R84). */
export function rulesChanges<R extends { dailyCapCents: number }>(saved: R, draft: Partial<R>): { patch: Partial<R>; raises: boolean } {
  const patch: Partial<R> = {};
  // The allocation is an object (R92): compared by value, so a fence moved and moved back is not a change.
  const same = (a: unknown, b: unknown) => (typeof a === "object" && a !== null ? JSON.stringify(a) === JSON.stringify(b) : a === b);
  for (const k of Object.keys(draft) as (keyof R)[]) if (draft[k] !== undefined && !same(draft[k], saved[k])) patch[k] = draft[k];
  return { patch, raises: patch.dailyCapCents !== undefined && patch.dailyCapCents > saved.dailyCapCents };
}
