import { NextResponse } from "next/server";
import { address } from "@solana/kit";
import { getRepo } from "@/db/repo";
import { rulesRowToRules } from "@/db/types";
import { requireSession } from "@/lib/auth-guard";
import { readPosition, sharePrice } from "@/lib/staking";
import { priceUsd } from "@/lib/jupiter";
import { storeBalanceRaw, storeRedeemRate } from "@/lib/store";
import { readDelegation } from "@/lib/subscriptions";
import { readHoldings, latestCoinDays, holdingsFrom } from "@/lib/holdings";
import { pickAsset } from "@/domain/allocation";
import { potInputs, potFromInputs } from "@/lib/pot";
import { capLeftCents } from "@/domain/cap";
import { SKR_MINT, STORE_MINT } from "@/lib/constants";
import { STOP_DEFAULTS } from "@/domain/split";
import { dayOf } from "@/domain/day";

export const runtime = "nodejs";

const COOLDOWN_MS = 172_800_000;
const str = (v: unknown) => JSON.parse(JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x)));

/** Everything Home needs, computed in one place from the chain and the ledger. The app never computes money from chain reads itself. */
export async function GET(request: Request) {
  const session = await requireSession(request);
  if (session instanceof NextResponse) return session;
  const repo = await getRepo();
  const user = await repo.getUser(session.pubkey);
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });

  const owner = address(user.seedVaultPubkey);
  const day = dayOf(new Date());
  const [position, price, skrUsd, storeUsd, storeRaw, inputs, held, days] = await Promise.all([
    readPosition(owner), sharePrice(), priceUsd(SKR_MINT), priceUsd(STORE_MINT), storeBalanceRaw(owner), potInputs(repo, user), readHoldings(owner), latestCoinDays(repo, day),
  ]);
  const pot = potFromInputs(user, inputs, { position, sharePrice: price });
  const { plantings, legs, withdrawals } = inputs;
  const holdings = holdingsFrom({ held, legs, days });
  const storePutInRaw = legs.filter((l) => l.asset === "stORE").reduce((s, l) => s + l.amountOutRaw, 0n);
  const storeEarnedRaw = holdings.find((h) => h.asset === "stORE")?.earnedUnderlyingRaw ?? 0n;

  const wallets = await repo.listWalletsOf(user.seedVaultPubkey); // every status, so a revoked wallet stays visible [A20]
  const rules = await repo.getRules(user.seedVaultPubkey);
  const pending = (await Promise.all(wallets.map((w) => repo.unplantedSwaps(w.pubkey)))).flat().reduce((s, x) => s + x.roundupCents, 0);
  const pendingBasket = await repo.pendingWithdrawal(user.seedVaultPubkey);
  const ledgerWallet = wallets.find((w) => w.status === "active") ?? wallets[0];
  const nextAsset = pickAsset(ledgerWallet?.ledgerCents ?? {}, rules.allocation);
  // Queue item 12: what the delegation has actually pulled this period, so "left today" is a number the chain backs.
  let capLeft = capLeftCents(rules.dailyCapCents, 0);
  if (ledgerWallet) {
    try {
      const d = await readDelegation(address(ledgerWallet.delegationPda));
      const periodEndMs = Number(d.periodStartTs + d.periodLengthS) * 1000;
      const pulled = d.exists && Date.now() < periodEndMs ? Number(d.pulledInPeriodRaw / 10_000n) : 0;
      capLeft = capLeftCents(Math.min(rules.dailyCapCents, ledgerWallet.dailyCapCents, d.exists ? Number(d.amountPerPeriodRaw / 10_000n) : rules.dailyCapCents), pulled);
    } catch {
      // the chain could not be read just now: the rule's limit stands, as before
    }
  }
  const last = plantings[plantings.length - 1] ?? null; // the newest confirmed planting, never one in flight or failed [A20]
  const lastLegs = last ? legs.filter((l) => l.plantingId === last.id) : [];
  const lastAsset = lastLegs[0]?.asset ?? "SKR";
  const splitRow = (await repo.getSplitDay(day, rules.stop)) ?? (await repo.latestSplitDay(rules.stop));

  return NextResponse.json(str({
    user: { pubkey: user.seedVaultPubkey, skrName: user.skrName, joinedAt: user.createdAt, wateredAt: user.wateredAt },
    pot: {
      ...pot, storeRaw, storePutInRaw, storeEarnedRaw, storeRedeemRate: storePutInRaw > 0n ? await storeRedeemRate().catch(() => null) : null,
      skrUsd, storeUsd, asOf: new Date(),
    },
    holdings,
    manager: {
      managed: rules.managed, stop: rules.stop, pins: rules.pins, changedDay: rules.allocationDay, undoAvailable: rules.prevAllocation !== null,
      why: splitRow?.why ?? null, fallback: splitRow?.fallback ?? null, stopSplit: splitRow?.split ?? STOP_DEFAULTS[rules.stop],
    },
    history: {
      plantings: plantings.map((p) => {
        const l = legs.find((x) => x.plantingId === p.id);
        return { id: p.id, ts: p.ts, asset: l?.asset ?? "SKR", usdcInCents: l?.usdcInCents ?? 0, amountOutRaw: l?.amountOutRaw ?? 0n, feeCents: l?.feeCents ?? 0, signature: p.signature };
      }),
      picks: withdrawals.filter((w) => w.cancelSignature === null).map((w) => ({ ts: w.unstakeTs, asset: w.asset, amountRaw: w.amountRaw ?? 0n })),
    },
    nextPlanting: { pendingCents: pending, thresholdCents: rules.plantThresholdCents, capLeftCents: capLeft, asset: nextAsset },
    lastReceipt: last
      ? { ts: last.ts, usdcPulledCents: last.usdcPulledCents, networkFeeCents: last.networkFeeCents, asset: lastAsset, amountOutRaw: lastLegs[0]?.amountOutRaw ?? 0n, feeCents: lastLegs[0]?.feeCents ?? 0,
          feeAmountRaw: lastLegs[0]?.feeAmountRaw ?? 0n, // R139: "0" on a new leg (the fee was in USDC and rounds to zero), so the app says "fee under 1 cent" as on Activity
          signature: last.signature,
          usdPrice: lastAsset === "SKR" ? skrUsd : (days[lastAsset]?.priceUsd ?? (lastAsset === "stORE" ? storeUsd : null)) }
      : null,
    basket: pendingBasket
      ? {
          id: pendingBasket.id, asset: "SKR", amountRaw: pendingBasket.amountRaw ?? 0n, unstakeTs: pendingBasket.unstakeTs,
          readyAt: pot.skrUnstakeReadyAt ?? new Date(pendingBasket.unstakeTs.getTime() + COOLDOWN_MS), delivered: false, deliveredSignature: null,
        }
      : null,
    wallets: wallets.map((w) => ({ pubkey: w.pubkey, status: w.status, dailyCapCents: w.dailyCapCents })),
    rules: rulesRowToRules(rules),
  }));
}
