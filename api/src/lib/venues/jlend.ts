import { AccountRole, createNoopSigner, getAddressDecoder, type Address, type Instruction, type TransactionSigner } from "@solana/kit";
import { ASSOCIATED_TOKEN_PROGRAM_ADDRESS, findAssociatedTokenPda, getBurnInstruction, getCloseAccountInstruction, getCreateAssociatedTokenIdempotentInstruction, getTransferInstruction, TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
// PREFLIGHT 10-04 s20 (Kimi F3, refuted): token 0.17.0's CloseAccount takes `owner` (closeAccount.d.ts:32); Burn/Transfer take `authority`. Keep both as written.
import { JLEND, JLEND_LENDING_ADMIN, JLEND_LIQUIDITY } from "./addresses";
import { JLEND_LIQUIDITY_PROGRAM, JLEND_PROGRAM, SYSTEM_PROGRAM, USDC_MINT, WSOL_MINT } from "../constants";
import { rpc } from "../rpc";
import type { LendAsset } from "@/domain/coins";
import type { Simulation } from "../plant-run";

const hex = (h: string) => Buffer.from(h, "hex");
const DISC = { mint: hex("065e457a1eb392ab"), deposit: hex("f223c68952e1f2b6"), redeem: hex("b80c569546c461e1"), lending: hex("87c75210f983b6f1") };
export const LENDING_LEN = 196;
const PRICE_SCALE = 1_000_000_000_000n;
/** Shares left in the puller's jl account after transferring N - 1: 0 per research 26 (N - 1 minted, 4/4); the leash track's Task 7 confirms. */
export const JL_EXPECTED_LEFTOVER: 0n | 1n = 0n;
const dec = getAddressDecoder();
const u64 = (v: bigint) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(v); return b; };
const TOKEN = TOKEN_PROGRAM_ADDRESS as string;
const ro = (address: Address) => ({ address, role: AccountRole.READONLY });
const rw = (address: Address) => ({ address, role: AccountRole.WRITABLE });
const ws = (s: TransactionSigner) => ({ address: s.address, role: AccountRole.WRITABLE_SIGNER, signer: s });
const ata = async (owner: Address, mint: Address) => (await findAssociatedTokenPda({ owner, mint, tokenProgram: TOKEN_PROGRAM_ADDRESS }))[0];

/** Contracts 2.7 JLEND reader (verified 10-04: 1.062915 == the API's convertToAssets). */
export function readJlendRate(data: Uint8Array, asset: LendAsset): { rn: bigint; rd: bigint } {
  const b = Buffer.from(data);
  if (b.length !== LENDING_LEN) throw new Error(`Jupiter Lend lending account refused: ${b.length} bytes, expected ${LENDING_LEN}`);
  if (!b.subarray(0, 8).equals(DISC.lending)) throw new Error("Jupiter Lend lending account refused: discriminator");
  if (dec.decode(b.subarray(8, 40)) !== JLEND[asset].mint) throw new Error("Jupiter Lend lending account refused: another underlying mint");
  if (dec.decode(b.subarray(40, 72)) !== JLEND[asset].fTokenMint) throw new Error("Jupiter Lend lending account refused: another f-token mint");
  const rn = b.readBigUInt64LE(115);
  if (rn === 0n) throw new Error("Jupiter Lend lending account refused: zero exchange price");
  return { rn, rd: PRICE_SCALE };
}

export async function jlendRate(asset: LendAsset): Promise<{ rn: bigint; rd: bigint }> {
  const info = await rpc().getAccountInfo(JLEND[asset].lending, { encoding: "base64" }).send();
  if (!info.value) throw new Error(`Jupiter Lend lending ${JLEND[asset].lending} missing`);
  if (info.value.owner !== JLEND_PROGRAM) throw new Error(`Jupiter Lend lending owner is ${info.value.owner}`);
  return readJlendRate(new Uint8Array(Buffer.from(info.value.data[0], "base64")), asset);
}

/** Shares worth 2 bp under the deposit, so `max_assets` = the deposit still covers the rate's accrual between build and land. */
export const jlendShares = (depositRaw: bigint, rn: bigint): bigint => (((depositRaw * 9_998n) / 10_000n) * PRICE_SCALE) / rn;

function jlendIx17(disc: Buffer, args: Buffer, a: { signer: TransactionSigner; depositor: Address; recipient: Address; asset: LendAsset }): Instruction {
  const j = JLEND[a.asset];
  return {
    programAddress: JLEND_PROGRAM,
    accounts: [ws(a.signer), rw(a.depositor), rw(a.recipient), ro(j.mint), ro(JLEND_LENDING_ADMIN), rw(j.lending), rw(j.fTokenMint), rw(j.supplyTokenReservesLiquidity), rw(j.lendingSupplyPositionOnLiquidity),
      ro(j.rateModel), rw(j.vault), rw(JLEND_LIQUIDITY), ro(JLEND_LIQUIDITY_PROGRAM), ro(j.rewardsRateModel), ro(TOKEN_PROGRAM_ADDRESS), ro(ASSOCIATED_TOKEN_PROGRAM_ADDRESS), ro(SYSTEM_PROGRAM)],
    data: new Uint8Array(Buffer.concat([disc, args])),
  } as Instruction;
}
export const jlendMintIx = (a: { puller: TransactionSigner; asset: LendAsset; source: Address; pullerJl: Address; shares: bigint; maxAssets: bigint }) =>
  jlendIx17(DISC.mint, Buffer.concat([u64(a.shares), u64(a.maxAssets)]), { signer: a.puller, depositor: a.source, recipient: a.pullerJl, asset: a.asset });

export const pullerSourceOf = (puller: Address, asset: LendAsset) => ata(puller, asset === "USDC_LEND" ? USDC_MINT : WSOL_MINT);

/**
 * Contracts 3.2 step 5b. Jupiter Lend refuses a recipient the signer does not own (ConstraintTokenOwner, research 26), so the shares
 * land in the puller's jl account, N - 1 move to the user's canonical jl account, a `leftover` of 1 (when the venue minted N) is
 * burned, and CloseAccount asserts zero residue on chain. Foreign dust already there is burned first (Claude audit F9).
 */
export async function buildJlendDepositIxs(a: { puller: TransactionSigner; user: Address; asset: LendAsset; depositRaw: bigint; rn: bigint; pullerJlBalance: bigint; leftover: 0n | 1n }): Promise<{ ixs: Instruction[]; shares: bigint; minOutRaw: bigint; pullerJl: Address }> {
  const j = JLEND[a.asset];
  const pullerJl = await ata(a.puller.address, j.fTokenMint);
  const userJl = await ata(a.user, j.fTokenMint);
  const shares = jlendShares(a.depositRaw, a.rn);
  if (shares < 2n) throw new Error(`Jupiter Lend deposit of ${a.depositRaw} buys ${shares} shares`);
  const ixs: Instruction[] = [
    getCreateAssociatedTokenIdempotentInstruction({ payer: a.puller, ata: pullerJl, owner: a.puller.address, mint: j.fTokenMint }),
    getCreateAssociatedTokenIdempotentInstruction({ payer: a.puller, ata: userJl, owner: a.user, mint: j.fTokenMint }),
    ...(a.pullerJlBalance > 0n ? [getBurnInstruction({ account: pullerJl, mint: j.fTokenMint, authority: a.puller, amount: a.pullerJlBalance }) as Instruction] : []),
    jlendMintIx({ puller: a.puller, asset: a.asset, source: await pullerSourceOf(a.puller.address, a.asset), pullerJl, shares, maxAssets: a.depositRaw }),
    getTransferInstruction({ source: pullerJl, destination: userJl, authority: a.puller, amount: shares - 1n }) as Instruction,
    ...(a.leftover === 1n ? [getBurnInstruction({ account: pullerJl, mint: j.fTokenMint, authority: a.puller, amount: 1n }) as Instruction] : []),
    getCloseAccountInstruction({ account: pullerJl, destination: a.puller.address, owner: a.puller }) as Instruction,
  ];
  return { ixs, shares, minOutRaw: shares - 1n, pullerJl };
}

const refuse = (why: string): never => { throw new Error(`Jupiter Lend refused: ${why}`); };
const addrs = (ix: Instruction) => (ix.accounts ?? []).map((x) => x.address as string);

/**
 * Contracts 3.3: one mint_with_max_assets with every account pinned; Token instructions on the puller's jl account limited to: a Burn of
 * foreign dust before the mint, one Transfer to the user's canonical jl account, at most one Burn of exactly 1 share after it, one
 * CloseAccount to the puller last.
 */
export async function checkJlendDepositInstructions(ixs: readonly Instruction[], a: { puller: Address; user: Address; asset: LendAsset }): Promise<void> {
  const j = JLEND[a.asset];
  const pullerJl = await ata(a.puller, j.fTokenMint);
  const userJl = await ata(a.user, j.fTokenMint);
  const source = await pullerSourceOf(a.puller, a.asset);
  const mine = ixs.filter((ix) => ix.programAddress === JLEND_PROGRAM);
  if (mine.length !== 1) refuse(`expected one mint, found ${mine.length} Jupiter Lend instructions`);
  const mint = mine[0];
  const d = Buffer.from(mint.data ?? []);
  if (d.length !== 24 || !d.subarray(0, 8).equals(DISC.mint)) refuse("not mint_with_max_assets");
  const want = [a.puller, source, pullerJl, j.mint, JLEND_LENDING_ADMIN, j.lending, j.fTokenMint, j.supplyTokenReservesLiquidity, j.lendingSupplyPositionOnLiquidity, j.rateModel, j.vault, JLEND_LIQUIDITY, JLEND_LIQUIDITY_PROGRAM, j.rewardsRateModel, TOKEN, ASSOCIATED_TOKEN_PROGRAM_ADDRESS, SYSTEM_PROGRAM] as string[];
  const got = addrs(mint);
  if (got.length !== want.length || got.some((x, i) => x !== want[i])) refuse("mint accounts are not the pinned ones");
  const mintAt = ixs.indexOf(mint);
  let transferAt = -1;
  let burnsAfter = 0;
  let closes = 0;
  for (const [i, ix] of ixs.entries()) {
    if (ix.programAddress !== TOKEN || addrs(ix)[0] !== pullerJl) continue;
    const tag = ix.data?.[0];
    const acc = addrs(ix);
    const amount = ix.data && ix.data.length >= 9 ? Buffer.from(ix.data).readBigUInt64LE(1) : null;
    if (tag === 8 && acc[1] === j.fTokenMint && acc[2] === a.puller && i < mintAt) continue;   // foreign dust, before the mint
    if (tag === 3) {
      if (acc[1] !== userJl || acc[2] !== a.puller || i < mintAt || transferAt >= 0) refuse(`a transfer from the puller's jl account to ${acc[1]}, not one transfer to the user's canonical account`);
      transferAt = i;
      continue;
    }
    if (tag === 8 && i > transferAt && transferAt >= 0) {
      if (amount !== 1n || acc[1] !== j.fTokenMint || acc[2] !== a.puller || burnsAfter > 0) refuse(`a burn of ${amount} after the transfer: only the 1-share leftover may be burned`);
      burnsAfter++;
      continue;
    }
    if (tag === 9 && acc[1] === a.puller && acc[2] === a.puller && i > transferAt && transferAt >= 0) { closes++; continue; }
    refuse(`Token instruction ${tag} on the puller's jl account is not allowed here`);
  }
  if (transferAt < 0) refuse("no transfer to the user");
  if (closes !== 1) refuse(`expected one close of the puller's jl account after the transfer, found ${closes}`);
}

/** Contracts 3.3: the user's jl account gained min_out AND the puller's jl account is absent after (closed: zero residue). */
export function jlendDeliveryShortfall(sim: Simulation & { watched?: Record<string, { pre: bigint | null; post: bigint | null }> }, built: { minOutRaw: bigint; pullerJl: Address | null }): string | null {
  if (!sim.delivery) return "the simulation returned no delivery balance";
  const change = sim.delivery.post - sim.delivery.pre;
  if (change < built.minOutRaw) return `the user's jl account gained ${change}, under the minimum ${built.minOutRaw}`;
  if (!built.pullerJl || !sim.watched || !(built.pullerJl in sim.watched)) return "the simulation returned no watched balance for the puller's jl account";
  return sim.watched[built.pullerJl].post === null ? null : `the puller's jl account still holds ${sim.watched[built.pullerJl].post} after the planting`;
}

/** Contracts 6 `withdraw_jlend`: [create the underlying ATA], redeem(receiptRaw) (18 accounts), SOL then closes WSOL to the user. */
export async function buildJlendWithdrawIxs(a: { user: Address; asset: LendAsset; receiptRaw: bigint }): Promise<Instruction[]> {
  const j = JLEND[a.asset];
  const owner = createNoopSigner(a.user);
  const underlying = await ata(a.user, j.mint);
  const redeem: Instruction = {
    programAddress: JLEND_PROGRAM,
    accounts: [ws(owner), rw(await ata(a.user, j.fTokenMint)), rw(underlying), ro(JLEND_LENDING_ADMIN), rw(j.lending), ro(j.mint), rw(j.fTokenMint), rw(j.supplyTokenReservesLiquidity), rw(j.lendingSupplyPositionOnLiquidity),
      ro(j.rateModel), rw(j.vault), rw(j.claimAccount), rw(JLEND_LIQUIDITY), ro(JLEND_LIQUIDITY_PROGRAM), ro(j.rewardsRateModel), ro(TOKEN_PROGRAM_ADDRESS), ro(ASSOCIATED_TOKEN_PROGRAM_ADDRESS), ro(SYSTEM_PROGRAM)],
    data: new Uint8Array(Buffer.concat([DISC.redeem, u64(a.receiptRaw)])),
  } as Instruction;
  const ixs: Instruction[] = [getCreateAssociatedTokenIdempotentInstruction({ payer: owner, ata: underlying, owner: a.user, mint: j.mint }), redeem];
  if (a.asset === "SOL_LEND") ixs.push(getCloseAccountInstruction({ account: underlying, destination: a.user, owner }) as Instruction);
  return ixs;
}

/** Contracts 6 move part `deposit` into Jupiter Lend: [create the jl ATA], deposit(depositRaw) (17 accounts), SOL then closes WSOL. */
export async function buildJlendUserDepositIxs(a: { user: Address; asset: LendAsset; depositRaw: bigint }): Promise<Instruction[]> {
  const j = JLEND[a.asset];
  const owner = createNoopSigner(a.user);
  const fAta = await ata(a.user, j.fTokenMint);
  const underlying = await ata(a.user, j.mint);
  const ixs: Instruction[] = [
    getCreateAssociatedTokenIdempotentInstruction({ payer: owner, ata: fAta, owner: a.user, mint: j.fTokenMint }),
    jlendIx17(DISC.deposit, u64(a.depositRaw), { signer: owner, depositor: underlying, recipient: fAta, asset: a.asset }),
  ];
  if (a.asset === "SOL_LEND") ixs.push(getCloseAccountInstruction({ account: underlying, destination: a.user, owner }) as Instruction);
  return ixs;
}
