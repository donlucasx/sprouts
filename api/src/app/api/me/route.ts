import { NextResponse } from "next/server";
import { address } from "@solana/kit";
import { getRepo } from "@/db/repo";
import { rulesRowToRules } from "@/db/types";
import { requireSession } from "@/lib/auth-guard";
import { readPosition } from "@/lib/staking";
import { storeBalanceRaw } from "@/lib/store";
import { readDelegation } from "@/lib/subscriptions";
import { readHoldings, holdingsFrom, readLendingPositions, lendingFrom, lendHoldings } from "@/lib/holdings";
import { lendSignsFor, underlyingOutRaw, receiptOutRaw } from "@/lib/lend-view";
import { enabledLegs, LEG_SPEC, leashLive, relinkPilot, type LeashConfig } from "@/lib/leash";
import { sharedSharePrice, sharedPriceUsd, sharedStoreRedeemRate, sharedLeashConfig, sharedLatestCoinDays, sharedRateFacts, sharedLatestVenueRows } from "@/lib/shared-reads";
import { TERMS_VERSION } from "@/lib/terms";
import { carryMoves, moveCarriesFor } from "@/lib/moves";
import { leashAllowedFor, userRouting } from "@/lib/user-routing";
import { ASSETS, COINS, type LiveAsset } from "@/domain/coins";
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
  // Every read that needs only the user runs at once. Reads the same for every user (share price, coin prices, snapshot rows)
  // come from a short server-side memo (`shared-reads`); this user's chain reads (position, balances, receipts) stay fresh.
  // Spec 8, contracts 5.2: each lending position valued at the newest venue snapshot of the last 7 days (`latestVenueRows`):
  // underlyingRaw = receipt x that exchange rate, floored. The rate only rises, so this never overstates what a redeem returns.
  const [position, price, skrUsd, storeUsd, storeRaw, inputs, held, days, facts, venueRows, lendRead, carries, wallets, rules, pendingBasket, open] = await Promise.all([
    readPosition(owner), sharedSharePrice(), sharedPriceUsd(SKR_MINT), sharedPriceUsd(STORE_MINT), storeBalanceRaw(owner), potInputs(repo, user), readHoldings(owner),
    sharedLatestCoinDays(repo, day), sharedRateFacts(repo, day), sharedLatestVenueRows(repo, day),
    readLendingPositions(owner).catch((e: unknown) => {
      console.error(`/api/me: the lending receipts could not be read (${e instanceof Error ? e.message : String(e)})`);
      return null;
    }),
    moveCarriesFor(repo, user.seedVaultPubkey),
    repo.listWalletsOf(user.seedVaultPubkey), // every status, so a revoked wallet stays visible [A20]
    repo.getRules(user.seedVaultPubkey),
    repo.pendingWithdrawal(user.seedVaultPubkey),
    repo.openMoveProposal(user.seedVaultPubkey),
  ]);
  const pot = potFromInputs(user, inputs, { position, sharePrice: price });
  const { plantings, legs, withdrawals } = inputs;
  const holdings = holdingsFrom({ held, legs, days, facts });
  const lendPositions = lendRead ?? [];
  // T20: a done move carries its basis and earned to the new venue (legs are matched by (asset, venue)); history keeps the real legs.
  const lendLegs = carryMoves(legs, carries);
  const positionsOut = lendingFrom({ positions: lendPositions, legs: lendLegs, rows: venueRows, prices: { USDC_LEND: days.USDC_LEND?.priceUsd ?? null, SOL_LEND: days.SOL_LEND?.priceUsd ?? null } });
  // Live coins only (R281, R321: a retired coin's value never reaches a total); one aggregated row per lending leg.
  const allHoldings = [...holdings.filter((h) => COINS[h.asset].live), ...lendHoldings(positionsOut)].sort((p, q) => ASSETS.indexOf(p.asset as LiveAsset) - ASSETS.indexOf(q.asset as LiveAsset));
  const storePlantedRaw = legs.filter((l) => l.asset === "stORE").reduce((s, l) => s + l.amountOutRaw, 0n);
  const storePutInRaw = storeRaw < storePlantedRaw ? storeRaw : storePlantedRaw;   // R159: what left takes its share of the basis
  const storeEarnedRaw = holdings.find((h) => h.asset === "stORE")?.earnedUnderlyingRaw ?? 0n;

  const ledgerWallet = wallets.find((w) => w.status === "active") ?? wallets[0];
  const nextAsset = pickAsset(ledgerWallet?.ledgerCents ?? {}, rules.allocation);
  // Contracts 5.2: legsEnabled is null for a user with no leashed wallet; [] when the leash config cannot be read (nothing is enabled we can show).
  const leashWallets = wallets.filter((w) => w.linkModel === "leash" && w.status !== "revoked");
  // Second wave, at once: the reads that need the wallets, the rules or the stORE basis from the first.
  const [pending, capLeft, splitRow, leashCfg, storeRedeem] = await Promise.all([
    Promise.all(wallets.map((w) => repo.unplantedSwaps(w.pubkey))).then((r) => r.flat().reduce((s, x) => s + x.roundupCents, 0)),
    // Queue item 12: what the delegation has actually pulled this period, so "left today" is a number the chain backs.
    (async () => {
      if (!ledgerWallet) return capLeftCents(rules.dailyCapCents, 0);
      try {
        const d = await readDelegation(address(ledgerWallet.delegationPda));
        const periodEndMs = Number(d.periodStartTs + d.periodLengthS) * 1000;
        const pulled = d.exists && Date.now() < periodEndMs ? Number(d.pulledInPeriodRaw / 10_000n) : 0;
        return capLeftCents(Math.min(rules.dailyCapCents, ledgerWallet.dailyCapCents, d.exists ? Number(d.amountPerPeriodRaw / 10_000n) : rules.dailyCapCents), pulled);
      } catch {
        return capLeftCents(rules.dailyCapCents, 0); // the chain could not be read just now: the rule's limit stands, as before
      }
    })(),
    (async () => (await repo.getSplitDay(day, rules.stop)) ?? (await repo.latestSplitDay(rules.stop)))(),
    leashWallets.length ? sharedLeashConfig().catch((): LeashConfig | null => null) : Promise.resolve<LeashConfig | null>(null),
    storePutInRaw > 0n ? sharedStoreRedeemRate().catch(() => null) : Promise.resolve(null),
  ]);
  // R281: a retired coin's planting is history the app hides; Home's rows and receipt come from live legs only.
  const legOf = (id: string) => legs.find((x) => x.plantingId === id);
  const livePlantings = plantings.filter((p) => { const l = legOf(p.id); return !l || COINS[l.asset].live; });
  const last = livePlantings[livePlantings.length - 1] ?? null; // the newest confirmed live planting, never one in flight or failed [A20]
  const lastLegs = last ? legs.filter((l) => l.plantingId === last.id) : [];
  const lastAsset = lastLegs[0]?.asset ?? "SKR";
  // K-I5: the picks and the routing sentence after THIS user's 60% venue cap (the stored pick is the stop's, before it).
  const prices = { USDC_LEND: days.USDC_LEND?.priceUsd ?? null, SOL_LEND: days.SOL_LEND?.priceUsd ?? null };
  const legsEnabled: LiveAsset[] | null = leashWallets.length ? (leashCfg ? [...new Set(enabledLegs(leashCfg).map((b) => LEG_SPEC[b].asset))] : []) : null;
  // Residual O2: a leashed user is shown only venues the leash allows (the run's set).
  const routing = await userRouting({ repo, splitRow, positions: lendRead, prices, addUsd: Math.min(pending, rules.dailyCapCents) / 100, leash: leashAllowedFor(leashWallets.length > 0, leashCfg) });
  const picks = routing.picks;
  // Re-link (contracts 5.5, R287): this user's wallets still on the puller; a wallet on the leash or revoked never needs it.
  const pullerWallets = wallets.filter((w) => w.linkModel === "puller" && w.status !== "revoked");
  // R339 pilot: before go-live (LEASH_LIVE unset) a Seed Vault listed in RELINK_PILOT is asked to re-link its OWN wallet in the app
  // (the one leash proof, runbook D6); never a web wallet, whose link page still names the puller before go-live.
  const seedOnPuller = pullerWallets.filter((w) => w.pubkey === user.seedVaultPubkey);
  const pilot = !leashLive() && relinkPilot().includes(user.seedVaultPubkey) && seedOnPuller.length > 0;
  const asked = pilot ? seedOnPuller : pullerWallets;
  const relinkBlock = { needed: pilot || (leashLive() && pullerWallets.length > 0), wallets: asked.map((w) => ({ pubkey: w.pubkey, via: w.pubkey === user.seedVaultPubkey ? "app" : "link_page" })) };

  return NextResponse.json(str({
    user: { pubkey: user.seedVaultPubkey, skrName: user.skrName, joinedAt: user.createdAt, wateredAt: user.wateredAt },
    pot: {
      ...pot, storeRaw, storePutInRaw, storeEarnedRaw, storeRedeemRate: storeRedeem,
      skrUsd, storeUsd, asOf: new Date(),
    },
    holdings: allHoldings,
    positions: positionsOut.map(({ earnedUnderlyingRaw: _e, ...p }) => p),
    // R360: "failed" tells the app the empty list is a failed read, not a zero (the garden drops a coin's plant only at a real zero).
    positionsRead: lendRead === null ? "failed" : "ok",
    lendSigns: lendSignsFor({ picks, positions: positionsOut, rows: venueRows }),
    manager: {
      managed: rules.managed, stop: rules.stop, pins: rules.pins, changedDay: rules.allocationDay, undoAvailable: rules.prevAllocation !== null,
      why: routing.why, fallback: splitRow?.fallback ?? null, stopSplit: splitRow?.split ?? STOP_DEFAULTS[rules.stop],
      picks, legsEnabled,
    },
    relink: relinkBlock,
    terms: { currentVersion: TERMS_VERSION, acceptedVersion: user.termsVersion },
    moveProposal: open
      ? { id: open.id, ts: open.ts, asset: open.asset, from: open.fromVenue, to: open.toVenue, receiptRaw: open.receiptRaw, valueUsd: open.valueUsd,
          fromAvg7Pct: open.fromAvg7Pct, toAvg7Pct: open.toAvg7Pct, gain30dUsd: open.gain30dUsd, costUsd: open.costUsd,
          // C-I2 4: a stored redeem signature is a move on its way: the app shows it as such, and build and dismiss refuse it (409).
          inFlight: open.redeemSignature !== null }
      : null,
    history: {
      plantings: livePlantings.map((p) => {
        const l = legOf(p.id);
        return { id: p.id, ts: p.ts, asset: l?.asset ?? "SKR", usdcInCents: l?.usdcInCents ?? 0, amountOutRaw: l?.amountOutRaw ?? 0n, feeCents: l?.feeCents ?? 0, signature: p.signature,
          venue: l?.venue ?? null, receiptOutRaw: l ? receiptOutRaw(l) : null, underlyingOutRaw: l ? underlyingOutRaw(l) : null };
      }),
      picks: withdrawals.filter((w) => w.cancelSignature === null && COINS[w.asset].live).map((w) => ({ ts: w.unstakeTs, asset: w.asset, amountRaw: w.amountRaw ?? 0n })),
    },
    nextPlanting: { pendingCents: pending, thresholdCents: rules.plantThresholdCents, capLeftCents: capLeft, asset: nextAsset },
    lastReceipt: last
      ? { ts: last.ts, usdcPulledCents: last.usdcPulledCents, networkFeeCents: last.networkFeeCents, asset: lastAsset, amountOutRaw: lastLegs[0]?.amountOutRaw ?? 0n, feeCents: lastLegs[0]?.feeCents ?? 0,
          feeAmountRaw: lastLegs[0]?.feeAmountRaw ?? 0n, // R139: "0" on a new leg (the fee was in USDC and rounds to zero), so the app says "fee under 1 cent" as on Activity
          signature: last.signature,
          venue: lastLegs[0]?.venue ?? null, receiptOutRaw: lastLegs[0] ? receiptOutRaw(lastLegs[0]) : null, underlyingOutRaw: lastLegs[0] ? underlyingOutRaw(lastLegs[0]) : null,
          usdPrice: lastAsset === "SKR" ? skrUsd : (days[lastAsset]?.priceUsd ?? (lastAsset === "stORE" ? storeUsd : null)) }
      : null,
    basket: pendingBasket
      ? {
          id: pendingBasket.id, asset: "SKR", amountRaw: pendingBasket.amountRaw ?? 0n, unstakeTs: pendingBasket.unstakeTs,
          readyAt: pot.skrUnstakeReadyAt ?? new Date(pendingBasket.unstakeTs.getTime() + COOLDOWN_MS), delivered: false, deliveredSignature: null,
        }
      : null,
    wallets: wallets.map((w) => ({ pubkey: w.pubkey, status: w.status, dailyCapCents: w.dailyCapCents, linkModel: w.linkModel })),
    rules: rulesRowToRules(rules),
  }));
}
