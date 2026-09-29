/** The wallet that appeared since the code was made (`before` = the wallets that were not revoked then), or null while none has. */
export function newlyLinked<W extends { pubkey: string; status: string }>(before: readonly string[], wallets: readonly W[]): W | null {
  return wallets.find((w) => w.status !== "revoked" && !before.includes(w.pubkey)) ?? null;
}
