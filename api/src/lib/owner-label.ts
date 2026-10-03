/**
 * Whose garden a code links into (security R207 #5): the owner's .skr name, or the Seed Vault key cut to its first and last four
 * characters. The /link page shows it and waits for "this is me" BEFORE any wallet is asked, so a code someone else sent cannot
 * quietly route a wallet's round-ups into their garden. Both forms are public on chain already (the .skr record, the key).
 */
export function ownerLabel(user: { seedVaultPubkey: string; skrName: string | null } | null, userPubkey: string): string {
  if (user?.skrName) return user.skrName;
  return `${userPubkey.slice(0, 4)}...${userPubkey.slice(-4)}`;
}
