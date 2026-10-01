import { address, type Address } from "@solana/kit";
import { fetchToken, findAssociatedTokenPda, TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import { rpc } from "./rpc";
import { STORE_MINT } from "./constants";

/**
 * Where the stORE vault's ORE actually sits (confirmed on chain 2026-09-30): an ore-stake account owned by ORE's staking program,
 * whose authority (byte 8) is the ore-lst PDA GexGotZV... that the first reader mistook for a token account. The balance is a
 * u64 at byte 40. Hardcoded: whether the address is a derivable PDA is unverified, and a wrong derivation would read nothing.
 */
const ORE_STAKE_ACCOUNT = address("4apcWHDc5RF2mpu4MDj6aRQ91aH5rZqbmJviBc75jwi8");
const ORE_STAKING_PROGRAM = "stakecNP3FpiExZPCgZfqRgumVzi6dNqnfrjwXyTgeH";
const BALANCE_OFFSET = 40;

/** The Seed Vault's stORE balance (raw; the mint has 11 decimals), 0 when the account does not exist. */
export async function storeBalanceRaw(owner: Address): Promise<bigint> {
  const [ata] = await findAssociatedTokenPda({ owner, mint: STORE_MINT, tokenProgram: TOKEN_PROGRAM_ADDRESS });
  try {
    return (await fetchToken(rpc(), ata)).data.amount;
  } catch {
    return 0n;
  }
}

export function parseOreStakeBalance(data: Uint8Array): bigint {
  if (data.length < BALANCE_OFFSET + 8) throw new Error(`ORE stake account too short: ${data.length} bytes`);
  return Buffer.from(data).readBigUInt64LE(BALANCE_OFFSET);
}

/** ORE per stORE at 1e9 scale: the vault's staked ORE over the stORE supply, never a market price (the ORE plan's rule 12). */
export async function storeRedeemRate(): Promise<bigint> {
  const supply = BigInt((await rpc().getTokenSupply(STORE_MINT).send()).value.amount);
  if (supply === 0n) return 1_000_000_000n;
  const info = await rpc().getAccountInfo(ORE_STAKE_ACCOUNT, { encoding: "base64" }).send();
  if (!info.value) throw new Error("ORE stake account missing");
  if (info.value.owner !== ORE_STAKING_PROGRAM) throw new Error(`ORE stake account owner is ${info.value.owner}, not ORE's staking program`);
  const balance = parseOreStakeBalance(Buffer.from(info.value.data[0], "base64"));
  return (balance * 1_000_000_000n) / supply;
}
