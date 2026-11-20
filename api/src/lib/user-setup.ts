import { createNoopSigner, getBase64Encoder, type Address, type Instruction } from "@solana/kit";
import { ASSOCIATED_TOKEN_PROGRAM_ADDRESS, findAssociatedTokenPda, getCreateAssociatedTokenIdempotentInstruction, TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import { COINS, type LiveAsset } from "@/domain/coins";
import type { Rules } from "@/domain/roundup";
import { KLEND, JLEND } from "./venues/addresses";
import { plantingTarget } from "./plant-run";
import { SYSTEM_PROGRAM } from "./constants";
import { rpc } from "./rpc";

/**
 * User-paid coin account rent (Task 17a, docs/superpowers/specs/2026-11-19-user-rent-design.md): an optional LEADING block of "setup"
 * creates, CreateIdempotent of the user's own classic ATA for one of 7 mints, payer = owner = the user. Opt-in only: the app asks with a
 * count (link `?setup=N`, relink and top-up body `setupMax`), so 0.1.11 / 0.1.12 get today's bytes. The app peels the block off before its
 * own checks (sign.ts takeSetup, Task 17b); `takeSetupPrefix` below is the server's mirror, used by /api/topup/confirm.
 * A setup can never be the reason a link or top-up fails: too little SOL, a failed read, too big, or a failed simulation drops it.
 */

/** Rent for a 165-byte token account (was lib/moves.ts's own constant). */
export const ATA_RENT_LAMPORTS = 2_039_280;
/** Kept on top of the creates' rent for a link or relink: ~0.01 SOL for the approval's own rent and fee, ~0.01 SOL for later fees. */
export const SETUP_SOL_MARGIN = 20_000_000;
/** The most creates a link or relink carries (all 7 mints), and a top-up (a fourth would not fit beside Jupiter's route). */
export const SETUP_MAX = 7;
export const TOPUP_SETUP_MAX = 3;
/** Added to Jupiter's SetComputeUnitLimit per create (rewritten in place, never a second limit), capped at the per-transaction maximum. */
export const SETUP_CU_PER_CREATE = 25_000;
export const MAX_CU_LIMIT = 1_400_000;
export const MAX_WIRE_BYTES = 1232;

/** Founder D1: a lending coin brings both venues' receipts (the venue is picked at run time). SKR needs none (staked from the puller). */
export const SETUP_MINTS_BY_ASSET: Readonly<Record<LiveAsset, readonly Address[]>> = Object.freeze({
  SKR: Object.freeze([]),
  stORE: Object.freeze([COINS.stORE.mint]),
  hSOL: Object.freeze([COINS.hSOL.mint]),
  cbBTC: Object.freeze([COINS.cbBTC.mint]),
  USDC_LEND: Object.freeze([KLEND.USDC_LEND.collateralMint, JLEND.USDC_LEND.fTokenMint]),
  SOL_LEND: Object.freeze([KLEND.SOL_LEND.collateralMint, JLEND.SOL_LEND.fTokenMint]),
});
/** The design's table order: the tie-break after the target share. */
const TABLE_ORDER: readonly LiveAsset[] = ["stORE", "hSOL", "cbBTC", "USDC_LEND", "SOL_LEND"];
export const SETUP_MINTS: readonly Address[] = Object.freeze(TABLE_ORDER.flatMap((a) => SETUP_MINTS_BY_ASSET[a]));

/** A setup block the server will not accept (the confirm answers its usual "not a top-up"). */
export class SetupRefused extends Error {
  constructor(why: string) {
    super(`Setup refused: ${why}`);
    this.name = "SetupRefused";
  }
}

const ATA = ASSOCIATED_TOKEN_PROGRAM_ADDRESS as string;
const ATA_CREATE_IDEMPOTENT = 1;
const userAta = async (user: string, mint: string) => (await findAssociatedTokenPda({ owner: user as Address, mint: mint as Address, tokenProgram: TOKEN_PROGRAM_ADDRESS }))[0] as string;

/**
 * The setup mints of the coins switched on, most-used first: "switched on" = the run's own target before slow opening
 * (plantingTarget(rules, [])), so a coin that would wait is set up too. Ties in table order. A null or broken target: none.
 */
export function setupOrder(rules: Pick<Rules, "allocation" | "pins" | "managed" | "stop">): Address[] {
  let target;
  try {
    target = plantingTarget(rules, []);
  } catch {
    return [];
  }
  if (!target) return [];
  const t = target;
  return TABLE_ORDER.filter((a) => t[a] > 0)
    .sort((x, y) => t[y] - t[x] || TABLE_ORDER.indexOf(x) - TABLE_ORDER.indexOf(y))
    .flatMap((a) => SETUP_MINTS_BY_ASSET[a]);
}

/** setupOrder's mints whose classic ATA for `user` does not exist: ONE getMultipleAccounts read (none when nothing is switched on). Throws on a failed read. */
export async function missingSetupMints(user: Address, rules: Pick<Rules, "allocation" | "pins" | "managed" | "stop">): Promise<Address[]> {
  const mints = setupOrder(rules);
  if (mints.length === 0) return [];
  const atas = await Promise.all(mints.map((m) => userAta(user, m)));
  const { value } = await rpc().getMultipleAccounts(atas as Address[], { encoding: "base64", commitment: "confirmed" }).send();
  return mints.filter((_, i) => !value[i]);
}

/** CreateIdempotent of `user`'s own classic ATA per mint, paid by `user`: accounts [payer, ata, owner, mint, system, token], data [1]. */
export async function setupCreates(user: Address, mints: readonly Address[]): Promise<Instruction[]> {
  const payer = createNoopSigner(user);
  return Promise.all(mints.map(async (mint) => getCreateAssociatedTokenIdempotentInstruction({ payer, ata: (await userAta(user, mint)) as Address, owner: user, mint })));
}

/**
 * The server mirror of the app's takeSetup (sign.ts, Task 17b): peels the LEADING run of ATA-program instructions whose mint slot is a
 * setup mint; each must be exactly CreateIdempotent ([1]) of `user`'s own classic ATA, paid by `user`, accounts
 * [user, ata(user, mint), user, mint, system, token], each mint once, at most `max` (an integer 0..SETUP_MAX). Returns the rest, which
 * the flow's own check reads unchanged; a setup create later in the transaction stays in the rest (and the flow's check refuses it).
 */
export async function takeSetupPrefix<T extends { program: string; accounts: readonly string[]; data: Uint8Array }>(ixs: readonly T[], user: string, max: number): Promise<T[]> {
  if (!Number.isInteger(max) || max < 0 || max > SETUP_MAX) throw new SetupRefused(`max ${max} is not 0..${SETUP_MAX}`);
  const seen = new Set<string>();
  let i = 0;
  while (i < ixs.length && ixs[i].program === ATA && (SETUP_MINTS as readonly string[]).includes(ixs[i].accounts[3])) {
    const ix = ixs[i];
    const mint = ix.accounts[3];
    if (ix.data.length !== 1 || ix.data[0] !== ATA_CREATE_IDEMPOTENT) throw new SetupRefused("a setup instruction that is not CreateIdempotent");
    if (seen.has(mint)) throw new SetupRefused(`the ${mint} account is created twice`);
    const want = [user, await userAta(user, mint), user, mint, SYSTEM_PROGRAM, TOKEN_PROGRAM_ADDRESS] as string[];
    if (ix.accounts.length !== want.length || want.some((w, k) => ix.accounts[k] !== w)) throw new SetupRefused("a setup create that is not the wallet's own classic account, paid by the wallet");
    seen.add(mint);
    i++;
  }
  if (i > max) throw new SetupRefused(`${i} setup creates, more than ${max}`);
  return ixs.slice(i);
}

/** A base64 wire transaction's size in bytes. */
export const wireBytes = (b64: string): number => getBase64Encoder().encode(b64).length;

/**
 * Compiles with all `creates`, and while the wire is over `maxBytes` drops the LAST create and compiles again. None fits: `used` 0 and
 * no transaction (the caller builds its own without any, as today; no throwaway compile here).
 */
export async function fitSetup(compile: (creates: readonly Instruction[]) => Promise<string> | string, creates: readonly Instruction[], maxBytes = MAX_WIRE_BYTES): Promise<{ transaction: string; used: number } | { transaction: null; used: 0 }> {
  for (let k = creates.length; k > 0; k--) {
    const transaction = await compile(creates.slice(0, k));
    if (wireBytes(transaction) <= maxBytes) return { transaction, used: k };
  }
  return { transaction: null, used: 0 };
}

/** A link's `setup=N` (digits) or a relink's `setupMax` (a JSON number): an integer 1..SETUP_MAX, anything else 0. */
export function setupCount(raw: string | number, cap = SETUP_MAX): number {
  const n = typeof raw === "string" && /^\d+$/.test(raw) ? Number(raw) : raw;
  return typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= cap ? n : 0;
}

/** The link and relink SOL rule (design 3): all `n` creates only when the wallet keeps n x rent + SETUP_SOL_MARGIN; never a part. */
export const linkSetupCovered = (lamports: bigint, n: number): boolean => lamports >= BigInt(n) * BigInt(ATA_RENT_LAMPORTS) + BigInt(SETUP_SOL_MARGIN);

/**
 * The creates a builder prepends: up to `max` of the user's missing setup accounts, all of them or none by `covered(n)` (the flow's SOL
 * rule). Any failure (rules, chain) is no setup, logged: a setup never blocks the flow.
 */
export async function plannedSetup(user: Address, rules: () => Promise<Pick<Rules, "allocation" | "pins" | "managed" | "stop">>, max: number, covered: (n: number) => Promise<boolean> | boolean): Promise<Instruction[]> {
  if (!(max > 0)) return [];
  try {
    const missing = await missingSetupMints(user, await rules());
    const n = Math.min(max, missing.length);
    if (n === 0 || !(await covered(n))) return [];
    return await setupCreates(user, missing.slice(0, n));
  } catch (e) {
    console.error(`user setup: none for ${user} (${e instanceof Error ? e.message : String(e)})`);
    return [];
  }
}
