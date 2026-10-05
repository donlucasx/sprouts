import {
  AccountRole, address, appendTransactionMessageInstructions, assertIsTransactionWithBlockhashLifetime, compileTransaction,
  createKeyPairSignerFromPrivateKeyBytes, createSolanaRpcSubscriptions, createTransactionMessage, getTransactionEncoder, pipe,
  sendAndConfirmTransactionFactory, setTransactionMessageFeePayerSigner, setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners, type Address, type Blockhash, type Instruction, type TransactionSigner,
} from "@solana/kit";
import { getSetComputeUnitLimitInstruction, getSetComputeUnitPriceInstruction } from "@solana-program/compute-budget";
import { PublicKey, type Signer, type TransactionInstruction } from "@solana/web3.js";
import { createRequire } from "node:module";
import { config } from "./config";
import { rpc } from "./rpc";
import { PYTH_HERMES, PYTH_RECEIVER } from "./constants";

/** AMEND 10-04 s20 (R324): a sponsored account is used only while younger than its leg's max_age_s (LEG_SPEC.maxAgeS) minus this:
 *  the time to build, simulate and land before pull reads it. 40 s for SOL/ORE, 580 s for cbBTC. */
export const FRESH_MARGIN_S = 20;
/** Contracts 2.3 `conf_cap_bps`: 100 [inference] on every priced leg, the value the API writes with `set_leg` (tests/lib/leash.test.ts
 *  configs). The program refuses `conf * 10000 > price * conf_cap_bps` (price.rs GUARD:P_CONF). If the on-chain cap is ever changed,
 *  change this with it, or the API builds pulls the program refuses (or skips legs the program would accept). */
export const CONF_CAP_BPS = 100;
const DISC = Buffer.from("22f123639d7ef4cd", "hex");
export type ParsedPrice = { feedId: string; price: bigint; conf: bigint; exponent: number; publishTime: bigint; full: boolean };
export type SignedTx = Awaited<ReturnType<typeof signTransactionMessageWithSigners>>;

/** Contracts 2.6: owner rec5EKMG..., disc 22f123639d7ef4cd, 134 bytes; byte 40 == 1 is Full verification. */
export function parsePriceUpdate(data: Uint8Array): ParsedPrice {
  const b = Buffer.from(data);
  if (b.length !== 134) throw new Error(`price update refused: ${b.length} bytes, expected 134`);
  if (!b.subarray(0, 8).equals(DISC)) throw new Error("price update refused: not a PriceUpdateV2");
  return { feedId: b.subarray(41, 73).toString("hex"), price: b.readBigInt64LE(73), conf: b.readBigUInt64LE(81), exponent: b.readInt32LE(89), publishTime: b.readBigInt64LE(93), full: b[40] === 1 };
}

/**
 * The value checks of the program's `read_price` (leash/program/src/price.rs) that come after owner, layout, Full, feed id and age,
 * in the program's order: price > 0 (P_POSITIVE), -12 <= exponent <= 0 (P_EXPO_LO/HI), conf * 10000 <= price * cap (P_CONF),
 * p_low = price - conf > 0 (P_LOW). Returns the refusal reason, or null when the program would accept the price.
 */
export function priceRefusal(p: ParsedPrice, confCapBps = CONF_CAP_BPS): string | null {
  if (p.price <= 0n) return `price ${p.price} is not positive`;
  if (p.exponent < -12 || p.exponent > 0) return `exponent ${p.exponent} is outside -12..0`;
  if (p.conf * 10_000n > p.price * BigInt(confCapBps)) return `confidence ${p.conf} is over ${confCapBps} bps of price ${p.price}`;
  if (p.price - p.conf <= 0n) return `p_low (price - conf) is not positive`;
  return null;
}

/**
 * T8 review minors, taken in T9: the account read at `confirmed`, and WHY it is unusable kept apart (missing vs owned by another
 * program), so the run's log tells an absent sponsor account from a hijacked one. An RPC failure is not caught here: it throws
 * with its own message, which priceSourceFor labels as an RPC error (not as a stale or refused price).
 * A receiver-owned account with the wrong length or discriminator throws.
 */
export async function readPriceAccountOrWhy(account: Address): Promise<{ price: ParsedPrice } | { why: string }> {
  const info = await rpc().getAccountInfo(account, { encoding: "base64", commitment: "confirmed" }).send();
  if (!info.value) return { why: "is missing" };
  if (info.value.owner !== PYTH_RECEIVER) return { why: `is owned by ${info.value.owner}, not the Pyth receiver` };
  return { price: parsePriceUpdate(new Uint8Array(Buffer.from(info.value.data[0], "base64"))) };
}
/** The account if it is receiver-owned; null otherwise. A receiver-owned account with the wrong length or discriminator throws. */
export async function readPriceAccount(account: Address): Promise<ParsedPrice | null> {
  const r = await readPriceAccountOrWhy(account);
  return "price" in r ? r.price : null;
}
export async function readSponsoredPrice(account: Address): Promise<ParsedPrice> {
  const p = await readPriceAccount(account);
  if (!p) throw new Error(`price account ${account} is missing or not the receiver's`);
  return p;
}

/**
 * The fresh account a post wrote, re-read once the pre-txs landed (commitment confirmed, as sendPriceTxs waits): what the leash
 * will read at pull, so the planting computes its floor from THIS, never from Hermes's parse. Missing or another owner throws.
 */
export async function readPostedPrice(account: Address): Promise<ParsedPrice> {
  const r = await readPriceAccountOrWhy(account);
  if ("why" in r) throw new Error(`the posted price account ${account} ${r.why} (missing or not the receiver's)`);
  return r.price;
}

/** A hung Hermes answer must not eat the cron's 300 s budget (review minor): the leg skips instead. */
const HERMES_TIMEOUT_MS = 10_000;

/** Hermes latest update for one feed (base64 VAAs + the parsed price). Bearer auth; a 401/403 throws and the leg skips the day.
 *  The SKR source (contracts 10 item 15); the key is optional, so a missing PYTH_API_KEY throws here, never at config(). */
export async function fetchHermesUpdate(feedId: string): Promise<{ data: string[]; price: ParsedPrice }> {
  const key = config().pythApiKey;
  if (!key) throw new Error("PYTH_API_KEY is not set: no Hermes price to post (R324)");
  const res = await fetch(`${PYTH_HERMES}/v2/updates/price/latest?ids[]=${feedId}&encoding=base64&parsed=true`, { headers: { authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(HERMES_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`Hermes answered ${res.status} for feed ${feedId.slice(0, 8)}: ${(await res.text()).slice(0, 80)}`);
  const body = (await res.json()) as { binary: { data: string[] }; parsed: { id: string; price: { price: string; conf: string; expo: number; publish_time: number } }[] };
  const p = body.parsed[0].price;
  // `full: true` is an assertion about the account a post WOULD create, not something Hermes reports: the receiver's post_update
  // writes Full verification only after the VAA is fully verified (the pre-txs). buildPlantingTx therefore re-reads the posted
  // account (byte 40, the feed, the age) after the pre-txs land, and computes the floor from that read, never from this flag.
  return { data: body.binary.data, price: { feedId: body.parsed[0].id.replace(/^0x/, ""), price: BigInt(p.price), conf: BigInt(p.conf), exponent: p.expo, publishTime: BigInt(p.publish_time), full: true } };
}

/** web3.js instruction -> kit instruction; every signer key must be in `signers` (the puller or an ephemeral keypair the SDK made). */
export function toKitInstruction(ix: TransactionInstruction, signers: Map<string, TransactionSigner>): Instruction {
  return {
    programAddress: address(ix.programId.toBase58()),
    accounts: ix.keys.map((k) => {
      const key = k.pubkey.toBase58();
      const role = k.isSigner ? (k.isWritable ? AccountRole.WRITABLE_SIGNER : AccountRole.READONLY_SIGNER) : k.isWritable ? AccountRole.WRITABLE : AccountRole.READONLY;
      if (!k.isSigner) return { address: address(key), role };
      const signer = signers.get(key);
      if (!signer) throw new Error(`no signer for ${key}`);
      return { address: address(key), role, signer };
    }),
    data: new Uint8Array(ix.data),
  } as Instruction;
}

const MAX_TX_BYTES = 1232;
/**
 * SKR posting (contracts 10 item 15, 10-05): @pythnetwork/pyth-solana-receiver@0.16.0, loaded lazily so Anchor loads only on a run
 * that posts (a leashed SKR planting), never on the routes that merely import lib/leash. Through `require` (its CJS build), because
 * its ESM build cannot load: @pythnetwork/solana-utils 0.6.0's jito.mjs imports `jito-ts/dist/sdk/block-engine/types` without an
 * extension (ERR_MODULE_NOT_FOUND under Node ESM, measured 10-05). The type comes from the package's own declarations.
 * `next build` BUNDLES it (webpack resolves createRequire(import.meta.url) to its own module id; nothing is required from disk at
 * run time): checked 10-05 by loading the built cron route's chunk and building the post instructions from the bundled SDK.
 */
const loadReceiverSdk = (): typeof import("@pythnetwork/pyth-solana-receiver") => createRequire(import.meta.url)("@pythnetwork/pyth-solana-receiver");
/** Legs 0-6's max_age_s (the program's MAX_AGE_S_OF_LEG ceiling); the caller passes the leg's on-chain value when it has it. */
const DEFAULT_MAX_AGE_S = 60;
/** Added to the summed SDK budgets per pre-tx (the System create has no budget of its own, and the compute-budget pair costs a little). */
const CU_SLACK = 20_000;
/** The SDK's DEFAULT_TREASURY_ID (0): one stable treasury address. Written here because the package index does not export it, and
 *  an undefined treasuryId makes the SDK pick a random one (caught by the test, 10-05). */
const TREASURY_ID = 0;
const FEED_NAME: Record<string, string> = { "38846ec4d0dbe808091817f5c0d6ab8058e25422348ddf97db52b6c378a93bf9": "SKR" };
const feedLabel = (feedId: string) => FEED_NAME[feedId] ?? feedId.slice(0, 8);

export type PriceUpdate = {
  /** Puller-signed, sent in order before the planting is simulated (sendPriceTxs): the VAA write + Full verify, post_update, the VAA close. */
  preTxs: SignedTx[];
  /** Contracts 3.2 row 2b put post_update in the planting tx; measured 10-05 it does not fit there (see buildPriceUpdate), so it is
   *  always in `preTxs` and this is null. Kept so the planting's slot stays one line if a later shape fits it. */
  postIx: Instruction | null;
  /** The fresh PriceUpdateV2 account post_update writes: the leash pull/settle read it as the leg's price account. */
  account: Address;
  /** After the planting (cleanupPlanting): reclaim the price account's rent. */
  closeIxs: Instruction[];
  /** When the pre-txs fail midway: close the VAA account and reclaim the price account, each sent alone (either may not exist). */
  rescueIxs: Instruction[];
  /** Hermes's parsed price (what the post will write); the planting re-reads the posted account before it trusts it. */
  price: ParsedPrice;
  /** Each pre-tx's serialized size, for the go-live gate's lines. */
  preTxBytes: number[];
};

/**
 * Contracts 10 item 15 (10-05, the crypto-entitled key): a posted, FULLY verified price for a leg with no sponsored account (SKR, leg 0).
 * The Hermes update is refused before anything is built when the program would refuse it at pull: another feed, already
 * `maxAgeS - FRESH_MARGIN_S` old (the sponsored path's margin: the time to land the pre-txs, build, simulate and send), or over the
 * conf cap / p_low (priceRefusal). Otherwise the receiver SDK's `buildPostPriceUpdateInstructions` gives: System create + Wormhole
 * init/write of the encoded VAA, `verify_encoded_vaa_v1` (Full: every signature against the guardian set; the receiver then writes
 * byte 40 = 1), the receiver's `post_update` into a fresh keypair account, and the closes. They are packed in order into as few
 * puller-paid pre-txs as fit 1,232 B (measured 10-05 on a real SKR update: 2), each with its own CU limit; the VAA close rides the
 * last pre-tx (the VAA is not needed once posted), so only the price account waits for the planting. Treasury 0, not the SDK's random
 * one: one stable address. No user funds move in any of them.
 *
 * Why post_update is NOT in the planting tx (contracts 3.2 row 2b said it would be): the leashed SKR planting computes to 871 B with
 * the Sprouts ALT (RESULTS.md, 10-04), and post_update adds its ~340 B of data (an 85 B message and a 12-hash proof), the fresh
 * account's 64 B signature and 3 accounts outside every table: about 1,370 B. The leash checks a posted account exactly like a
 * sponsored one (owner, 134 B, Full, pinned feed, age), so the price account landing one tx earlier changes no guarantee.
 */
export async function buildPriceUpdate(a: { puller: TransactionSigner; feedId: string; maxAgeS?: number; confCapBps?: number; nowS?: number }): Promise<PriceUpdate> {
  const label = feedLabel(a.feedId);
  const u = await fetchHermesUpdate(a.feedId);
  if (u.price.feedId !== a.feedId) throw new Error(`Hermes answered feed ${u.price.feedId.slice(0, 8)} for ${a.feedId.slice(0, 8)}: refused`);
  if (u.data.length !== 1) throw new Error(`Hermes answered ${u.data.length} updates for ${label}, expected 1`);
  const freshS = (a.maxAgeS ?? DEFAULT_MAX_AGE_S) - FRESH_MARGIN_S;
  const age = (a.nowS ?? Math.floor(Date.now() / 1000)) - Number(u.price.publishTime);
  if (age >= freshS) throw new Error(`Hermes ${label} price is ${age} s old (usable under ${freshS} s): nothing posted`);
  const why = priceRefusal(u.price, a.confCapBps ?? CONF_CAP_BPS);
  if (why) throw new Error(`Hermes ${label} price refused: ${why}: nothing posted`);

  const { PythSolanaReceiver } = loadReceiverSdk();
  const pullerKey = new PublicKey(a.puller.address);
  const refuse = async (): Promise<never> => { throw new Error("the Pyth SDK never signs: the kit signs every pre-tx"); };
  // The SDK wants an Anchor wallet only for its public key (payer, write authority), and a connection only for the VAA account's
  // rent (Anchor's createInstruction): both answered here, the rent through the API's own RPC. Nothing else is called while building.
  const connection = { commitment: "confirmed", getMinimumBalanceForRentExemption: async (bytes: number) => Number(await rpc().getMinimumBalanceForRentExemption(BigInt(bytes)).send()) };
  const receiver = new PythSolanaReceiver({ connection: connection as never, wallet: { publicKey: pullerKey, signTransaction: refuse, signAllTransactions: refuse } as never, treasuryId: TREASURY_ID });
  const built = await receiver.buildPostPriceUpdateInstructions(u.data);
  const accountKey = built.priceFeedIdToPriceUpdateAccount[`0x${a.feedId}`];
  if (!accountKey) throw new Error(`the Pyth SDK posted no account for feed ${a.feedId.slice(0, 8)}`);
  const account = address(accountKey.toBase58());

  // Every signer the SDK asks for: the puller and its ephemeral keypairs (the VAA account, the price account).
  const signers = new Map<string, TransactionSigner>([[a.puller.address, a.puller]]);
  const addSigners = async (ks: Signer[] | undefined) => { for (const k of ks ?? []) signers.set(k.publicKey.toBase58(), await createKeyPairSignerFromPrivateKeyBytes(k.secretKey.slice(0, 32))); };
  for (const x of [...built.postInstructions, ...built.closeInstructions]) await addSigners(x.signers);
  const kit = (x: { instruction: TransactionInstruction; computeUnits?: number }) => ({ ix: toKitInstruction(x.instruction, signers), cu: x.computeUnits ?? 0 });
  const isProgram = (x: { instruction: TransactionInstruction }, p: Address) => x.instruction.programId.toBase58() === p;
  const closeVaa = built.closeInstructions.filter((x) => !isProgram(x, PYTH_RECEIVER)).map(kit);
  const reclaim = built.closeInstructions.filter((x) => isProgram(x, PYTH_RECEIVER)).map(kit);
  if (closeVaa.length !== 1 || reclaim.length !== 1) throw new Error(`the Pyth SDK gave ${built.closeInstructions.length} close instructions, expected the VAA close and one reclaim`);

  // Greedy, in order: a pre-tx takes the next instruction while the whole tx (with its compute-budget pair) still fits.
  const items = [...built.postInstructions.map(kit), ...closeVaa];
  const groups: (typeof items)[] = [];
  for (const item of items) {
    const last = groups[groups.length - 1];
    if (last && sizeOf(a.puller, withBudget([...last, item])) <= MAX_TX_BYTES) last.push(item);
    else {
      if (sizeOf(a.puller, withBudget([item])) > MAX_TX_BYTES) throw new Error(`a Pyth instruction alone is over ${MAX_TX_BYTES} B`);
      groups.push([item]);
    }
  }
  const { value: lifetime } = await rpc().getLatestBlockhash().send();
  const preTxs: SignedTx[] = [];
  for (const g of groups) preTxs.push(await signTransactionMessageWithSigners(message(a.puller, withBudget(g), lifetime)));
  return { preTxs, postIx: null, account, closeIxs: reclaim.map((x) => x.ix), rescueIxs: [closeVaa[0].ix, reclaim[0].ix], price: u.price, preTxBytes: preTxs.map((t) => getTransactionEncoder().encode(t).length) };
}

type Budgeted = { ix: Instruction; cu: number };
const withBudget = (g: Budgeted[]): Instruction[] => [
  getSetComputeUnitLimitInstruction({ units: g.reduce((s, x) => s + x.cu, 0) + CU_SLACK }), getSetComputeUnitPriceInstruction({ microLamports: 1_000n }), ...g.map((x) => x.ix),
];
/** A placeholder lifetime for sizing (a blockhash is 32 bytes whatever its value). */
const SIZING_LIFETIME = { blockhash: "11111111111111111111111111111111" as Blockhash, lastValidBlockHeight: 0n };
function message(payer: TransactionSigner, ixs: Instruction[], lifetime: { blockhash: Blockhash; lastValidBlockHeight: bigint }) {
  return pipe(createTransactionMessage({ version: 0 }), (m) => setTransactionMessageFeePayerSigner(payer, m), (m) => setTransactionMessageLifetimeUsingBlockhash(lifetime, m), (m) => appendTransactionMessageInstructions(ixs, m));
}
/** The serialized size of an unsigned v0 tx (every signature slot counts its 64 bytes). */
const sizeOf = (payer: TransactionSigner, ixs: Instruction[]) => getTransactionEncoder().encode(compileTransaction(message(payer, ixs, SIZING_LIFETIME))).length;

/** Sends the pre-txs in order and waits for each (a later one needs the earlier one's account). */
export async function sendPriceTxs(txs: SignedTx[]): Promise<void> {
  const send = sendAndConfirmTransactionFactory({ rpc: rpc(), rpcSubscriptions: createSolanaRpcSubscriptions(config().heliusRpcUrl.replace("https://", "wss://")) });
  for (const tx of txs) {
    assertIsTransactionWithBlockhashLifetime(tx);
    await send(tx, { commitment: "confirmed" });
  }
}
