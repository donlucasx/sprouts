/**
 * 11-26 (Kimi scope 2 B): a signed approval whose blockhash expired before it reached the network can never land; re-posting the same
 * bytes only fails again. On the confirm's 409 `blockhash_expired` the approval is fetched again (a fresh blockhash; the code stays
 * bound to the same wallet and delegation until a confirm succeeds) and the wallet asked ONCE more. A second expiry, or any other
 * error, is thrown: never a loop. The web /link page uses this; the app has its own copy (app/src/lib/confirm-retry.ts).
 */
export const BLOCKHASH_EXPIRED = "blockhash_expired";

export function isBlockhashExpired(e: unknown): boolean {
  return e instanceof Error && (e as { status?: unknown }).status === 409 && (e as { code?: unknown }).code === BLOCKHASH_EXPIRED;
}

export async function signAndConfirmRebuildingOnce<B extends { transaction: string }, R>(a: {
  build: () => Promise<B>;
  sign: (built: B) => Promise<string>;
  confirm: (signed: string) => Promise<R>;
  /** Called before the second build, so the page can say why the wallet asks again. */
  onRebuild?: () => void;
}): Promise<{ built: B; result: R }> {
  let built = await a.build();
  try {
    return { built, result: await a.confirm(await a.sign(built)) };
  } catch (e) {
    if (!isBlockhashExpired(e)) throw e;
  }
  a.onRebuild?.();
  built = await a.build();
  return { built, result: await a.confirm(await a.sign(built)) };
}
