import { address, type Address } from "@solana/kit";
import { fetchToken, findAssociatedTokenPda, TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import { rpc } from "./rpc";
import { STORE_MINT } from "./constants";

/** The stORE program's vault token account (its ORE stake), read by the fruit audit on 2026-09-28; `spikes/store-rate.ts` re-checks it. */
const STORE_VAULT = address("GexGotZVLZdJ7N7w3BgHpKYmPs915pwZoZAqZVkCS8F7");

/** The Seed Vault's stORE balance (raw, 9 decimals), 0 when the account does not exist. */
export async function storeBalanceRaw(owner: Address): Promise<bigint> {
  const [ata] = await findAssociatedTokenPda({ owner, mint: STORE_MINT, tokenProgram: TOKEN_PROGRAM_ADDRESS });
  try {
    return (await fetchToken(rpc(), ata)).data.amount;
  } catch {
    return 0n;
  }
}

/** ORE per stORE at 1e9 scale, from the stORE program's own vault (vault stake over supply), never a market price (RECONCILED rule 12). */
export async function storeRedeemRate(): Promise<bigint> {
  const supply = BigInt((await rpc().getTokenSupply(STORE_MINT).send()).value.amount);
  if (supply === 0n) return 1_000_000_000n;
  const vaultStake = await rpc().getTokenAccountBalance(STORE_VAULT).send();
  return (BigInt(vaultStake.value.amount) * 1_000_000_000n) / supply;
}
