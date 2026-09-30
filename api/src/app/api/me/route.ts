import { NextResponse } from "next/server";
import { address } from "@solana/kit";
import { getRepo } from "@/db/repo";
import { rulesRowToRules } from "@/db/types";
import { requireSession } from "@/lib/auth-guard";
import { readPosition, sharePrice } from "@/lib/staking";
import { priceUsd } from "@/lib/jupiter";
import { storeBalanceRaw, storeRedeemRate } from "@/lib/store";
import { pickAsset } from "@/domain/allocation";
import { potInputs, potFromInputs } from "@/lib/pot";
import { capLeftCents } from "@/domain/cap";
import { SKR_MINT, STORE_MINT } from "@/lib/constants";

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
  const [position, price, skrUsd, storeUsd, storeRaw, inputs] = await Promise.all([
    readPosition(owner), sharePrice(), priceUsd(SKR_MINT), priceUsd(STORE_MINT), storeBalanceRaw(owner), potInputs(repo, user),
  ]);
  const pot = potFromInputs(user, inputs, { position, sharePrice: price });
  const { plantings, legs, withdrawals } = inputs;
  const storePutInRaw = legs.filter((l) => l.asset === "stORE").reduce((s, l) => s + l.amountOutRaw, 0n);

  const wallets = await repo.listWalletsOf(user.seedVaultPubkey); // every status, so a revoked wallet stays visible [A20]
  const rules = await repo.getRules(user.seedVaultPubkey);
  const pending = (await Promise.all(wallets.map((w) => repo.unplantedSwaps(w.pubkey)))).flat().reduce((s, x) => s + x.roundupCents, 0);
  const pendingBasket = await repo.pendingWithdrawal(user.seedVaultPubkey);
  const ledgerWallet = wallets.find((w) => w.status === "active") ?? wallets[0];
  const nextAsset = pickAsset({ SKR: ledgerWallet?.ledgerSkrCents ?? 0, stORE: ledgerWallet?.ledgerStoreCents ?? 0 }, rules.allocation);
  const last = plantings[plantings.length - 1] ?? null; // the newest confirmed planting, never one in flight or failed [A20]
  const lastLegs = last ? legs.filter((l) => l.plantingId === last.id) : [];

  return NextResponse.json(str({
    user: { pubkey: user.seedVaultPubkey, skrName: user.skrName, joinedAt: user.createdAt, wateredAt: user.wateredAt },
    pot: {
      // The rate read may fail (audits/ore-plan, finding 2: it reads the wrong account today); nothing on Home needs it yet, so null.
      ...pot, storeRaw, storePutInRaw, storeEarnedRaw: 0n, storeRedeemRate: storePutInRaw > 0n ? await storeRedeemRate().catch(() => null) : null,
      skrUsd, storeUsd, asOf: new Date(),
    },
    history: {
      plantings: plantings.map((p) => {
        const l = legs.find((x) => x.plantingId === p.id);
        return { id: p.id, ts: p.ts, asset: l?.asset ?? "SKR", usdcInCents: l?.usdcInCents ?? 0, amountOutRaw: l?.amountOutRaw ?? 0n, signature: p.signature };
      }),
      picks: withdrawals.filter((w) => w.cancelSignature === null).map((w) => ({ ts: w.unstakeTs, asset: w.asset, amountRaw: w.amountRaw ?? 0n })),
    },
    // Today's pulled amount is per delegation; the app shows the rule's limit, the exact "left today" is a later polish.
    // The coin the next planting buys, from the picker on the active wallet's ledger, so the forming bud sits on the right plant.
    nextPlanting: { pendingCents: pending, thresholdCents: rules.plantThresholdCents, capLeftCents: capLeftCents(rules.dailyCapCents, 0), asset: nextAsset },
    lastReceipt: last
      ? { ts: last.ts, usdcPulledCents: last.usdcPulledCents, networkFeeCents: last.networkFeeCents, asset: lastLegs[0]?.asset ?? "SKR", amountOutRaw: lastLegs[0]?.amountOutRaw ?? 0n, signature: last.signature }
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
