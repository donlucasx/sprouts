import { Connection, PublicKey } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, unpackAccount, unpackMint, getMetadataPointerState, getTokenGroupMemberState } from "@solana/spl-token";

/** Solana Mobile's Genesis Token group: the same address serves as the metadata pointer target and the group. */
export const GENESIS = "GT22s89nU4iWFkNXj1Bw6uYhJJWDRPpShHt4Bk8f99Te";

export type ParsedAccount = { mint: string; amount: bigint; frozen: boolean; metadataPointer: string | null; group: string | null };

/**
 * The pure check. Empty accounts are dropped (a transferred token leaves an empty account behind); frozen accounts are kept
 * (real Genesis Tokens sit in frozen accounts); both fields must point at the group. Returns the mint, never a boolean.
 */
export function checkGenesisAccounts(accounts: ParsedAccount[]): { mint: string } | null {
  for (const a of accounts) {
    if (a.amount > 0n && a.metadataPointer === GENESIS && a.group === GENESIS) return { mint: a.mint };
  }
  return null;
}

/** Server-side only. Lists the wallet's Token-2022 accounts, reads their mints in batches, and applies the check. */
export async function verifyGenesisHolder(rpcUrl: string, owner: string): Promise<{ mint: string } | null> {
  const conn = new Connection(rpcUrl, "confirmed");
  const { value } = await conn.getTokenAccountsByOwner(new PublicKey(owner), { programId: TOKEN_2022_PROGRAM_ID });
  const held = value.map((v) => unpackAccount(v.pubkey, v.account, TOKEN_2022_PROGRAM_ID)).filter((acc) => acc.amount > 0n);
  const parsed: ParsedAccount[] = [];
  for (let i = 0; i < held.length; i += 100) {
    const chunk = held.slice(i, i + 100);
    const infos = await conn.getMultipleAccountsInfo(chunk.map((a) => a.mint));
    infos.forEach((info, j) => {
      if (!info) return;
      const mint = unpackMint(chunk[j].mint, info, TOKEN_2022_PROGRAM_ID);
      const pointer = getMetadataPointerState(mint);
      const member = getTokenGroupMemberState(mint);
      parsed.push({
        mint: chunk[j].mint.toBase58(),
        amount: chunk[j].amount,
        frozen: chunk[j].isFrozen,
        metadataPointer: pointer?.metadataAddress?.toBase58() ?? null,
        group: member?.group?.toBase58() ?? null,
      });
    });
  }
  return checkGenesisAccounts(parsed);
}
