import { address, type Address } from "@solana/kit";
import type { LendAsset } from "@/domain/coins";
import type { AutoVenue } from "@/domain/venues";

/** Contracts 1.4: every venue address read on mainnet 2026-10-04 15:20-15:45 PDT. The app pins its own copy (sign.ts) and never takes one from the API. */
export const KLEND_MARKET = address("7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF");
export const KLEND_LMA = address("9DrvZvyWh1HuAoZxvYWMvkf2XCzryCpGgHqrMjyDWpmo");
const SCOPE = address("3t4JZcueEzTbVP6kLxXrL3VpWx45jDer4eqysweBchNH");
export const KLEND: Record<LendAsset, { reserve: Address; liquidityMint: Address; supplyVault: Address; collateralMint: Address; scopePrices: Address }> = {
  USDC_LEND: { reserve: address("D6q6wuQSrifJKZYpR1M8R4YawnLDtDsMmWM1NbBmgJ59"), liquidityMint: address("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"), supplyVault: address("Bgq7trRgVMeq33yt235zM2onQ4bRDBsY5EWiTetF4qw6"), collateralMint: address("B8V6WVjPxW1UGwVDfxH2d2r8SyT4cqn7dQRK6XneVa7D"), scopePrices: SCOPE },
  SOL_LEND: { reserve: address("d4A2prbA2whesmvHaL88BH6Ewn5N4bTSU2Ze8P6Bc4Q"), liquidityMint: address("So11111111111111111111111111111111111111112"), supplyVault: address("GafNuUXj9rxGLn4y79dPu6MHSuPWeJR6UtTWuexpGh3U"), collateralMint: address("2UywZrUdyqs5vDchy7fKQJKau2RVyuzBev2XKGPDSiX1"), scopePrices: SCOPE },
};
/** Mutation fixture only: the 8.62%-on-$104 USDC reserve a naive "best reserve" read would pick (Claude audit F2). */
export const KLEND_JUNK_USDC_RESERVE = { reserve: address("AWnKJ9dsiHcoDCThxE5E93ikDTAXkApoNwrKM2tp9KFJ"), collateralMint: address("8EFj1QBADsCs2D1DNWWTHjsoWmEPW8FGFgKdsAeqoQJi") };

export const JLEND_LENDING_ADMIN = address("5nmGjA4s7ATzpBQXC5RNceRpaJ7pYw2wKsNBWyuSAZV6");
export const JLEND_LIQUIDITY = address("7s1da8DduuBFqGra5bJBjpnvL5E9mGzCuMk1Qkh4or2Z");
export type JlendAccounts = { lending: Address; fTokenMint: Address; mint: Address; supplyTokenReservesLiquidity: Address; lendingSupplyPositionOnLiquidity: Address; rateModel: Address; vault: Address; rewardsRateModel: Address; claimAccount: Address };
export const JLEND: Record<LendAsset, JlendAccounts> = {
  USDC_LEND: { lending: address("2vVYHYM8VYnvZqQWpTJSj8o8DBf1wM8pVs3bsTgYZiqJ"), fTokenMint: address("9BEcn9aPEmhSPbPQeFGjidRiEKki46fVQDyPpSQXPA2D"), mint: address("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"), supplyTokenReservesLiquidity: address("94vK29npVbyRHXH63rRcTiSr26SFhrQTzbpNJuhQEDu"), lendingSupplyPositionOnLiquidity: address("Hf9gtkM4dpVBahVSzEXSVCAPpKzBsBcns3s8As3z77oF"), rateModel: address("5pjzT5dFTsXcwixoab1QDLvZQvpYJxJeBphkyfHGn688"), vault: address("BmkUoKMFYBxNSzWXyUjyMJjMAaVz4d8ZnxwwmhDCUXFB"), rewardsRateModel: address("5xSPBiD3TibamAnwHDhZABdB4z4F9dcj5PnbteroBTTd"), claimAccount: address("HN1r4VfkDn53xQQfeGDYrNuDKFdemAhZsHYRwBrFhsW") },
  SOL_LEND: { lending: address("BeAqbxfrcXmzEYT2Ra62oW2MqkuFDHaCtps47Mzg6Zj3"), fTokenMint: address("2uQsyo1fXXQkDtcpXnLofWy88PxcvnfH2L8FPSE62FVU"), mint: address("So11111111111111111111111111111111111111112"), supplyTokenReservesLiquidity: address("4Y66HtUEqbbbpZdENGtFdVhUMS3tnagffn3M4do59Nfy"), lendingSupplyPositionOnLiquidity: address("4SkEYxmiRgQ4VYyvh9VB4k39M49BpqazyzDUFDzJhXQm"), rateModel: address("Acvyi9HBGmqh3Exe1N4PjBVyY8fokq2AdC6fSLqV6KSo"), vault: address("5JP5zgYCb9W37QQLgAHRHuinFLrKt87akDY1CgZoTPzr"), rewardsRateModel: address("CkeQGDRsgMZcCaU8cZEdC2aFAohia4jLzL36RaLcUDsR"), claimAccount: address("6AQGR8zK4KTVZfZ9UZaRzyEL5ynvwVaF5ywVdmtJT24N") },
};

/** The receipt each auto venue leaves in the user's wallet: kTokens have 6 decimals even for SOL (raw-per-raw rate math). */
export const RECEIPT: Record<LendAsset, Record<AutoVenue, { mint: Address; decimals: number }>> = {
  USDC_LEND: { kamino_klend: { mint: KLEND.USDC_LEND.collateralMint, decimals: 6 }, jupiter_lend: { mint: JLEND.USDC_LEND.fTokenMint, decimals: 6 } },
  SOL_LEND: { kamino_klend: { mint: KLEND.SOL_LEND.collateralMint, decimals: 6 }, jupiter_lend: { mint: JLEND.SOL_LEND.fTokenMint, decimals: 9 } },
};

export const PYTH_ACCOUNT = {
  SOL: address("7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE"),
  CBBTC: address("7oqYpv5YbjJ2PEsNeVVB5ZEZ8ZE6ufkj8hAvAiaiftbe"),
  ORE: address("GYYQ8gbX4Tndc4WMJ9jSjZTePTvbmgRRxByt54ZQYqvZ"),
} as const;
export const PYTH_FEED = {
  SOL: "ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d",
  CBBTC: "2817d7bfe5c64b8ea956e9a26f573ef64e72e4d7891f2d6af9bcc93f7aff9a97",
  ORE: "142b804c658e14ff60886783e46e5a51bdf398b4871d9d8f7c28aa1585cad504",
  SKR: "38846ec4d0dbe808091817f5c0d6ab8058e25422348ddf97db52b6c378a93bf9",
} as const;

/** Table-only venues (compared daily, never routed to). */
export const SM_VAULT = address("3SMNuqK7m13KorY9gX8DzjQAVXGbhgRVni65Pk6LTBgC");
export const MARGINFI_USDC_BANK = address("2s37akK2eyBbp8DZgCm7RtsaEz8eJP3Nxd4urLHQv7yB");
