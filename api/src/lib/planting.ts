import {
  address, pipe, createTransactionMessage, setTransactionMessageFeePayerSigner, setTransactionMessageLifetimeUsingBlockhash,
  appendTransactionMessageInstructions, compressTransactionMessageUsingAddressLookupTables, signTransactionMessageWithSigners,
  getBase64EncodedWireTransaction, getSignatureFromTransaction, fetchAddressesForLookupTables, sendAndConfirmTransactionFactory,
  createSolanaRpcSubscriptions, assertIsTransactionWithBlockhashLifetime, getTransactionEncoder, type Address, type Instruction, type TransactionSigner,
} from "@solana/kit";
import { getSetComputeUnitLimitInstruction, getSetComputeUnitPriceInstruction } from "@solana-program/compute-budget";
import { ASSOCIATED_TOKEN_PROGRAM_ADDRESS, findAssociatedTokenPda, TOKEN_PROGRAM_ADDRESS, getCreateAssociatedTokenIdempotentInstruction } from "@solana-program/token";
import { getQuote, getSwapInstructions, checkSwapInstructions, checkQuoteMints, JUPITER_AGGREGATOR } from "./jupiter";
import { buildTransferRecurringIx } from "./subscriptions";
import { buildStakeIx, sharePrice, skrAta } from "./staking";
import { klendRate, klendMinOut, buildKlendDepositIxs, checkKlendDepositInstructions } from "./venues/klend";
import { jlendRate, buildJlendDepositIxs, checkJlendDepositInstructions, JL_EXPECTED_LEFTOVER } from "./venues/jlend";
import { KLEND, JLEND } from "./venues/addresses";
import { leashLegOf, legAccounts, legRate, readReceipt, buildPullIx, buildSettleIx, checkLeashInstructions, floorRaw, LEG_SPEC, priceSourceFor, sponsoredPriceRefusal, type LeashLegByte } from "./leash";
import { buildPriceUpdate, readSponsoredPrice, sendPriceTxs, type ParsedPrice, type SignedTx } from "./pyth";
import type { Simulation } from "./plant-run";
import { pullerSigner } from "./puller";
import { rpc } from "./rpc";
import { config } from "./config";
import { USDC_MINT, SKR_MINT, WSOL_MINT, LEASH_PROGRAM, SUBSCRIPTIONS_PROGRAM, SKR_STAKING_PROGRAM, KLEND_PROGRAM, JLEND_PROGRAM, PYTH_RECEIVER } from "./constants";
import { COINS, isLendAsset, type Asset, type LendAsset, type LiveAsset } from "@/domain/coins";
import type { AutoVenue } from "@/domain/venues";
import type { CarryKind } from "@/db/types";


/**
 * The account a wallet-held coin needs before the swap: the user's own token account for that mint, created if missing
 * (Jupiter assumes a custom destination exists). Idempotent, so an existing account is not an error; the puller pays the rent,
 * about 0.002 SOL, once per user per coin. An SKR leg needs nothing: it is staked from the puller's own account.
 */
export async function coinAccountInstructions(a: { asset: Asset; payer: TransactionSigner; user: Address }): Promise<Instruction[]> {
  const coin = COINS[a.asset];
  if (coin.held !== "wallet") return [];
  const [ata] = await findAssociatedTokenPda({ owner: a.user, mint: coin.mint, tokenProgram: TOKEN_PROGRAM_ADDRESS });
  return [getCreateAssociatedTokenIdempotentInstruction({ payer: a.payer, ata, owner: a.user, mint: coin.mint })];
}

/**
 * R266, contracts 3.2: the 0.5% rides only on the four coin legs. A lending leg's quote carries no platformFeeBps and its swap no
 * feeAccount: Jupiter answers 400 "platformFee must be greater than 0 when feeAccount is set" (Claude audit F1), which the run
 * used to turn into a charged SKR planting.
 */
export async function swapFeeParams(asset: LiveAsset): Promise<{ platformFeeBps?: number; feeAccount?: Address }> {
  const bps = COINS[asset].feeBps;
  if (bps === 0) return {};
  const [feeAccount] = await findAssociatedTokenPda({ owner: address(config().feeWallet), mint: USDC_MINT, tokenProgram: TOKEN_PROGRAM_ADDRESS });
  return { platformFeeBps: bps, feeAccount };
}

export const SWAP_MAX_ACCOUNTS: Record<LiveAsset, number> = { SKR: 24, stORE: 24, USDC_LEND: 24, SOL_LEND: 24, hSOL: 24, cbBTC: 24 };   // SOL_LEND PROVISIONAL(S1)
const MAX_TX_BYTES = 1232;
/**
 * PLACEHOLDER (PREFLIGHT 10-04 s20; ruling s20): 400_000 is a ceiling, not a measured number. The final limit = the highest measured
 * route units (Task 12's leashed simulation, `units=` per leg) + 75_000 for the leash (pull + settle; the leash's Task 6 measured a
 * 72.6k worst case at 3,000 users, about 2x per-user variance from the bump search). Task 12 Step 4 sets it; do not lower it before.
 */
export const PLANTING_CU_LIMIT = 400_000;

export type BuiltPlanting = {
  tx: Awaited<ReturnType<typeof signTransactionMessageWithSigners>>;
  signature: string; expectedOutRaw: bigint; minOutRaw: bigint; lookupTables: Address[]; lastValidBlockHeight: bigint;
  /** Where the delivery guard reads: the user's ATA (wallet coin), the user's receipt ATA (lending), the puller's SKR float (SKR). */
  deliveryAccount: Address;
  /** Puller accounts whose fall the guards bound: the USDC float (every leg, T9 review I2), the WSOL float (SOL lending), the jl account that must end closed. */
  watched: Address[];
  /**
   * Task 11 review I1: the puller's three pooled floats, watched on EVERY leg (each may fall by at most this leg's own carry of that
   * kind): the USDC pull receiver, the WSOL swap output, the SKR stake source. `skrFloat` is null on an SKR leg, where that account
   * is the delivery account and deliveryShortfall bounds it.
   */
  usdcFloat: Address; wsolFloat: Address; skrFloat: Address | null;
  asset: LiveAsset; venue: AutoVenue | null; leg: LeashLegByte | null; preRaw: bigint | null;
  leashMinOutRaw: bigint | null; pullerJl: Address | null; jlLeftover: 0n | 1n | null; cleanup: Instruction[]; carryIn: Partial<Record<CarryKind, bigint>>; sizeBytes: number;
};

const ataOf = async (owner: Address, mint: Address) => (await findAssociatedTokenPda({ owner, mint, tokenProgram: TOKEN_PROGRAM_ADDRESS }))[0];

/**
 * Contracts 3.2: one v0 transaction the puller signs alone. Order: compute budget, every ATA create, [Pyth post_update], the leash
 * pull (or today's transferRecurring for an old link), [Jupiter swap], [venue deposit], [SKR stake], [the leash settle]. The whole
 * pull goes in (the 3-cent network fee is not withheld). Nothing from the network is signed unchecked: the Jupiter response, the
 * venue instructions and the leash pair are each checked; a leash min_out under the program's floor is refused here (no send).
 */
export async function buildPlantingTx(a: { delegator: Address; user: Address; asset: LiveAsset; venue: AutoVenue | null; pullRaw: bigint; delegationPda: Address; leashed: boolean; carryIn: Partial<Record<CarryKind, bigint>>; jlLeftover?: 0n | 1n; priceOpts?: { waitS?: number; confCapBps?: number; maxAgeS?: number } }): Promise<BuiltPlanting> {
  const lend = isLendAsset(a.asset);
  if (lend !== (a.venue !== null)) throw new Error(`${a.asset} with venue ${a.venue}: a lending leg needs a venue and a coin leg takes none`);
  const puller = await pullerSigner();
  const coin = COINS[a.asset];
  // T9 review M3 (fix round 1): a negative carry would shrink a deposit or stake below what the leg's numbers assume; refuse it.
  for (const [k, v] of Object.entries(a.carryIn)) if (v !== undefined && v < 0n) throw new Error(`${a.asset}: carry ${k} ${v} is negative`);
  const carry = (k: CarryKind) => a.carryIn[k] ?? 0n;
  const pullerUsdc = await ataOf(puller.address, USDC_MINT);
  const pullerWsol = await ataOf(puller.address, WSOL_MINT);
  const leg = a.leashed ? leashLegOf(a.asset, a.venue) : null;

  // 2b. The price the leash reads (leashed priced legs only): the sponsored account while fresh, else a fresh post.
  // AMEND 10-04 s20 (R324): priceSourceFor never answers "post" (it throws when no fresh sponsored price, and for SKR), so the post branch is dormant.
  let price: ParsedPrice | null = null;
  let priceAccount: Address | undefined;
  let postIx: Instruction | null = null;
  let cleanup: Instruction[] = [];
  let preTxs: SignedTx[] = [];
  if (leg !== null) {
    // `priceOpts` (additive, T8 carry): the run passes the leg's on-chain conf_cap_bps / max_age_s from its one readLeashConfig() and
    // waitS 0 once it has waited for the feed itself (once per feed per run, Task 11). Absent: the shipped defaults and a 60 s wait.
    const src = await priceSourceFor(leg, undefined, a.priceOpts?.waitS ?? 60, { ...(a.priceOpts?.confCapBps !== undefined ? { confCapBps: a.priceOpts.confCapBps } : {}), ...(a.priceOpts?.maxAgeS !== undefined ? { maxAgeS: a.priceOpts.maxAgeS } : {}) });
    if (src.kind === "sponsored") {
      priceAccount = src.account;
      price = await readSponsoredPrice(src.account);
      // T9 review M5: the floor is computed from this SECOND read of the account; it is checked exactly as the first was.
      const why = sponsoredPriceRefusal(leg, price, { ...(a.priceOpts?.confCapBps !== undefined ? { confCapBps: a.priceOpts.confCapBps } : {}), ...(a.priceOpts?.maxAgeS !== undefined ? { maxAgeS: a.priceOpts.maxAgeS } : {}) });
      if (why) throw new Error(`${a.asset}: the sponsored price read for the floor ${why}; the leg skips today`);
    }
    if (src.kind === "post") { const u = await buildPriceUpdate({ puller, feedId: src.feedId }); priceAccount = u.account; price = u.price; postIx = u.postIx; cleanup = u.closeIxs; preTxs = u.preTxs; }
  }

  const atas: Instruction[] = [...(await coinAccountInstructions({ asset: a.asset, payer: puller, user: a.user }))];
  if (a.asset === "SOL_LEND") atas.push(getCreateAssociatedTokenIdempotentInstruction({ payer: puller, ata: pullerWsol, owner: puller.address, mint: WSOL_MINT }));
  const body: Instruction[] = [];
  // The venue builders' ATA creates move to the ATA slot (contracts 3.2 step 2); Jupiter's own setup stays where Jupiter put it.
  const isCreate = (ix: Instruction) => ix.programAddress === ASSOCIATED_TOKEN_PROGRAM_ADDRESS;
  const venueIxs = (v: Instruction[]) => { atas.push(...v.filter(isCreate)); body.push(...v.filter((ix) => !isCreate(ix))); };
  // T9 review I2: the puller's USDC is watched on EVERY leg. On a swap leg it may not fall (the swap spends exactly the pull, so its
  // input is bound to pullRaw and cannot drain the pooled float); on USDC lending it may fall by this user's USDC carry only.
  // Review I1 (fix round 1): the WSOL and SKR floats too, on every leg: a forged route could spend them as its input or close the wSOL.
  const pullerSkr = await skrAta(puller.address);
  const watched: Address[] = [pullerUsdc, pullerWsol, ...(a.asset === "SKR" ? [] : [pullerSkr])];
  let lookupTables: Address[] = [];
  let expectedOutRaw = 0n;
  let swapMin = 0n;

  // 4. The swap: every leg but USDC lending. A lending leg's swap carries no fee (R266, swapFeeParams).
  if (a.asset !== "USDC_LEND") {
    const fee = await swapFeeParams(a.asset);
    // Step 0 (T9) kept in the composition: every swap has a pinned destination chosen by what the leg holds, never by fallthrough.
    // A venue-held leg swaps only as SOL_LEND (into the puller's WSOL, then the venue deposit); any other venue-held leg is refused.
    const destination = coin.held === "wallet" ? await ataOf(a.user, coin.mint) : coin.held === "staked" ? await skrAta(puller.address)
      : a.asset === "SOL_LEND" ? pullerWsol : (() => { throw new Error(`${a.asset}: a venue-held leg other than SOL lending never swaps`); })();
    const quote = await getQuote({ inputMint: USDC_MINT, outputMint: coin.mint, amountRaw: a.pullRaw, maxAccounts: SWAP_MAX_ACCOUNTS[a.asset], onlyDirectRoutes: a.asset === "SKR", ...(fee.platformFeeBps ? { platformFeeBps: fee.platformFeeBps } : {}) });
    checkQuoteMints(quote, { inputMint: USDC_MINT, outputMint: coin.mint });
    const swap = await getSwapInstructions({ quote, userPublicKey: puller.address, ...(fee.feeAccount ? { feeAccount: fee.feeAccount } : {}), ...(a.asset === "SKR" ? {} : { destinationTokenAccount: destination }) });
    checkSwapInstructions(swap, { puller: puller.address, ...(fee.feeAccount ? { feeAccount: fee.feeAccount } : {}), wsolAccount: pullerWsol, destination, source: pullerUsdc, ...(coin.held === "wallet" ? { destinationOwner: a.user } : {}) });
    body.push(...swap.setup, swap.swap, ...(swap.cleanup ? [swap.cleanup] : []));
    lookupTables = swap.lookupTables;
    expectedOutRaw = BigInt(quote.outAmount);
    swapMin = BigInt(quote.otherAmountThreshold);
  }

  // 5-6. Deposit or stake; what the delivery guard and the leash expect.
  let minOutRaw: bigint;
  let leashMinOutRaw: bigint | null = null;
  let deliveryAccount: Address;
  let pullerJl: Address | null = null;
  let jlLeftover: 0n | 1n | null = null;
  let jlRn: bigint | null = null;
  const depositRaw = a.asset === "USDC_LEND" ? a.pullRaw + carry("USDC") : a.asset === "SOL_LEND" ? swapMin + carry("WSOL") : 0n;
  if (a.venue === "kamino_klend") {
    const asset = a.asset as LendAsset;
    const r = await klendRate(asset);
    minOutRaw = klendMinOut(depositRaw, r);
    expectedOutRaw = (depositRaw * r.rd) / r.rn;
    venueIxs(await buildKlendDepositIxs({ puller, user: a.user, asset, amountRaw: depositRaw }));
    deliveryAccount = await ataOf(a.user, KLEND[asset].collateralMint);
    leashMinOutRaw = leg === null ? null : minOutRaw;
  } else if (a.venue === "jupiter_lend") {
    const asset = a.asset as LendAsset;
    const r = await jlendRate(asset);
    jlRn = r.rn;
    pullerJl = await ataOf(puller.address, JLEND[asset].fTokenMint);
    jlLeftover = a.jlLeftover ?? JL_EXPECTED_LEFTOVER;
    const bal = await rpc().getAccountInfo(pullerJl, { encoding: "base64", commitment: "confirmed" }).send();
    const d = await buildJlendDepositIxs({ puller, user: a.user, asset, depositRaw, rn: r.rn, pullerJlBalance: tokenAmountOf(bal.value ? new Uint8Array(Buffer.from(bal.value.data[0], "base64")) : null), leftover: jlLeftover });
    venueIxs(d.ixs);
    minOutRaw = d.minOutRaw;
    expectedOutRaw = d.minOutRaw;
    watched.push(pullerJl);
    deliveryAccount = await ataOf(a.user, JLEND[asset].fTokenMint);
    leashMinOutRaw = leg === null ? null : minOutRaw;
  } else if (a.asset === "SKR") {
    minOutRaw = swapMin;
    body.push(await buildStakeIx({ payer: puller, user: a.user, amountRaw: minOutRaw + carry("SKR") }));
    deliveryAccount = await skrAta(puller.address);
    if (leg !== null) leashMinOutRaw = (minOutRaw * 1_000_000_000n) / (await sharePrice()) - 1n;
  } else {
    minOutRaw = swapMin;
    deliveryAccount = await ataOf(a.user, coin.mint);
    leashMinOutRaw = leg === null ? null : minOutRaw;
  }

  // Carry-in (T5 review): min_out > 0 always. The program refuses a 0 (GUARD:MIN_OUT_ZERO) and a 0 makes every delivery guard vacuous.
  if (minOutRaw <= 0n) throw new Error(`${a.asset}: min_out ${minOutRaw} is not positive; the leg skips today`);
  if (leashMinOutRaw !== null && leashMinOutRaw <= 0n) throw new Error(`${a.asset}: leash min_out ${leashMinOutRaw} is not positive; the leg skips today`);

  // 3 and 7. The pull (leash or today's) and the settle.
  let pull: Instruction;
  let settle: Instruction | null = null;
  let preRaw: bigint | null = null;
  if (leg !== null) {
    const la = await legAccounts({ leg, user: a.user, ...(priceAccount ? { priceAccount } : {}) });
    const spec = LEG_SPEC[leg];
    const { rn, rd } = await legRate(leg);
    const floor = floorRaw({ leg, amountRaw: a.pullRaw, rn, rd, priceLow: price ? price.price - price.conf : null, exponent: price ? price.exponent : null, feeBps: spec.feeBps, tolBps: spec.tolBps, underlyingDecimals: spec.decimals });
    if ((leashMinOutRaw as bigint) < floor) throw new Error(`${a.asset}: min_out ${leashMinOutRaw} is under the leash floor ${floor}; the leg skips today`);
    preRaw = await readReceipt({ leg, receipt: la.receipt });
    pull = await buildPullIx({ puller, delegator: a.delegator, user: a.user, leg, amountRaw: a.pullRaw, minOutRaw: leashMinOutRaw as bigint, delegationPda: a.delegationPda, legAccounts: la });
    settle = await buildSettleIx({ user: a.user, leg, preRaw, minOutRaw: leashMinOutRaw as bigint, amountRaw: a.pullRaw, legAccounts: la });
  } else {
    pull = await buildTransferRecurringIx({ delegator: a.delegator, delegatee: puller, delegationPda: a.delegationPda, amountRaw: a.pullRaw });
  }

  const ixs: Instruction[] = [
    getSetComputeUnitLimitInstruction({ units: PLANTING_CU_LIMIT }), getSetComputeUnitPriceInstruction({ microLamports: 1_000n }),
    ...atas, ...(postIx ? [postIx] : []), pull, ...body, ...(settle ? [settle] : []),
  ];
  // T7 carry: the whole transaction against an allowlist (every program, every ATA create, every Token instruction), then each part's own checker.
  checkPlantingInstructions(ixs, { puller: puller.address, user: a.user, asset: a.asset, venue: a.venue, leashed: leg !== null, pullerWsol, pullerJl,
    userMints: lend ? [LEG_RECEIPT_MINT(a.asset as LendAsset, a.venue as AutoVenue)] : coin.held === "wallet" ? [coin.mint] : [], posted: postIx !== null });
  if (leg !== null) checkLeashInstructions(ixs, { user: a.user, leg, amountRaw: a.pullRaw, minOutRaw: leashMinOutRaw as bigint });
  // Carry-in (T6 review): the K-Lend deposit amount is BOUND to this leg's own amount (the pull, plus this user's own carry). The
  // puller's USDC / WSOL account is pooled across users, so a larger deposit would draw other users' float into this user's receipt.
  if (a.venue === "kamino_klend") await checkKlendDepositInstructions(ixs, { puller: puller.address, user: a.user, asset: a.asset as LendAsset, amountRaw: depositRaw });
  if (a.venue === "jupiter_lend") await checkJlendDepositInstructions(ixs, { puller: puller.address, user: a.user, asset: a.asset as LendAsset, depositRaw, rn: jlRn as bigint });

  if (preTxs.length) await sendPriceTxs(preTxs);   // the VAA write + verify move no funds; post_update needs them landed
  const alt = process.env.SPROUTS_ALT;
  const tableAddrs = [...lookupTables, ...(alt ? [address(alt)] : [])];
  const tables = await fetchAddressesForLookupTables(tableAddrs, rpc());
  const { value: { blockhash, lastValidBlockHeight } } = await rpc().getLatestBlockhash().send();
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayerSigner(puller, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash({ blockhash, lastValidBlockHeight }, m),
    (m) => appendTransactionMessageInstructions(ixs, m),
    (m) => compressTransactionMessageUsingAddressLookupTables(m, tables),
  );
  const tx = await signTransactionMessageWithSigners(message);
  const sizeBytes = getTransactionEncoder().encode(tx).length;
  if (sizeBytes > MAX_TX_BYTES) throw new Error(`${a.asset} planting is ${sizeBytes} bytes, over ${MAX_TX_BYTES}`);
  return {
    tx, signature: getSignatureFromTransaction(tx), expectedOutRaw, minOutRaw, lookupTables: tableAddrs, lastValidBlockHeight, deliveryAccount, watched, usdcFloat: pullerUsdc, wsolFloat: pullerWsol, skrFloat: a.asset === "SKR" ? null : pullerSkr,
    asset: a.asset, venue: a.venue, leg, preRaw, leashMinOutRaw, pullerJl, jlLeftover, cleanup, carryIn: a.carryIn, sizeBytes,
  };
}

const LEG_RECEIPT_MINT = (asset: LendAsset, venue: AutoVenue): Address => (venue === "kamino_klend" ? KLEND[asset].collateralMint : JLEND[asset].fTokenMint);
const COMPUTE_BUDGET = "ComputeBudget111111111111111111111111111111";
const TOKEN_PROGRAMS = new Set<string>([TOKEN_PROGRAM_ADDRESS, "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"]);
const SYNC_NATIVE = 17;

/**
 * Task 7 carry, contracts 3.3: the whole transaction against an allowlist, on top of each part's own checker (Jupiter's response,
 * the venue's deposit, the leash pair). Every top-level program must be one this leg uses, each the expected number of times.
 * Every ATA instruction is a create paid by the puller, for the puller's own account or for THIS user's account of this leg's coin
 * or receipt mint. Every Token instruction is either on the puller's jl account (checkJlendDepositInstructions rules on each one)
 * or Jupiter's SyncNative on the puller's WSOL account; a Transfer, Approve, SetAuthority, Burn or Close on any other account
 * (another user's, the puller's USDC float), and any CloseAccount of the pooled WSOL account (review I1), is refused.
 */
export function checkPlantingInstructions(ixs: readonly Instruction[], a: { puller: Address; user: Address; asset: LiveAsset; venue: AutoVenue | null; leashed: boolean; pullerWsol: Address; pullerJl: Address | null; userMints: Address[]; posted: boolean }): void {
  const refuse = (why: string): never => { throw new Error(`Planting refused: ${why}`); };
  // Each program this leg may call at the top level, and how many times (a range).
  const expected = new Map<string, [number, number]>([
    [a.leashed ? LEASH_PROGRAM : SUBSCRIPTIONS_PROGRAM, a.leashed ? [2, 2] : [1, 1]],
    ...(a.asset !== "USDC_LEND" ? [[JUPITER_AGGREGATOR, [1, 1]] as [string, [number, number]]] : []),
    ...(a.venue === "kamino_klend" ? [[KLEND_PROGRAM, [2, 2]] as [string, [number, number]]] : []),
    ...(a.venue === "jupiter_lend" ? [[JLEND_PROGRAM, [1, 1]] as [string, [number, number]]] : []),
    ...(a.asset === "SKR" ? [[SKR_STAKING_PROGRAM, [1, 1]] as [string, [number, number]]] : []),
    ...(a.posted ? [[PYTH_RECEIVER, [1, 1]] as [string, [number, number]]] : []),
  ]);
  const seen = new Map<string, number>();
  for (const ix of ixs) {
    const prog = ix.programAddress as string;
    const data = ix.data ?? new Uint8Array();
    const acc = (i: number) => ix.accounts?.[i]?.address as string | undefined;
    if (prog === COMPUTE_BUDGET) continue;
    if (prog === ASSOCIATED_TOKEN_PROGRAM_ADDRESS) {
      if (!(data.length === 0 || (data.length === 1 && (data[0] === 0 || data[0] === 1)))) refuse(`associated-token instruction ${data[0]} is not a create`);
      if (acc(0) !== a.puller) refuse(`an account creation paid by ${acc(0)}, not the puller`);
      const owner = acc(2);
      if (owner === a.puller) continue;
      if (owner !== a.user) refuse(`an account creation for ${owner}, who is neither the puller nor this user`);
      if (!a.userMints.includes(acc(3) as Address)) refuse(`an account creation for this user's ${acc(3)}, not this leg's coin or receipt`);
      continue;
    }
    if (TOKEN_PROGRAMS.has(prog)) {
      const target = acc(0);
      if (a.pullerJl && target === a.pullerJl) continue;
      if (data.length === 1 && data[0] === SYNC_NATIVE && target === a.pullerWsol) continue;
      refuse(`Token instruction ${data[0]} on ${target} is not allowed in a planting`);
    }
    if (!expected.has(prog)) refuse(`program ${prog} is not allowed in a ${a.asset} planting`);
    seen.set(prog, (seen.get(prog) ?? 0) + 1);
  }
  for (const [prog, [lo, hi]] of expected) {
    const n = seen.get(prog) ?? 0;
    if (n < lo || n > hi) refuse(`${n} instructions of ${prog}, expected ${lo === hi ? lo : `${lo}-${hi}`}`);
  }
}

/** Mainnet simulation, no side effects; reads the delivery account and every watched account before, and as the simulation leaves them. */
export async function simulatePlanting(b: BuiltPlanting): Promise<Simulation> {
  const addrs = [b.deliveryAccount, ...b.watched];
  const before = await rpc().getMultipleAccounts(addrs, { encoding: "base64", commitment: "confirmed" }).send();
  const amount = (v: { data: [string, string] } | null | undefined) => (v ? tokenAmountOf(new Uint8Array(Buffer.from(v.data[0], "base64"))) : null);
  const pre = before.value.map((v) => amount(v as never));
  const res = await rpc().simulateTransaction(getBase64EncodedWireTransaction(b.tx), {
    encoding: "base64", sigVerify: false, replaceRecentBlockhash: true, commitment: "confirmed", accounts: { encoding: "base64", addresses: addrs },
  }).send();
  const after = res.value.accounts ?? [];
  const ok = !res.value.err;
  const out: Simulation = { ok, err: res.value.err, logs: [...(res.value.logs ?? [])], units: Number(res.value.unitsConsumed ?? 0) };
  if (ok) {
    out.delivery = { pre: pre[0] ?? 0n, post: amount(after[0] as never) ?? 0n };
    out.watched = Object.fromEntries(b.watched.map((w, i) => [w, { pre: pre[i + 1], post: amount(after[i + 1] as never) }]));
  }
  return out;
}

type TokenBalance = { mint: string; owner?: string; uiTokenAmount: { amount: string } };

/**
 * What one confirmed transaction changed in `owner`'s SKR holdings, from its own pre and post token balances (R207 #2). Read by
 * signature, so other users' plantings landing at the same time in the same puller account cannot leak into it. Throws when the
 * owner has no SKR account in the transaction at all: an SKR planting always touches it (the swap fills it, the stake drains it).
 */
export function skrChangeFromMeta(meta: { preTokenBalances?: readonly TokenBalance[] | null; postTokenBalances?: readonly TokenBalance[] | null }, owner: string): bigint {
  const mine = (list: readonly TokenBalance[] | null | undefined) => (list ?? []).filter((b) => b.mint === SKR_MINT && b.owner === owner);
  const pre = mine(meta.preTokenBalances);
  const post = mine(meta.postTokenBalances);
  if (!pre.length && !post.length) throw new Error(`no SKR account of ${owner} in the transaction`);
  const sum = (l: TokenBalance[]) => l.reduce((s, b) => s + BigInt(b.uiTokenAmount.amount), 0n);
  return sum(post) - sum(pre);
}

/** The puller's SKR change in a confirmed planting: what the swap delivered minus what the stake took (R207 #2). */
export async function pullerSkrChangeRaw(signature: string): Promise<bigint> {
  const puller = await pullerSigner();
  const tx = await rpc().getTransaction(signature as Parameters<ReturnType<typeof rpc>["getTransaction"]>[0], { encoding: "json", maxSupportedTransactionVersion: 0, commitment: "confirmed" }).send();
  if (!tx?.meta) throw new Error(`transaction ${signature} not found`);
  return skrChangeFromMeta(tx.meta as Parameters<typeof skrChangeFromMeta>[0], puller.address);
}

/** The puller's change of one mint inside one confirmed transaction, from that transaction's own balances (skrChangeFromMeta generalised). */
// PREFLIGHT 10-04 s20 (Kimi F6, refuted): `TokenBalance` is the module-local type already in planting.ts (beside skrChangeFromMeta).
// Do NOT import a `TokenBalance` from @solana/kit: it would be a duplicate identifier.
export async function pullerTokenChangeRaw(signature: string, mint: Address): Promise<bigint> {
  const puller = await pullerSigner();
  const tx = await rpc().getTransaction(signature as Parameters<ReturnType<typeof rpc>["getTransaction"]>[0], { encoding: "json", maxSupportedTransactionVersion: 0, commitment: "confirmed" }).send();
  if (!tx?.meta) throw new Error(`transaction ${signature} not found`);
  const meta = tx.meta as { preTokenBalances?: readonly TokenBalance[] | null; postTokenBalances?: readonly TokenBalance[] | null };
  const mine = (list: readonly TokenBalance[] | null | undefined) => (list ?? []).filter((b) => b.mint === mint && b.owner === puller.address);
  const sum = (l: TokenBalance[]) => l.reduce((s, b) => s + BigInt(b.uiTokenAmount.amount), 0n);
  return sum(mine(meta.postTokenBalances)) - sum(mine(meta.preTokenBalances));
}

/** After the planting: reclaim the posted price's rent (best effort, puller only, no funds). Dormant while posting is deferred (R324). */
export async function cleanupPlanting(b: BuiltPlanting): Promise<void> {
  if (!b.cleanup.length) return;
  const puller = await pullerSigner();
  const { value: { blockhash, lastValidBlockHeight } } = await rpc().getLatestBlockhash().send();
  const tx = await signTransactionMessageWithSigners(pipe(createTransactionMessage({ version: 0 }), (m) => setTransactionMessageFeePayerSigner(puller, m), (m) => setTransactionMessageLifetimeUsingBlockhash({ blockhash, lastValidBlockHeight }, m), (m) => appendTransactionMessageInstructions(b.cleanup, m)));
  await sendPriceTxs([tx]);
}

/** An SPL token account's amount (u64 little-endian at byte 64); no account is zero. */
export function tokenAmountOf(data: Uint8Array | null): bigint {
  if (!data) return 0n;
  if (data.length < 72) throw new Error(`not a token account (${data.length} bytes)`);
  return Buffer.from(data).readBigUInt64LE(64);
}

/** Send and wait for confirmation. May throw after the transaction landed (a dropped websocket): the caller asks the chain. */
export async function sendPlanting(b: BuiltPlanting): Promise<void> {
  const tx = b.tx;
  assertIsTransactionWithBlockhashLifetime(tx);
  const send = sendAndConfirmTransactionFactory({ rpc: rpc(), rpcSubscriptions: createSolanaRpcSubscriptions(config().heliusRpcUrl.replace("https://", "wss://")) });
  await send(tx, { commitment: "confirmed" });
}

/** What the chain says about a signature: landed, landed and failed, or not seen (still in flight or never sent). */
export async function signatureStatus(sig: string): Promise<"confirmed" | "failed" | "pending"> {
  const { value } = await rpc().getSignatureStatuses([sig as Parameters<ReturnType<typeof rpc>["getSignatureStatuses"]>[0][number]], { searchTransactionHistory: true }).send();
  const s = value[0];
  if (!s) return "pending";
  if (s.err) return "failed";
  return s.confirmationStatus === "confirmed" || s.confirmationStatus === "finalized" ? "confirmed" : "pending";
}
