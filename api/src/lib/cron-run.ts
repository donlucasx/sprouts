import { timingSafeEqual } from "node:crypto";
import { address } from "@solana/kit";
import { config } from "./config";
import { rpc } from "./rpc";
import type { Chain } from "./plant-run";
import { readDelegation, usdcAta } from "./subscriptions";
import { buildPlantingTx, simulatePlanting, sendPlanting, signatureStatus, pullerSkrChangeRaw, pullerTokenChangeRaw, cleanupPlanting, type BuiltPlanting } from "./planting";
import { readLeashConfig, priceSourceFor, type LeashLegByte } from "./leash";
import { readPosition, sharePrice } from "./staking";
import { assetBalanceRaw, receiptBalanceRaw, readLendingPositions } from "./holdings";
import type { LendAsset } from "@/domain/coins";
import { USDC_MINT, WSOL_MINT } from "./constants";

/**
 * Shared by the two cron routes (moved verbatim from api/cron/plant/route.ts, 10-22; a Next route file may export only its handlers):
 * the daily run (/api/cron/plant) and the first-planting run (/api/cron/first-planting).
 */
export function cronAuthorized(header: string | null): boolean {
  const expected = Buffer.from(`Bearer ${config().cronSecret}`);
  const given = Buffer.from(header ?? "");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** The real chain behind the run: delegation reads, balances, and the planting builder from the libraries. */
export function realPlantingChain(): Chain {
  return {
    readDelegation: (pda) => readDelegation(address(pda)),
    usdcBalanceRaw: async (owner) => {
      // A missing token account is "no USDC"; anything else (an RPC outage) throws, so the wallet is skipped, not paused (review I8).
      const ata = await usdcAta(address(owner));
      const info = await rpc().getAccountInfo(ata, { encoding: "base64" }).send();
      if (!info.value) return 0n;
      const { value } = await rpc().getTokenAccountBalance(ata).send();
      return BigInt(value.amount);
    },
    buildPlantingTx: (a) => buildPlantingTx({ ...a, delegator: address(a.delegator), user: address(a.user), delegationPda: address(a.delegationPda) }),
    simulatePlanting: (b) => simulatePlanting(b as BuiltPlanting),
    sendPlanting: (b) => sendPlanting(b as BuiltPlanting),
    signatureStatus,
    readShares: async (u) => (await readPosition(address(u))).shares,
    sharePrice,
    assetBalanceRaw: (owner, asset, venue) => (venue ? receiptBalanceRaw(address(owner), asset as LendAsset, venue) : assetBalanceRaw(address(owner), asset)),
    pullerSkrChangeRaw: (sig) => pullerSkrChangeRaw(sig),
    readLeashConfig: () => readLeashConfig().catch(() => null),
    lendingPositions: (u) => readLendingPositions(address(u)),
    pullerCarryChangeRaw: (sig, kind) => pullerTokenChangeRaw(sig, kind === "WSOL" ? WSOL_MINT : USDC_MINT),
    cleanup: (b) => cleanupPlanting(b as BuiltPlanting),
    // T8 carry: the run's one wait per feed (waitS 60) and the checks with no wait (before a build, before a send); leg 0 answers
    // "post" with PYTH_API_KEY (its posted price is judged in the build and again before the send), else throws (R324).
    priceFresh: async (leg, cfg, waitS) => { await priceSourceFor(leg as LeashLegByte, undefined, waitS, cfg); },
  };
}

