import { AccountRole, type AccountSignerMeta, getAddressDecoder, getAddressEncoder, getProgramDerivedAddress, type Address, type Instruction, type TransactionSigner } from "@solana/kit";
import { findAssociatedTokenPda, TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import { findEventAuthorityPda, findSubscriptionAuthorityPda } from "@solana/subscriptions";
import { GUARDIAN_POOL, LEASH_PROGRAM, ORE_STAKE_ACCOUNT, STAKE_CONFIG, STORE_MINT, SUBSCRIPTIONS_PROGRAM, SYSTEM_PROGRAM, SYSVAR_INSTRUCTIONS, USDC_MINT } from "./constants";
import { JLEND, KLEND, PYTH_ACCOUNT, PYTH_FEED } from "./venues/addresses";
import { readPriceAccountOrWhy, priceRefusal, FRESH_MARGIN_S, CONF_CAP_BPS } from "./pyth";
import { sharePrice, userStakePda } from "./staking";
import { parseStakePool } from "./stake-pool";
import { storeRedeemRate } from "./store";
import { klendRate } from "./venues/klend";
import { jlendRate } from "./venues/jlend";
import { rpc } from "./rpc";
import { COINS, type LendAsset, type LiveAsset } from "@/domain/coins";
import type { AutoVenue } from "@/domain/venues";

const enc = getAddressEncoder();
const dec = getAddressDecoder();

export type LeashLegByte = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;
export const LEASH_LEG = { SKR: 0, stORE: 1, "USDC_LEND:kamino_klend": 2, "USDC_LEND:jupiter_lend": 3, "SOL_LEND:kamino_klend": 4, "SOL_LEND:jupiter_lend": 5, hSOL: 6, cbBTC: 7 } as const;
export const LEG_BYTES: readonly LeashLegByte[] = [0, 1, 2, 3, 4, 5, 6, 7];
export const READER = { TOKEN: 0, SKR_STAKE: 1, STAKE_POOL: 2, KLEND: 3, JLEND: 4, STORE: 5 } as const;

export function leashLegOf(asset: LiveAsset, venue: AutoVenue | null): LeashLegByte {
  if (asset === "USDC_LEND" || asset === "SOL_LEND") {
    if (!venue) throw new Error(`${asset} needs a venue for its leash leg`);
    return LEASH_LEG[`${asset}:${venue}`];
  }
  if (venue) throw new Error(`${asset} takes no venue`);
  return LEASH_LEG[asset];
}

export type LegSpec = { asset: LiveAsset; venue: AutoVenue | null; reader: number; receiptMint: Address | null; rateAccount: Address | null; extra: Address | null;
  feed: keyof typeof PYTH_FEED | null; decimals: number; feeBps: number; tolBps: number; maxAgeS: number; readers: Address[] };   // maxAgeS: AMEND 10-04 s20 (R324), mirrors the program's MAX_AGE_S_OF_LEG (60; cbBTC 600)
/** Contracts 2.3, 2.4, 2.7 (tolerances as amended): the per-leg constants the config, the builders and the floor share, mirrored by the program. */
export const LEG_SPEC: Record<LeashLegByte, LegSpec> = {
  0: { asset: "SKR", venue: null, reader: READER.SKR_STAKE, receiptMint: null, rateAccount: STAKE_CONFIG, extra: GUARDIAN_POOL, feed: "SKR", decimals: 6, feeBps: 50, tolBps: 100, maxAgeS: 60, readers: [STAKE_CONFIG] },
  1: { asset: "stORE", venue: null, reader: READER.STORE, receiptMint: STORE_MINT, rateAccount: ORE_STAKE_ACCOUNT, extra: STORE_MINT, feed: "ORE", decimals: 11, feeBps: 50, tolBps: 100, maxAgeS: 60, readers: [ORE_STAKE_ACCOUNT, STORE_MINT] },
  2: { asset: "USDC_LEND", venue: "kamino_klend", reader: READER.KLEND, receiptMint: KLEND.USDC_LEND.collateralMint, rateAccount: KLEND.USDC_LEND.reserve, extra: null, feed: null, decimals: 6, feeBps: 0, tolBps: 10, maxAgeS: 60, readers: [KLEND.USDC_LEND.reserve] },
  3: { asset: "USDC_LEND", venue: "jupiter_lend", reader: READER.JLEND, receiptMint: JLEND.USDC_LEND.fTokenMint, rateAccount: JLEND.USDC_LEND.lending, extra: null, feed: null, decimals: 6, feeBps: 0, tolBps: 10, maxAgeS: 60, readers: [JLEND.USDC_LEND.lending] },
  4: { asset: "SOL_LEND", venue: "kamino_klend", reader: READER.KLEND, receiptMint: KLEND.SOL_LEND.collateralMint, rateAccount: KLEND.SOL_LEND.reserve, extra: null, feed: "SOL", decimals: 9, feeBps: 0, tolBps: 150, maxAgeS: 60, readers: [KLEND.SOL_LEND.reserve] },
  5: { asset: "SOL_LEND", venue: "jupiter_lend", reader: READER.JLEND, receiptMint: JLEND.SOL_LEND.fTokenMint, rateAccount: JLEND.SOL_LEND.lending, extra: null, feed: "SOL", decimals: 9, feeBps: 0, tolBps: 150, maxAgeS: 60, readers: [JLEND.SOL_LEND.lending] },
  6: { asset: "hSOL", venue: null, reader: READER.STAKE_POOL, receiptMint: COINS.hSOL.mint, rateAccount: COINS.hSOL.pool, extra: null, feed: "SOL", decimals: 9, feeBps: 50, tolBps: 100, maxAgeS: 60, readers: [COINS.hSOL.pool as Address] },
  7: { asset: "cbBTC", venue: null, reader: READER.TOKEN, receiptMint: COINS.cbBTC.mint, rateAccount: null, extra: null, feed: "CBBTC", decimals: 8, feeBps: 50, tolBps: 100, maxAgeS: 600, readers: [] },
};

export { buildPriceUpdate } from "./pyth";

export type PriceSource = { kind: "none" } | { kind: "sponsored"; account: Address } | { kind: "post"; feedId: string };
/**
 * Contracts 1.4 feed rule, AMEND 10-04 s20 (R324): sponsored only, never "post". Legs 2/3: no price. SOL, ORE, cbBTC: the sponsored
 * account, checked the way the program's read_price (price.rs) will check it at pull: receiver-owned, 134-byte PriceUpdateV2, Full,
 * the leg's pinned feed id (these fail at once: the next update will not fix them), then younger than LEG_SPEC[leg].maxAgeS -
 * FRESH_MARGIN_S (40 s; cbBTC 580 s) and the value checks (price > 0, exponent, the conf cap, p_low > 0). A stale or refused price is
 * polled every 2 s for up to `waitS` (measured 10-04: SOL/ORE update every 50-55 s, so a read at 40-55 s waits up to ~16 s), then
 * this throws and the leg skips the run (`leg_skipped`). `nowS` (tests) disables the wait. SKR (leg 0): no source, throws.
 *
 * T8 review carry (taken in T9): `cfg` takes the leg's ON-CHAIN `conf_cap_bps` and `max_age_s` (readLeashConfig().legs[leg], read
 * once per run): set_leg can change them, and the API must judge a price exactly as the program will. Absent, the shipped
 * defaults (CONF_CAP_BPS, LEG_SPEC.maxAgeS) apply. The run-level part of that carry (wait at most once per FEED per run, feeds
 * concurrently, a total wait budget inside the cron's maxDuration 300, freshness re-checked right before each send) belongs to
 * the run (Task 11); a build after the run's wait passes `waitS: 0`.
 * Refusal messages are distinct per cause: an RPC error, a missing account, another owner, not Full, another feed, stale, refused value.
 */
export async function priceSourceFor(leg: LeashLegByte, nowS?: number, waitS = 60, cfg: { confCapBps?: number; maxAgeS?: number } = {}): Promise<PriceSource> {
  const feed = LEG_SPEC[leg].feed;
  if (!feed) return { kind: "none" };
  if (feed === "SKR") {
    // SKR PRICE PLUG-IN POINT (contracts 10 item 15): the ONE place an SKR source goes. Today there is none: SKR has no sponsored
    // account and posting is deferred (R324, the key is 403 for crypto feeds). When a crypto-entitled Pyth key exists, re-implement
    // buildPriceUpdate (lib/pyth.ts) and return { kind: "post", feedId: PYTH_FEED.SKR } here; planting's dormant "post" branch
    // then posts it (the program's read_price checks a posted account exactly like a sponsored one).
    throw new Error("leg 0 (SKR) has no price source: posting is deferred (R324) and SKR has no sponsored account (contracts 10 item 15)");
  }
  const account = PYTH_ACCOUNT[feed];
  const freshS = (cfg.maxAgeS ?? LEG_SPEC[leg].maxAgeS) - FRESH_MARGIN_S;
  const capBps = cfg.confCapBps ?? CONF_CAP_BPS;
  const deadline = Date.now() + waitS * 1000;
  for (;;) {
    let r: Awaited<ReturnType<typeof readPriceAccountOrWhy>>;
    try {
      r = await readPriceAccountOrWhy(account);
    } catch (e) {
      // A layout refusal (receiver-owned, wrong length or discriminator) keeps its own message; anything else is the RPC failing.
      const msg = (e as Error).message;
      if (/^price update refused/.test(msg)) throw new Error(`sponsored ${feed} account ${account}: ${msg} (leg ${leg} skips this run)`);
      throw new Error(`RPC error reading the sponsored ${feed} account ${account}: ${msg} (leg ${leg} skips this run)`);
    }
    if ("why" in r) throw new Error(`sponsored ${feed} account ${account} ${r.why} (leg ${leg} skips this run)`);
    const p = r.price;
    if (!p.full) throw new Error(`sponsored ${feed} account ${account} is not Full (partial verification) (leg ${leg} skips this run)`);
    if (p.feedId !== PYTH_FEED[feed]) throw new Error(`sponsored ${feed} account ${account} holds feed ${p.feedId.slice(0, 8)}, not the pinned ${feed} feed (leg ${leg} skips this run)`);
    const age = (nowS ?? Math.floor(Date.now() / 1000)) - Number(p.publishTime);
    const why = age >= freshS ? `is ${age} s old (usable under ${freshS} s)` : priceRefusal(p, capBps);
    if (why === null) return { kind: "sponsored", account };
    if (nowS !== undefined || Date.now() + 2_000 > deadline) throw new Error(`sponsored ${feed} price ${why}: leg ${leg} skips this run`);
    await new Promise((r) => setTimeout(r, 2_000));
  }
}

/** R297 go-live switch: new links point at the leash, old puller links stop planting. Off until the owner sets LEASH_LIVE=1. */
export const leashLive = (): boolean => process.env.LEASH_LIVE === "1";

export async function leashPda(delegator: Address, user: Address): Promise<Address> {
  const [pda] = await getProgramDerivedAddress({ programAddress: LEASH_PROGRAM, seeds: ["leash", enc.encode(delegator), enc.encode(user)] });
  return pda;
}
export async function leashConfigPda(): Promise<Address> {
  const [pda] = await getProgramDerivedAddress({ programAddress: LEASH_PROGRAM, seeds: ["config"] });
  return pda;
}

/** The leg's reader rate rn / rd (underlying raw per receipt raw) as the API reads it (contracts 2.7), for floorRaw before the send. */
export async function legRate(leg: LeashLegByte): Promise<{ rn: bigint; rd: bigint }> {
  const spec = LEG_SPEC[leg];
  switch (spec.reader) {
    case READER.TOKEN: return { rn: 1n, rd: 1n };
    case READER.SKR_STAKE: return { rn: await sharePrice(), rd: 1_000_000_000n };
    case READER.STORE: return { rn: await storeRedeemRate(), rd: 1_000_000_000n };
    case READER.KLEND: { const r = await klendRate(spec.asset as LendAsset); return { rn: r.rn, rd: r.rd }; }
    case READER.JLEND: return jlendRate(spec.asset as LendAsset);
    case READER.STAKE_POOL: {
      const info = await rpc().getAccountInfo(spec.rateAccount as Address, { encoding: "base64", commitment: "confirmed" }).send();
      if (!info.value) throw new Error(`stake pool ${spec.rateAccount} missing`);
      const t = parseStakePool(new Uint8Array(Buffer.from(info.value.data[0], "base64")));
      return { rn: t.totalLamports, rd: t.poolTokenSupply };
    }
    default: throw new Error(`leg ${leg} has no reader`);
  }
}

export type LegAccounts = { receipt: Address; price: Address; readers: Address[] };
/** Contracts 2.7: the receipt is the user's canonical classic-SPL ATA of the leg's receipt mint, or the user's UserStake for SKR. */
export async function legAccounts(a: { leg: LeashLegByte; user: Address; priceAccount?: Address }): Promise<LegAccounts> {
  const spec = LEG_SPEC[a.leg];
  const receipt = a.leg === 0 ? await userStakePda(a.user) : (await findAssociatedTokenPda({ owner: a.user, mint: spec.receiptMint as Address, tokenProgram: TOKEN_PROGRAM_ADDRESS }))[0];
  if (spec.feed && !a.priceAccount) throw new Error(`leash leg ${a.leg} needs a price account`);
  return { receipt, price: spec.feed ? (a.priceAccount as Address) : SYSTEM_PROGRAM, readers: [...spec.readers] };
}

const u64 = (v: bigint) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(v); return b; };
const u128 = (v: bigint) => Buffer.concat([u64(v & 0xffff_ffff_ffff_ffffn), u64(v >> 64n)]);
const ro = (address: Address) => ({ address, role: AccountRole.READONLY });
const rw = (address: Address) => ({ address, role: AccountRole.WRITABLE });

export async function buildPullIx(a: { puller: TransactionSigner; delegator: Address; user: Address; leg: LeashLegByte; amountRaw: bigint; minOutRaw: bigint; delegationPda: Address; legAccounts: LegAccounts }): Promise<Instruction> {
  const [subscriptionAuthority] = await findSubscriptionAuthorityPda({ user: a.delegator, tokenMint: USDC_MINT });
  const [eventAuthority] = await findEventAuthorityPda();
  const [delegatorUsdc] = await findAssociatedTokenPda({ owner: a.delegator, mint: USDC_MINT, tokenProgram: TOKEN_PROGRAM_ADDRESS });
  const [pullerUsdc] = await findAssociatedTokenPda({ owner: a.puller.address, mint: USDC_MINT, tokenProgram: TOKEN_PROGRAM_ADDRESS });
  // A typed signer meta (no cast on the Instruction): the kit signs with it when the tx is built.
  const pullerMeta: AccountSignerMeta = { address: a.puller.address, role: AccountRole.READONLY_SIGNER, signer: a.puller };
  return {
    programAddress: LEASH_PROGRAM,
    accounts: [
      pullerMeta,
      ro(await leashConfigPda()), ro(a.delegator), ro(a.user), ro(await leashPda(a.delegator, a.user)),
      rw(a.delegationPda), rw(subscriptionAuthority), rw(delegatorUsdc), rw(pullerUsdc),
      ro(USDC_MINT), ro(TOKEN_PROGRAM_ADDRESS), ro(eventAuthority), ro(SUBSCRIPTIONS_PROGRAM), ro(SYSVAR_INSTRUCTIONS),
      ro(a.legAccounts.receipt), ro(a.legAccounts.price), ...a.legAccounts.readers.map(ro),
    ],
    data: new Uint8Array(Buffer.concat([Buffer.from([0, a.leg]), u64(a.amountRaw), u64(a.minOutRaw)])),
  };
}

export async function buildSettleIx(a: { user: Address; leg: LeashLegByte; preRaw: bigint; minOutRaw: bigint; amountRaw: bigint; legAccounts: LegAccounts }): Promise<Instruction> {
  return {
    programAddress: LEASH_PROGRAM,
    accounts: [ro(a.user), ro(await leashConfigPda()), ro(a.legAccounts.receipt), ro(a.legAccounts.price), ...a.legAccounts.readers.map(ro)],
    data: new Uint8Array(Buffer.concat([Buffer.from([1, a.leg]), u128(a.preRaw), u64(a.minOutRaw), u64(a.amountRaw)])),
  };
}

const refuse = (why: string): never => { throw new Error(`Leash refused: ${why}`); };

/** Contracts 3.1 / invariant 1: exactly one pull and one later settle of the leash program, same leg, amount, min_out, user and pinned accounts. */
export function checkLeashInstructions(ixs: readonly Instruction[], a: { user: Address; leg: LeashLegByte; amountRaw: bigint; minOutRaw: bigint }): void {
  if (a.minOutRaw === 0n) refuse("min_out is 0 (the program refuses it, GUARD:MIN_OUT_ZERO)");
  const idx = ixs.map((ix, i) => (ix.programAddress === LEASH_PROGRAM ? i : -1)).filter((i) => i >= 0);
  if (idx.length === 1 && ixs[idx[0]].data?.[0] === 0) refuse("a pull without a settle");
  if (idx.length !== 2) refuse(`expected exactly one pull and one settle, found ${idx.length} leash instructions`);
  const pull = ixs[idx[0]];
  const settle = ixs[idx[1]];
  if (pull.data?.[0] !== 0 || settle.data?.[0] !== 1) refuse("wrong order: the pull must come first and the settle after it");
  const pd = Buffer.from(pull.data!);
  const sd = Buffer.from(settle.data!);
  if (pd.length !== 18 || sd.length !== 34) refuse("bad instruction data length");
  if (pd[1] !== a.leg || sd[1] !== a.leg) refuse(`leg ${pd[1]}/${sd[1]}, expected ${a.leg}`);
  if (pd.readBigUInt64LE(2) !== a.amountRaw || sd.readBigUInt64LE(26) !== a.amountRaw) refuse("amount differs");
  if (pd.readBigUInt64LE(10) !== a.minOutRaw || sd.readBigUInt64LE(18) !== a.minOutRaw) refuse("min_out differs");
  const pa = (pull.accounts ?? []).map((x) => x.address as string);
  const sa = (settle.accounts ?? []).map((x) => x.address as string);
  if (pa[3] !== a.user) refuse("the pull is for another user");
  const expected = [pa[3], pa[1], pa[14], pa[15], ...pa.slice(16)];
  if (sa.length !== expected.length || sa.some((x, i) => x !== expected[i])) refuse("settle accounts differ from the pull's");
}

export type LeashConfig = { puller: Address; pullerUsdc: Address; maxPullRaw: bigint; legs: { enabled: boolean; reader: number; feeBps: number; tolBps: number;
  confCapBps: number; maxAgeS: number; receiptMint: Address | null; rateAccount: Address | null; extra: Address | null; feedId: string | null; feedAccount: Address | null }[] };

export const CONFIG_BODY_LEN = 1488;
const LEGS_AT = 80;
const LEG_LEN = 176;
const putAddr = (b: Buffer, o: number, v: Address | null) => { if (v) Buffer.from(enc.encode(v)).copy(b, o); };
const getAddr = (b: Buffer, o: number): Address | null => (b.subarray(o, o + 32).every((x) => x === 0) ? null : dec.decode(b.subarray(o, o + 32)));

/** AMEND 10-04 s20 (R325): the program's instruction tags (contracts 2.5); 3 (the full-body set_config) is retired. */
export const LEASH_IX = { pull: 0, settle: 1, initConfig: 2, setHeader: 4, setLeg: 5 } as const;
export const CONFIG_HEADER_LEN = 80;

/** Config bytes 16..96 (the init_config / set_header payload): puller, puller_usdc, max_pull_raw, reserved zero. */
export function encodeHeader(c: Pick<LeashConfig, "puller" | "pullerUsdc" | "maxPullRaw">): Uint8Array {
  const b = Buffer.alloc(CONFIG_HEADER_LEN);
  putAddr(b, 0, c.puller);
  putAddr(b, 32, c.pullerUsdc);
  b.writeBigUInt64LE(c.maxPullRaw, 64);
  return new Uint8Array(b);
}

/** One LegConfig, the 176 bytes at 96 + 176 * leg (the set_leg payload); `underlying_decimals` from LEG_SPEC (fixed per leg). */
export function encodeLeg(leg: LeashLegByte, l: LeashConfig["legs"][number]): Uint8Array {
  const b = Buffer.alloc(LEG_LEN);
  b[0] = l.enabled ? 1 : 0;
  b[1] = l.reader;
  b[2] = LEG_SPEC[leg].decimals;
  b.writeUInt16LE(l.feeBps, 4);
  b.writeUInt16LE(l.tolBps, 6);
  b.writeUInt16LE(l.confCapBps, 8);
  b.writeUInt16LE(l.maxAgeS, 10);
  putAddr(b, 16, l.receiptMint);
  putAddr(b, 48, l.rateAccount);
  putAddr(b, 80, l.extra);
  if (l.feedId) Buffer.from(l.feedId, "hex").copy(b, 112);
  putAddr(b, 144, l.feedAccount);
  return new Uint8Array(b);
}

/** Config bytes 16..1504 (contracts 2.3) = header ++ legs 0..7: what the account holds after the owner's golden path. Task 13 checks it against the leash golden hex. */
export function encodeConfig(c: LeashConfig): Uint8Array {
  if (c.legs.length !== 8) throw new Error("the config holds exactly 8 legs");
  return new Uint8Array(Buffer.concat([encodeHeader(c), ...LEG_BYTES.map((i) => encodeLeg(i, c.legs[i]))]));
}

/** The admin instruction data (contracts 2.5): [2][header] 81 B, [4][header] 81 B, [5][leg][LegConfig] 178 B. */
export const initConfigData = (c: LeashConfig): Uint8Array => new Uint8Array([LEASH_IX.initConfig, ...encodeHeader(c)]);
export const setHeaderData = (c: LeashConfig): Uint8Array => new Uint8Array([LEASH_IX.setHeader, ...encodeHeader(c)]);
export const setLegData = (leg: LeashLegByte, c: LeashConfig): Uint8Array => new Uint8Array([LEASH_IX.setLeg, leg, ...encodeLeg(leg, c.legs[leg])]);

/** Either the whole 1504-byte account (magic and version checked) or the 1488-byte body. */
export function decodeConfig(data: Uint8Array): LeashConfig {
  let b = Buffer.from(data);
  if (b.length === 1504) {
    if (b.subarray(0, 8).toString("ascii") !== "LEASHCFG") throw new Error("leash config: bad magic");
    if (b[8] !== 1) throw new Error(`leash config: version ${b[8]}`);
    b = b.subarray(16);
  } else if (b.length !== CONFIG_BODY_LEN) throw new Error(`leash config: ${b.length} bytes`);
  const legs = LEG_BYTES.map((i) => {
    const o = LEGS_AT + LEG_LEN * i;
    const feed = b.subarray(o + 112, o + 144);
    return {
      enabled: b[o] === 1, reader: b[o + 1], feeBps: b.readUInt16LE(o + 4), tolBps: b.readUInt16LE(o + 6), confCapBps: b.readUInt16LE(o + 8), maxAgeS: b.readUInt16LE(o + 10),
      receiptMint: getAddr(b, o + 16), rateAccount: getAddr(b, o + 48), extra: getAddr(b, o + 80), feedId: feed.every((x) => x === 0) ? null : feed.toString("hex"), feedAccount: getAddr(b, o + 144),
    };
  });
  return { puller: getAddr(b, 0) as Address, pullerUsdc: getAddr(b, 32) as Address, maxPullRaw: b.readBigUInt64LE(64), legs };
}

/** The cron reads the enabled flags from chain, never from env (contracts 3.1). Throws when the config account is missing. */
export async function readLeashConfig(): Promise<LeashConfig> {
  const info = await rpc().getAccountInfo(await leashConfigPda(), { encoding: "base64", commitment: "confirmed" }).send();
  if (!info.value) throw new Error("leash config is not initialised");
  if (info.value.owner !== LEASH_PROGRAM) throw new Error(`leash config owner is ${info.value.owner}`);
  return decodeConfig(new Uint8Array(Buffer.from(info.value.data[0], "base64")));
}
export const enabledLegs = (c: LeashConfig): LeashLegByte[] => LEG_BYTES.filter((l) => c.legs[l]?.enabled);

const U128_MAX = (1n << 128n) - 1n;
/** Rust's `checked_mul` on u128: the program answers Overflow (6021) where a bigint would silently grow. */
const mul = (x: bigint, y: bigint): bigint => {
  const v = x * y;
  if (v > U128_MAX) throw new Error("leash floor: Overflow");
  return v;
};
const ceilDiv = (n: bigint, d: bigint) => n / d + (n % d === 0n ? 0n : 1n);
/** Contracts 2.8: a port of the program's `price::floor_raw` (checked u128, same guards, same order), golden vectors in
 * tests/lib/leash.test.ts shared with leash/tests/tests/unit_floor.rs. USDC is valued at exactly $1. */
export function floorRaw(a: { leg: LeashLegByte; amountRaw: bigint; rn: bigint; rd: bigint; priceLow: bigint | null; exponent: number | null; feeBps: number; tolBps: number; underlyingDecimals: number }): bigint {
  if (a.rn === 0n || a.rd === 0n) throw new Error("leash floor: BadReader (a zero rate)");
  // The program picks the formula by LEG (is_unpriced, lib.rs read_price_acct), never by whether a price was found:
  // a priced leg without a price (or an unpriced leg with one) is refused, not silently valued as USDC.
  const priced = LEG_SPEC[a.leg].feed !== null;
  if (priced !== (a.priceLow !== null && a.exponent !== null)) throw new Error(`leash floor: BadPriceAccount (leg ${a.leg} is ${priced ? "priced and has no price" : "unpriced and got a price"})`);
  if (a.priceLow !== null && a.priceLow <= 0n) throw new Error("leash floor: PriceConfidence (p_low <= 0)");   // read_price GUARD:P_LOW
  const keep = 10_000n - BigInt(a.feeBps) - BigInt(a.tolBps);
  if (keep < 0n) throw new Error("leash floor: Overflow");
  const net = mul(a.amountRaw, keep) / 10_000n;
  let n: bigint;
  let d: bigint;
  if (!priced || a.priceLow === null || a.exponent === null) {
    n = mul(net, a.rd);
    d = a.rn;
  } else {
    const s = a.exponent + 6;
    n = mul(mul(net, a.rd), mul(1n, 10n ** BigInt(a.underlyingDecimals)));
    d = mul(a.rn, a.priceLow);
    if (s < 0) n = mul(n, mul(1n, 10n ** BigInt(-s)));
    else d = mul(d, mul(1n, 10n ** BigInt(s)));
  }
  if (d === 0n) throw new Error("leash floor: PriceConfidence (a zero price)");
  return ceilDiv(n, d);
}

/** What pull will record as `pre`: token amount u64 @64, UserStake shares u128 @105; a missing account is 0 (a first SKR stake). */
export async function readReceipt(a: { leg: LeashLegByte; receipt: Address }): Promise<bigint> {
  const info = await rpc().getAccountInfo(a.receipt, { encoding: "base64", commitment: "confirmed" }).send();
  if (!info.value) return 0n;
  const b = Buffer.from(info.value.data[0], "base64");
  if (a.leg === 0) return b.readBigUInt64LE(105) + (b.readBigUInt64LE(113) << 64n);
  return b.readBigUInt64LE(64);
}

export const LEASH_ERRORS: Record<number, string> = {
  6000: "NotTopLevel", 6001: "BadPda", 6002: "BadProgram", 6003: "BadMint", 6004: "ReceiptNotUsers", 6005: "MissingSettle", 6006: "ExtraLeashIx", 6007: "SettleMismatch",
  6008: "BelowFloor", 6009: "Underdelivered", 6010: "BadData", 6011: "NotPuller", 6012: "BadReceiver", 6013: "BadConfig", 6014: "NotAdmin", 6015: "LegDisabled",
  6016: "BadReceipt", 6017: "BadPriceAccount", 6018: "StalePrice", 6019: "PriceConfidence", 6020: "BadReader", 6021: "Overflow", 6022: "OverCap", 6023: "AlreadyInitialized",
  130: "Subscriptions: Unauthorized", 400: "Subscriptions: AmountExceedsPeriodLimit",
};
