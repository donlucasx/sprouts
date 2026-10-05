import { AccountRole, createNoopSigner, getAddressDecoder, type Address, type Instruction, type TransactionSigner } from "@solana/kit";
import { findAssociatedTokenPda, getCloseAccountInstruction, getCreateAssociatedTokenIdempotentInstruction, TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
// PREFLIGHT 10-04 s20 (Kimi F3, refuted): in the installed @solana-program/token 0.17.0 `CloseAccountInput` names its signer `owner`
// (dist/types/generated/instructions/closeAccount.d.ts:32), unlike Burn/Transfer's `authority`. Keep `owner` in every close call.
import { KLEND, KLEND_LMA, KLEND_MARKET } from "./addresses";
import { KLEND_PROGRAM, SYSVAR_INSTRUCTIONS, USDC_MINT, WSOL_MINT } from "../constants";
import { rpc } from "../rpc";
import type { LendAsset } from "@/domain/coins";
import type { Simulation } from "../plant-run";

const hex = (h: string) => Buffer.from(h, "hex");
const DISC = { refresh: hex("02da8aeb4fc91966"), deposit: hex("a9c91e7e06cd6644"), redeem: hex("ea75b57db98edc1d"), reserve: hex("2bf2ccca1af73b7f") };
export const RESERVE_LEN = 8624;
const dec = getAddressDecoder();
const addrAt = (b: Buffer, o: number) => dec.decode(b.subarray(o, o + 32)) as string;
const u128At = (b: Buffer, o: number) => b.readBigUInt64LE(o) + (b.readBigUInt64LE(o + 8) << 64n);
const u64 = (v: bigint) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(v); return b; };

export type KlendRate = { rn: bigint; rd: bigint; availableRaw: bigint };

/**
 * Contracts 2.7 KLEND reader, offsets verified on mainnet 10-04 (kUSDC 1.2038, kSOL 1.1551): underlying raw per receipt raw = rn / rd.
 * rd is the reserve's OWN collateral-supply field (@2592), not the kToken mint's supply: the leash track's S2 found a constant
 * out-of-reserve burn gap between the two, and the reserve field is what the program reads.
 */
export function readKlendRate(data: Uint8Array, asset: LendAsset): KlendRate {
  const b = Buffer.from(data);
  if (b.length !== RESERVE_LEN) throw new Error(`K-Lend reserve refused: ${b.length} bytes, expected ${RESERVE_LEN}`);
  if (!b.subarray(0, 8).equals(DISC.reserve)) throw new Error("K-Lend reserve refused: not a Reserve account");
  const k = KLEND[asset];
  if (addrAt(b, 32) !== KLEND_MARKET) throw new Error("K-Lend reserve refused: another market");
  if (addrAt(b, 128) !== k.liquidityMint) throw new Error("K-Lend reserve refused: another liquidity mint");
  if (addrAt(b, 2560) !== k.collateralMint) throw new Error("K-Lend reserve refused: another collateral mint");
  const available = b.readBigUInt64LE(224);
  // Parity with the leash's readers.rs klend_rate (GUARD:K_FEES): fees = protocol @344 + referrer @360 + pending referrer @376,
  // a u128 checked sum, and fees above borrowed is BadReader there, so it is refused here too (no clamp to zero).
  const fees = u128At(b, 344) + u128At(b, 360) + u128At(b, 376);
  const borrowed = u128At(b, 232);
  if (fees >= 1n << 128n) throw new Error("K-Lend reserve refused: fee sum overflows u128");
  if (fees > borrowed) throw new Error(`K-Lend reserve refused: fees ${fees} above borrowed ${borrowed}`);
  const rn = available + ((borrowed - fees) >> 60n);
  const rd = b.readBigUInt64LE(2592);
  if (rd === 0n || rn === 0n) throw new Error("K-Lend reserve refused: empty");
  return { rn, rd, availableRaw: available };
}

export async function klendRate(asset: LendAsset): Promise<KlendRate> {
  const info = await rpc().getAccountInfo(KLEND[asset].reserve, { encoding: "base64", commitment: "confirmed" }).send();
  if (!info.value) throw new Error(`K-Lend reserve ${KLEND[asset].reserve} missing`);
  if (info.value.owner !== KLEND_PROGRAM) throw new Error(`K-Lend reserve owner is ${info.value.owner}`);
  return readKlendRate(new Uint8Array(Buffer.from(info.value.data[0], "base64")), asset);
}

/** Contracts 3.2: floor(deposit * rd / rn) less 2 bp for the accrual between build and refresh. */
export const klendMinOut = (depositRaw: bigint, r: { rn: bigint; rd: bigint }): bigint => (((depositRaw * r.rd) / r.rn) * 9_998n) / 10_000n;

const ro = (address: Address) => ({ address, role: AccountRole.READONLY });
const rw = (address: Address) => ({ address, role: AccountRole.WRITABLE });
const signer = (s: TransactionSigner) => ({ address: s.address, role: AccountRole.READONLY_SIGNER, signer: s });

export function klendRefreshIx(asset: LendAsset): Instruction {
  const k = KLEND[asset];
  // refresh_reserve takes the K-Lend program id in the three unused oracle slots (klend-sdk output for both reserves).
  return { programAddress: KLEND_PROGRAM, accounts: [rw(k.reserve), ro(KLEND_MARKET), ro(KLEND_PROGRAM), ro(KLEND_PROGRAM), ro(KLEND_PROGRAM), ro(k.scopePrices)], data: new Uint8Array(DISC.refresh) };
}
export function klendDepositIx(a: { owner: TransactionSigner; asset: LendAsset; source: Address; destination: Address; amountRaw: bigint }): Instruction {
  const k = KLEND[a.asset];
  return {
    programAddress: KLEND_PROGRAM,
    accounts: [signer(a.owner), rw(k.reserve), ro(KLEND_MARKET), ro(KLEND_LMA), ro(k.liquidityMint), rw(k.supplyVault), rw(k.collateralMint), rw(a.source), rw(a.destination), ro(TOKEN_PROGRAM_ADDRESS), ro(TOKEN_PROGRAM_ADDRESS), ro(SYSVAR_INSTRUCTIONS)],
    data: new Uint8Array(Buffer.concat([DISC.deposit, u64(a.amountRaw)])),
  } as Instruction;
}
export function klendRedeemIx(a: { owner: TransactionSigner; asset: LendAsset; source: Address; destination: Address; amountRaw: bigint }): Instruction {
  const k = KLEND[a.asset];
  return {
    programAddress: KLEND_PROGRAM,
    accounts: [signer(a.owner), ro(KLEND_MARKET), rw(k.reserve), ro(KLEND_LMA), ro(k.liquidityMint), rw(k.collateralMint), rw(k.supplyVault), rw(a.source), rw(a.destination), ro(TOKEN_PROGRAM_ADDRESS), ro(TOKEN_PROGRAM_ADDRESS), ro(SYSVAR_INSTRUCTIONS)],
    data: new Uint8Array(Buffer.concat([DISC.redeem, u64(a.amountRaw)])),
  } as Instruction;
}

const ata = async (owner: Address, mint: Address) => (await findAssociatedTokenPda({ owner, mint, tokenProgram: TOKEN_PROGRAM_ADDRESS }))[0];
export const pullerSourceOf = (puller: Address, asset: LendAsset) => ata(puller, asset === "USDC_LEND" ? USDC_MINT : WSOL_MINT);

/** Contracts 3.2 step 5a: the user's kToken account (puller pays the rent), refresh, deposit from the puller's USDC or WSOL account. */
export async function buildKlendDepositIxs(a: { puller: TransactionSigner; user: Address; asset: LendAsset; amountRaw: bigint }): Promise<Instruction[]> {
  const k = KLEND[a.asset];
  const destination = await ata(a.user, k.collateralMint);
  return [
    getCreateAssociatedTokenIdempotentInstruction({ payer: a.puller, ata: destination, owner: a.user, mint: k.collateralMint }),
    klendRefreshIx(a.asset),
    klendDepositIx({ owner: a.puller, asset: a.asset, source: await pullerSourceOf(a.puller.address, a.asset), destination, amountRaw: a.amountRaw }),
  ];
}

const refuse = (why: string): never => { throw new Error(`K-Lend refused: ${why}`); };
const same = (ix: Instruction, want: string[]) => { const got = (ix.accounts ?? []).map((x) => x.address as string); return got.length === want.length && got.every((x, i) => x === want[i]); };

/** Contracts 3.3: program, discriminators, every account position, destination = the user's canonical kToken ATA, source = the puller's. */
export async function checkKlendDepositInstructions(ixs: readonly Instruction[], a: { puller: Address; user: Address; asset: LendAsset }): Promise<void> {
  const k = KLEND[a.asset];
  const mine = ixs.filter((ix) => ix.programAddress === KLEND_PROGRAM);
  if (mine.length !== 2) refuse(`expected refresh + deposit, found ${mine.length} K-Lend instructions`);
  const [refresh, deposit] = mine;
  const rd = Buffer.from(refresh.data ?? []);
  if (rd.length !== 8 || !rd.equals(DISC.refresh)) refuse("the first K-Lend instruction is not the refresh");
  if (!same(refresh, [k.reserve, KLEND_MARKET, KLEND_PROGRAM, KLEND_PROGRAM, KLEND_PROGRAM, k.scopePrices])) refuse("refresh accounts are not the pinned reserve's");
  const dd = Buffer.from(deposit.data ?? []);
  if (dd.length !== 16 || !dd.subarray(0, 8).equals(DISC.deposit) || dd.readBigUInt64LE(8) === 0n) refuse("the second K-Lend instruction is not a deposit");
  const source = await pullerSourceOf(a.puller, a.asset);
  const destination = await ata(a.user, k.collateralMint);
  if (!same(deposit, [a.puller, k.reserve, KLEND_MARKET, KLEND_LMA, k.liquidityMint, k.supplyVault, k.collateralMint, source, destination, TOKEN_PROGRAM_ADDRESS, TOKEN_PROGRAM_ADDRESS, SYSVAR_INSTRUCTIONS])) refuse("deposit accounts are not the pinned ones (source, destination, reserve)");
}

/** Contracts 3.3: the user's kToken account gained at least min_out in the simulation; no balance fails closed. */
export function klendDeliveryShortfall(sim: Simulation, built: { minOutRaw: bigint }): string | null {
  if (built.minOutRaw <= 0n) return `min_out ${built.minOutRaw} is not positive: the guard would pass an empty delivery`;
  if (!sim.delivery) return "the simulation returned no delivery balance";
  const change = sim.delivery.post - sim.delivery.pre;
  return change >= built.minOutRaw ? null : `the kToken account gained ${change}, under the minimum ${built.minOutRaw}`;
}

/** Contracts 6 `withdraw_klend`: [create the user's underlying ATA], refresh, redeem(receiptRaw); SOL then closes the WSOL account to the user. */
export async function buildKlendWithdrawIxs(a: { user: Address; asset: LendAsset; receiptRaw: bigint }): Promise<Instruction[]> {
  const k = KLEND[a.asset];
  const owner = createNoopSigner(a.user);
  const underlying = await ata(a.user, k.liquidityMint);
  const ixs: Instruction[] = [
    getCreateAssociatedTokenIdempotentInstruction({ payer: owner, ata: underlying, owner: a.user, mint: k.liquidityMint }),
    klendRefreshIx(a.asset),
    klendRedeemIx({ owner, asset: a.asset, source: await ata(a.user, k.collateralMint), destination: underlying, amountRaw: a.receiptRaw }),
  ];
  if (a.asset === "SOL_LEND") ixs.push(getCloseAccountInstruction({ account: underlying, destination: a.user, owner }) as Instruction);
  return ixs;
}

/** Contracts 6 move part `deposit` into K-Lend: [create the kToken ATA], refresh, deposit(depositRaw) from the user's underlying; SOL then closes WSOL. */
export async function buildKlendUserDepositIxs(a: { user: Address; asset: LendAsset; depositRaw: bigint }): Promise<Instruction[]> {
  const k = KLEND[a.asset];
  const owner = createNoopSigner(a.user);
  const kAta = await ata(a.user, k.collateralMint);
  const underlying = await ata(a.user, k.liquidityMint);
  const ixs: Instruction[] = [
    getCreateAssociatedTokenIdempotentInstruction({ payer: owner, ata: kAta, owner: a.user, mint: k.collateralMint }),
    klendRefreshIx(a.asset),
    klendDepositIx({ owner, asset: a.asset, source: underlying, destination: kAta, amountRaw: a.depositRaw }),
  ];
  if (a.asset === "SOL_LEND") ixs.push(getCloseAccountInstruction({ account: underlying, destination: a.user, owner }) as Instruction);
  return ixs;
}
