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

/** Solana Mobile's Saga Genesis Token: a Metaplex NFT in this verified collection, frozen and delegated so it cannot move (R86). */
export const SAGA_COLLECTION = "46pcSL5gmjBrPqGKFaLbbCmR6iVuLJbnQy13hAe7s6CC";

export type SagaAsset = { mint: string; owner: string | null; frozen: boolean; burnt: boolean; collection: string | null };

/** The pure check: an unburnt, frozen token of the collection, owned by the wallet that signed in. Returns the mint, never a boolean. */
export function checkSagaAssets(assets: SagaAsset[], owner: string): { mint: string } | null {
  for (const a of assets) {
    if (!a.burnt && a.frozen && a.owner === owner && a.collection === SAGA_COLLECTION) return { mint: a.mint };
  }
  return null;
}

/** A DAS `searchAssets` result, reduced to the fields the check reads. An unknown shape becomes a non-matching asset, never a throw. */
export function parseSearchAssets(result: unknown): SagaAsset[] {
  const items = (result as { items?: unknown[] } | null)?.items;
  if (!Array.isArray(items)) return [];
  return items.flatMap((it) => {
    const a = it as { id?: unknown; burnt?: unknown; ownership?: { owner?: unknown; frozen?: unknown }; grouping?: { group_key?: unknown; group_value?: unknown }[] } | null;
    if (typeof a?.id !== "string") return [];
    const col = Array.isArray(a.grouping) ? a.grouping.find((g) => g?.group_key === "collection")?.group_value : undefined;
    return [{ mint: a.id, owner: typeof a.ownership?.owner === "string" ? a.ownership.owner : null, frozen: a.ownership?.frozen === true, burnt: a.burnt === true, collection: typeof col === "string" ? col : null }];
  });
}

/** Server-side only. The holder check Solana Mobile documents: DAS `searchAssets` by owner within the verified collection (Helius skips unverified collections). */
export async function verifySagaHolder(rpcUrl: string, owner: string, fetchImpl: typeof fetch = fetch): Promise<{ mint: string } | null> {
  const body = { jsonrpc: "2.0", id: "genesis", method: "searchAssets", params: { ownerAddress: owner, grouping: ["collection", SAGA_COLLECTION], page: 1, limit: 50 } };
  const res = await fetchImpl(rpcUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`searchAssets answered ${res.status}`);
  const json = (await res.json()) as { result?: unknown; error?: { message?: string } };
  if (json.error) throw new Error(`searchAssets: ${json.error.message ?? "error"}`);
  return checkSagaAssets(parseSearchAssets(json.result), owner);
}

export type GenesisKind = "seeker" | "saga";
type GenesisCheck = (rpcUrl: string, owner: string) => Promise<{ mint: string } | null>;

/** The gate: the Seeker token first, the Saga token only when there is none (R86). Either mint is unique per device, so one account per phone holds. */
export async function verifyAnyGenesisHolder(
  rpcUrl: string, owner: string, deps: { seeker: GenesisCheck; saga: GenesisCheck } = { seeker: verifyGenesisHolder, saga: verifySagaHolder },
): Promise<{ mint: string; kind: GenesisKind } | null> {
  const seeker = await deps.seeker(rpcUrl, owner);
  if (seeker) return { mint: seeker.mint, kind: "seeker" };
  const saga = await deps.saga(rpcUrl, owner);
  return saga ? { mint: saga.mint, kind: "saga" } : null;
}
