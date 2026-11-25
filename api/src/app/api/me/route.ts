import { langOf, lineText } from "@/lib/i18n";
import { apiError } from "@/lib/api-error";
import { withNetworkFee } from "@/lib/put-in";
import { NextResponse } from "next/server";
import { address } from "@solana/kit";
import { getRepo } from "@/db/repo";
import { rulesRowToRules } from "@/db/types";
import { requireSession, rateLimited } from "@/lib/auth-guard";
import { readPosition } from "@/lib/staking";
import { storeBalanceRaw } from "@/lib/store";
import { readDelegation } from "@/lib/subscriptions";
import { readHoldings, holdingsFrom, readLendingPositions, lendingFrom, lendHoldings, assetBalanceRaw } from "@/lib/holdings";
import { idleSkrFrom, stakePlantOff } from "@/lib/plant-skr";
import { lendSignsFor, underlyingOutRaw, receiptOutRaw } from "@/lib/lend-view";
import { enabledLegs, LEG_SPEC, leashLive, relinkPilot, type LeashConfig } from "@/lib/leash";
import { homeReadCapOn, ownerCached, rememberAnswer, repeatAnswer } from "@/lib/memo";
/** 11-25: a person reads Home once or twice per open; 30 a minute is far above that and far below the ~90 a looping account sends. */
const HOME_READS_PER_MIN = 30;
import { sharedSharePrice, sharedPriceUsd, sharedStoreRedeemRate, sharedLeashConfig, sharedLatestCoinDays, sharedRateFacts, sharedLatestVenueRows } from "@/lib/shared-reads";
import { TERMS_VERSION } from "@/lib/terms";
import { carryMoves, moveCarriesFor } from "@/lib/moves";
import { leashAllowedFor, userRouting } from "@/lib/user-routing";
import { ASSETS, COINS, type LiveAsset, type Split } from "@/domain/coins";
import { pickAsset } from "@/domain/allocation";
import { potInputs, potFromInputs, countedPicks } from "@/lib/pot";
import { capLeftCents } from "@/domain/cap";
import { SKR_MINT, STORE_MINT } from "@/lib/constants";
import { STOP_DEFAULTS } from "@/domain/split";
import { dayOf } from "@/domain/day";
import { pauseCauseOf, PAUSE_EVENT_KINDS } from "@/domain/pause-cause";
import { NETWORK_FEE_CENTS, openingTarget, SplitUnder100Error } from "@/lib/plant-run";
import { coinOpening, type Opening } from "@/domain/opening";
import { plantThresholdFor } from "@/domain/threshold";
import { reminderFor } from "@/domain/reminders";
import { CURRENT_MESSAGE } from "@/domain/messages";
import { askFor } from "@/domain/asks";
import { readReminderInputs, reminderFactsFrom, stoppedCauseOf } from "@/lib/reminder-facts";

export const runtime = "nodejs";

const COOLDOWN_MS = 172_800_000;
const str = (v: unknown) => JSON.parse(JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x)));

/** Everything Home needs, computed in one place from the chain and the ledger. The app never computes money from chain reads itself. */
async function answer(request: Request) {
  const lang = langOf(request);
  const session = await requireSession(request);
  if (session instanceof NextResponse) return session;
  const repo = await getRepo();
  const user = await repo.getUser(session.pubkey);
  if (!user) return apiError("sign_in_first", { error: "Sign in first." }, { status: 401 }, lang);

  const owner = address(user.seedVaultPubkey);
  const day = dayOf(new Date());
  // 0.1.13 Plant my SKR: the wallet's own liquid SKR (kept 15 s per instance like Home's other chain reads; a display read, never the
  // build's); a failed read is no marker, never an error. Not read at all while STAKE_PLANT_OFF=1.
  const walletSkr = stakePlantOff() ? Promise.resolve(null) : ownerCached(owner, "walletSkr", () => assetBalanceRaw(owner, "SKR")).catch(() => null);
  // Every read that needs only the user runs at once. Reads the same for every user (share price, coin prices, snapshot rows)
  // come from a short server-side memo (`shared-reads`); this user's chain reads (position, balances, receipts) stay fresh.
  // Spec 8, contracts 5.2: each lending position valued at the newest venue snapshot of the last 7 days (`latestVenueRows`):
  // underlyingRaw = receipt x that exchange rate, floored. The rate only rises, so this never overstates what a redeem returns.
  const [position, price, skrUsd, storeUsd, storeRaw, inputs, held, days, facts, venueRows, lendRead, carries, wallets, rules, pendingBasket, open] = await Promise.all([
    // 11-25 (carousel load, Kimi hotfix): this owner's chain reads kept 15 s per instance (memo.ts ownerCached); DB reads stay fresh.
    ownerCached(owner, "position", () => readPosition(owner)), sharedSharePrice(), sharedPriceUsd(SKR_MINT), sharedPriceUsd(STORE_MINT),
    ownerCached(owner, "storeBalance", () => storeBalanceRaw(owner)), potInputs(repo, user), ownerCached(owner, "holdings", () => readHoldings(owner)),
    sharedLatestCoinDays(repo, day), sharedRateFacts(repo, day), sharedLatestVenueRows(repo, day),
    ownerCached(owner, "lending", () => readLendingPositions(owner)).catch((e: unknown) => {
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
  const { plantings, withdrawals } = inputs;
  // First planting (domain/threshold.ts): the threshold the run will use, so Home's bar reads "$0.30 of $0.50" for a new user. A
  // confirmed planting answers it; otherwise the run's own read (a `sent` one counts), failing closed to the user's own threshold.
  const hasPlanted = plantings.length > 0 || (await repo.hasPlanted(user.seedVaultPubkey).catch(() => true));
  const thresholdCents = plantThresholdFor({ ruleCents: rules.plantThresholdCents, hasPlanted });
  // R583 / audits/putin-3c: put in = what was pulled (the legacy 3c added back), for every screen this answer feeds; the pot's SKR
  // amounts above read raw units and are untouched.
  const legs = withNetworkFee(inputs.legs, plantings);
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
  // Season 11-23 (slow opening): the run's own target with nothing disabled, counted over every wallet (a revoked one too); the
  // coins that wait to join the garden, and the next coin read from what the user may plant now. A broken or empty target reads
  // as the saved allocation (and nothing waits), as before.
  let opened: { target: Split | null; opening: Opening | null } = { target: null, opening: null };
  try {
    opened = openingTarget(rulesRowToRules(rules), [], wallets.map((w) => w.ledgerCents));
  } catch (e) {
    if (!(e instanceof SplitUnder100Error)) throw e;
  }
  const nextTarget = opened.target ?? rules.allocation;
  const opening = { plantedCents: (opened.opening ?? coinOpening(wallets.map((w) => w.ledgerCents), rules.allocation)).plantedCents, waiting: opened.opening?.waiting ?? [] };
  // R2-N1 (11-15): an empty target (every coin off) reads as its largest share, never null on the wire.
  const nextAsset = pickAsset(ledgerWallet?.ledgerCents ?? {}, nextTarget) ?? ASSETS.reduce((b, c) => (rules.allocation[c] > rules.allocation[b] ? c : b));
  // Contracts 5.2: legsEnabled is null for a user with no leashed wallet; [] when the leash config cannot be read (nothing is enabled we can show).
  const leashWallets = wallets.filter((w) => w.linkModel === "leash" && w.status !== "revoked");
  // Second wave, at once: the reads that need the wallets, the rules or the stORE basis from the first.
  const [pending, capLeft, splitRow, leashCfg, storeRedeem, pauseEvents, revokeEvents, reminderInputs] = await Promise.all([
    Promise.all(wallets.map((w) => repo.unplantedSwaps(w.pubkey))).then((r) => r.flat().reduce((s, x) => s + x.owedCents, 0)),
    // Queue item 12: what the delegation has actually pulled this period, so "left today" is a number the chain backs.
    (async () => {
      if (!ledgerWallet) return capLeftCents(rules.dailyCapCents, 0);
      try {
        const d = await ownerCached(owner, `delegation:${ledgerWallet.delegationPda}`, () => readDelegation(address(ledgerWallet.delegationPda)));
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
    // Why each paused wallet is paused (one read, only when one is paused): the app says "add USDC" only for the run's own pause.
    wallets.some((w) => w.status === "paused") ? repo.listEvents(user.seedVaultPubkey, [...PAUSE_EVENT_KINDS], 200) : Promise.resolve([]),
    // 10-27 (user-c.skr, wallet 2hEw: stopped by the run and hidden, so the app looked unlinked): why each revoked wallet stopped
    wallets.some((w) => w.status === "revoked") ? repo.listEvents(user.seedVaultPubkey, ["revoke_seen"], 50) : Promise.resolve([]),
    // 0.1.9: the facts the reminder, the ask and the Terms date are built from (one events read, one swap read).
    readReminderInputs(repo, user),
  ]);
  // A no-USDC pause ends by itself at the next daily run once the wallet holds threshold + network fee (plant-run.ts
  // resumePausedWallets); needCents is what the run wanted to pull when it paused (the round-ups the cap allowed, fee included).
  const pauseOf = (w: (typeof wallets)[number]) => {
    if (w.status !== "paused") return null;
    const cause = pauseCauseOf(pauseEvents, w.pubkey);
    return cause.reason === "no_usdc" ? { reason: "no_usdc", needCents: cause.needCents, resumeAtCents: thresholdCents + NETWORK_FEE_CENTS } : { reason: "user" };
  };
  // 10-27: a wallet Sprouts stopped on its own (its USDC approval gone, or its delegation gone outside the app) says so, so Home can ask
  // for a re-link; one the user revoked in the app or on sprouts.money/revoke ("by: user") stays quiet. The newest revoke of each wallet.
  // 10-27 (his Seeker on 0.1.6, wallet 9ZKi: an old puller link, revoked 10-07, shown as "unlinked outside the app"): a puller link
  // stopped planting at go-live (R297) and a re-link makes a new leash link, so its revoke is history and stays quiet too.
  const stoppedOf = (w: (typeof wallets)[number]): "approval" | "outside" | null => {
    return stoppedCauseOf(w, revokeEvents)?.cause ?? null; // shared with the A7 reminder (lib/reminder-facts)
  };
  // 0.1.9: at most one reminder (the phone shows it by its own local clock), the one-time note, and at most one question.
  const now = new Date();
  const reminder = reminderInputs.ok ? reminderFor(reminderFactsFrom(reminderInputs, user, wallets, now)) : null;
  const ask = !reminderInputs.ok ? null : askFor({
    walletsEver: wallets.length,
    linkedNow: wallets.filter((w) => w.status !== "revoked").map((w) => w.pubkey),
    withdrawals: countedPicks(withdrawals, inputs.skippedEvents).length,
    removedWallets: reminderInputs.events.filter((e) => e.kind === "revoke_seen" && e.walletPubkey && (e.detail as { by?: unknown } | null)?.by === "user").map((e) => ({ wallet: e.walletPubkey!, at: e.ts })),
    now,
    answered: reminderInputs.answers.flatMap((e) => {
      const d = e.detail as { question?: unknown; ref?: unknown } | null;
      return typeof d?.question === "string" && typeof d.ref === "string" ? [{ question: d.question, ref: d.ref }] : [];
    }),
  });
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
    // 0.1.13 Plant my SKR: { raw, usdCents } from $5 of liquid SKR in the Seed Vault wallet, else null (off, unread, under $5). Old apps ignore it.
    idleSkr: idleSkrFrom(await walletSkr, skrUsd),
    terms: { currentVersion: TERMS_VERSION, acceptedVersion: user.termsVersion, acceptedAt: user.termsAcceptedAt },
    // P9: the reminder and the note in the asking app's language (computed per request; ids, kinds and routes unchanged).
    reminder: reminder && lang === "es" ? { ...reminder, title: lineText(reminder.title, lang), body: lineText(reminder.body, lang) } : reminder,
    message: lang === "es" ? { ...CURRENT_MESSAGE, heading: lineText(CURRENT_MESSAGE.heading, lang), body: lineText(CURRENT_MESSAGE.body, lang) } : CURRENT_MESSAGE,
    ask,
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
      // 11-14: a superseded row whose SKR a later whole-cooldown row counts again is not a second pick (lib/pot countedPicks)
      picks: countedPicks(withdrawals, inputs.skippedEvents).filter((w) => COINS[w.asset].live).map((w) => ({ ts: w.unstakeTs, asset: w.asset, amountRaw: w.amountRaw ?? 0n })),
    },
    nextPlanting: { pendingCents: pending, thresholdCents, capLeftCents: capLeft, asset: nextAsset },
    opening,
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
    wallets: wallets.map((w) => ({ pubkey: w.pubkey, status: w.status, dailyCapCents: w.dailyCapCents, linkModel: w.linkModel, pause: pauseOf(w), stopped: stoppedOf(w) })),
    rules: rulesRowToRules(rules),
  }));
}

/**
 * 11-25 (Home refresh loop, Kimi loop scope A): a repeat of the same read by the same signed-in user inside REPEAT_MS gets the answer
 * they just had (memo.ts repeatAnswer), with no DB or Helius work; any write they make clears it (auth-guard). Only 200 answers kept.
 */
export async function GET(request: Request) {
  const lang = langOf(request);
  const session = await requireSession(request);
  if (session instanceof NextResponse) return session;
  // 11-25 (his ruling): a per-user ceiling. ~6 accounts signed up within 12 minutes read Home ~1.5/s nonstop (a farm, not the app);
  // a person reads once or twice per open. Past HOME_READS_PER_MIN in a minute: 429 with Retry-After (per instance, like every limit here).
  if (homeReadCapOn() && rateLimited(`home-read:me:${session.pubkey}`, HOME_READS_PER_MIN)) {
    return apiError("rate_limited", { error: "Too many requests. Try again in a minute." }, { status: 429, headers: { "Retry-After": "30" } }, lang);
  }
  const url = new URL(request.url);
  const key = `me${url.search}|${request.headers.get("x-sprouts-app") ?? "-"}|${langOf(request)}`;   // P9: an answer carries its language
  const again = repeatAnswer(session.pubkey, key);
  if (again !== undefined) return NextResponse.json(again);
  const res = await answer(request);
  if (res.status === 200) rememberAnswer(session.pubkey, key, await res.clone().json());
  return res;
}
