import type { Address } from "@solana/kit";
import { ASSOCIATED_TOKEN_PROGRAM_ADDRESS, findAssociatedTokenPda, TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import { findEventAuthorityPda } from "@solana/subscriptions";
import { GUARDIAN_POOL, JLEND_LIQUIDITY_PROGRAM, JLEND_PROGRAM, KLEND_PROGRAM, LEASH_PROGRAM, ORE_STAKE_ACCOUNT, PYTH_RECEIVER, SKR_MINT, SKR_STAKING_PROGRAM, STAKE_CONFIG, STAKE_VAULT, STORE_MINT, SUBSCRIPTIONS_PROGRAM, SYSTEM_PROGRAM, SYSVAR_INSTRUCTIONS, USDC_MINT, WSOL_MINT } from "./constants";
import { JLEND, JLEND_LENDING_ADMIN, JLEND_LIQUIDITY, KLEND, KLEND_LMA, KLEND_MARKET, PYTH_ACCOUNT } from "./venues/addresses";
import { leashConfigPda } from "./leash";
import { COINS, LEND_ASSETS } from "@/domain/coins";

/** Contracts 3.2 (PROVISIONAL(S1)): every static account a planting may touch, so the v0 message carries 1-byte indexes. Server-side only. */
export async function sproutsAltAddresses(puller: Address): Promise<Address[]> {
  const ata = async (owner: Address, mint: Address) => (await findAssociatedTokenPda({ owner, mint, tokenProgram: TOKEN_PROGRAM_ADDRESS }))[0];
  const [eventAuthority] = await findEventAuthorityPda();
  const list: Address[] = [
    LEASH_PROGRAM, await leashConfigPda(), SUBSCRIPTIONS_PROGRAM, eventAuthority, USDC_MINT, WSOL_MINT, TOKEN_PROGRAM_ADDRESS, ASSOCIATED_TOKEN_PROGRAM_ADDRESS, SYSTEM_PROGRAM, SYSVAR_INSTRUCTIONS,
    await ata(puller, USDC_MINT), await ata(puller, WSOL_MINT), await ata(puller, SKR_MINT), PYTH_ACCOUNT.SOL, PYTH_ACCOUNT.ORE, PYTH_RECEIVER,
    KLEND_PROGRAM, KLEND_MARKET, KLEND_LMA, JLEND_PROGRAM, JLEND_LIQUIDITY_PROGRAM, JLEND_LENDING_ADMIN, JLEND_LIQUIDITY,
    COINS.hSOL.pool as Address, COINS.hSOL.mint, COINS.cbBTC.mint, STAKE_CONFIG, GUARDIAN_POOL, STAKE_VAULT, SKR_STAKING_PROGRAM, SKR_MINT, ORE_STAKE_ACCOUNT, STORE_MINT,
  ];
  for (const a of LEND_ASSETS) {
    const k = KLEND[a];
    const j = JLEND[a];
    list.push(k.reserve, k.supplyVault, k.collateralMint, k.scopePrices, j.lending, j.fTokenMint, j.supplyTokenReservesLiquidity, j.lendingSupplyPositionOnLiquidity, j.rateModel, j.vault, j.rewardsRateModel);
  }
  return [...new Set(list)];
}
