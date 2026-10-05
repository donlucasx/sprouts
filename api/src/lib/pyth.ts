import {
  AccountRole, address, createSolanaRpcSubscriptions, sendAndConfirmTransactionFactory,
  signTransactionMessageWithSigners, assertIsTransactionWithBlockhashLifetime, type Address, type Instruction, type TransactionSigner,
} from "@solana/kit";
import { type TransactionInstruction } from "@solana/web3.js";
// AMEND 10-04 s20 (R324): no @pythnetwork/pyth-solana-receiver import (posting deferred).
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

/** The account if it is receiver-owned; null otherwise. A receiver-owned account with the wrong length or discriminator throws. */
export async function readPriceAccount(account: Address): Promise<ParsedPrice | null> {
  const info = await rpc().getAccountInfo(account, { encoding: "base64" }).send();
  if (!info.value || info.value.owner !== PYTH_RECEIVER) return null;
  return parsePriceUpdate(new Uint8Array(Buffer.from(info.value.data[0], "base64")));
}
export async function readSponsoredPrice(account: Address): Promise<ParsedPrice> {
  const p = await readPriceAccount(account);
  if (!p) throw new Error(`price account ${account} is missing or not the receiver's`);
  return p;
}

/** Hermes latest update for one feed (base64 VAAs + the parsed price). Bearer auth; a 401/403 throws and the leg skips the day.
 *  Kept for a future SKR source (R324); the key is optional, so a missing PYTH_API_KEY throws here, never at config(). */
export async function fetchHermesUpdate(feedId: string): Promise<{ data: string[]; price: ParsedPrice }> {
  const key = config().pythApiKey;
  if (!key) throw new Error("PYTH_API_KEY is not set: Hermes posting is deferred (R324)");
  const res = await fetch(`${PYTH_HERMES}/v2/updates/price/latest?ids[]=${feedId}&encoding=base64&parsed=true`, { headers: { authorization: `Bearer ${key}` } });
  if (!res.ok) throw new Error(`Hermes answered ${res.status} for feed ${feedId.slice(0, 8)}: ${(await res.text()).slice(0, 80)}`);
  const body = (await res.json()) as { binary: { data: string[] }; parsed: { id: string; price: { price: string; conf: string; expo: number; publish_time: number } }[] };
  const p = body.parsed[0].price;
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

/**
 * AMEND 10-04 s20 (R324): posting is DEFERRED. The owner's Pyth key is 403 for every crypto feed, and R324 reads cbBTC from its
 * sponsored account, so no leg posts and the Pyth receiver SDK is not a dependency. The contracts 3.1 shape stays so the planting
 * code's dormant "post" branch compiles; `priceSourceFor` never answers "post", so this never runs. A future SKR source (a
 * crypto-entitled key, contracts 10 item 15) re-implements it from the API plan's Task 8 10-04 text.
 */
export async function buildPriceUpdate(a: { puller: TransactionSigner; feedId: string }): Promise<{ preTxs: SignedTx[]; postIx: Instruction; account: Address; closeIxs: Instruction[]; price: ParsedPrice }> {
  throw new Error(`price posting is deferred (R324): no posted price for feed ${a.feedId.slice(0, 8)}`);
}

/** Sends the pre-txs in order and waits for each (a later one needs the earlier one's account). */
export async function sendPriceTxs(txs: SignedTx[]): Promise<void> {
  const send = sendAndConfirmTransactionFactory({ rpc: rpc(), rpcSubscriptions: createSolanaRpcSubscriptions(config().heliusRpcUrl.replace("https://", "wss://")) });
  for (const tx of txs) {
    assertIsTransactionWithBlockhashLifetime(tx);
    await send(tx, { commitment: "confirmed" });
  }
}
