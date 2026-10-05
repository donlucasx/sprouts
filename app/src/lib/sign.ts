import {
  getAddressEncoder,
  getBase64EncodedWireTransaction,
  getBase64Encoder,
  getCompiledTransactionMessageDecoder,
  getProgramDerivedAddress,
  getTransactionDecoder,
  type Address,
  type Transaction,
} from '@solana/kit'
import { isLend, type LendAsset } from './coins'

/**
 * Security R207 #3 (10-03): the API builds every transaction and the Seed Vault key signs it, so a compromised API (or its domain)
 * could hand the phone "transfer everything" under a screen that says "Withdraw". The web page already checks what it signs
 * (api/src/lib/wallet-choice.ts); the app now checks more, per flow, before the wallet is asked: the fee payer is the user, the
 * user is the only signer, no lookup table, only the programs the API's builder uses (as top-level instructions), and the
 * instruction itself where it carries a number the screen showed (the unstake's shares and position; the approval's $5 a day to the
 * puller or, after go-live, the leash PDA), with every account list pinned in full (review of 37ab59d).
 * Anything else throws SignRefused and nothing is signed. The ids below are the API's (api/src/lib/constants.ts), copied, since the
 * app must not take them from the API it is checking.
 */
export const SKR_STAKING_PROGRAM = 'SKRskrmtL83pcL4YqLWt6iPefDqwXQWHSw9S9vz94BZ'
export const STAKE_CONFIG = '4HQy82s9CHTv1GsYKnANHMiHfhcqesYkK6sB3RDSYyqw'
export const STAKE_VAULT = '8isViKbwhuhFhsv2t8vaFL74pKCqaFPQXo1KkeQwZbB8'
export const GUARDIAN_POOL = 'DPJ58trLsF9yPrBa2pk6UaRkvqW8hWUYjawe788WBuqr'
export const SKR_MINT = 'SKRbvo6Gf7GondiT3BbTfuRDPqLWei4j2Qy2NPGZhW3'
export const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
export const SUBSCRIPTIONS_PROGRAM = 'De1egAFMkMWZSN5rYXRj9CAdheBamobVNubTsi9avR44'
export const ATA_PROGRAM = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL'
const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'
const SYSTEM_PROGRAM = '11111111111111111111111111111111'

/** Contracts 1.4 and 6: the lending venues' accounts, copied (never fetched; the app never takes an address from the API). Venue program
 * ids are app-release-coupled: a venue upgrade that moves an account needs an app update, or its Withdraw is refused. */
export const LEASH_PROGRAM = 'GyBmDLN72kg6xwAnZfj9c7fjeaJ3GvhkHNhFns83f8f7' // LEASH_PROGRAM_ID (contracts 10, Track L Task 0)
export const WSOL_MINT = 'So11111111111111111111111111111111111111112'
export const SYSVAR_INSTRUCTIONS = 'Sysvar1nstructions1111111111111111111111111'
export const KLEND_PROGRAM = 'KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD'
export const KLEND_MARKET = '7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF'
export const KLEND_LMA = '9DrvZvyWh1HuAoZxvYWMvkf2XCzryCpGgHqrMjyDWpmo'
export const KLEND_SCOPE_PRICES = '3t4JZcueEzTbVP6kLxXrL3VpWx45jDer4eqysweBchNH'
/** The PINNED reserves (spec 3: never "the best reserve in the market"). */
/** Frozen at both levels (T6 review Minor 1): a module that writes into these tables cannot loosen the check; strict mode throws. */
export const KLEND_RESERVE: Readonly<Record<LendAsset, Readonly<{ reserve: string; liquidityMint: string; supplyVault: string; collateralMint: string }>>> = Object.freeze({
  USDC_LEND: Object.freeze({ reserve: 'D6q6wuQSrifJKZYpR1M8R4YawnLDtDsMmWM1NbBmgJ59', liquidityMint: USDC_MINT, supplyVault: 'Bgq7trRgVMeq33yt235zM2onQ4bRDBsY5EWiTetF4qw6', collateralMint: 'B8V6WVjPxW1UGwVDfxH2d2r8SyT4cqn7dQRK6XneVa7D' } as const),
  SOL_LEND: Object.freeze({ reserve: 'd4A2prbA2whesmvHaL88BH6Ewn5N4bTSU2Ze8P6Bc4Q', liquidityMint: WSOL_MINT, supplyVault: 'GafNuUXj9rxGLn4y79dPu6MHSuPWeJR6UtTWuexpGh3U', collateralMint: '2UywZrUdyqs5vDchy7fKQJKau2RVyuzBev2XKGPDSiX1' } as const),
} as const)
export const JLEND_PROGRAM = 'jup3YeL8QhtSx1e253b2FDvsMNC87fDrgQZivbrndc9'
export const JLEND_LIQUIDITY_PROGRAM = 'jupeiUmn818Jg1ekPURTpr4mFo29p46vygyykFJ3wZC'
export const JLEND_LENDING_ADMIN = '5nmGjA4s7ATzpBQXC5RNceRpaJ7pYw2wKsNBWyuSAZV6'
export const JLEND_LIQUIDITY = '7s1da8DduuBFqGra5bJBjpnvL5E9mGzCuMk1Qkh4or2Z'
export const JLEND: Readonly<Record<LendAsset, Readonly<{ lending: string; mint: string; fTokenMint: string; strl: string; lspol: string; rateModel: string; vault: string; rewardsRateModel: string; claimAccount: string }>>> = Object.freeze({
  USDC_LEND: Object.freeze({ lending: '2vVYHYM8VYnvZqQWpTJSj8o8DBf1wM8pVs3bsTgYZiqJ', mint: USDC_MINT, fTokenMint: '9BEcn9aPEmhSPbPQeFGjidRiEKki46fVQDyPpSQXPA2D', strl: '94vK29npVbyRHXH63rRcTiSr26SFhrQTzbpNJuhQEDu', lspol: 'Hf9gtkM4dpVBahVSzEXSVCAPpKzBsBcns3s8As3z77oF', rateModel: '5pjzT5dFTsXcwixoab1QDLvZQvpYJxJeBphkyfHGn688', vault: 'BmkUoKMFYBxNSzWXyUjyMJjMAaVz4d8ZnxwwmhDCUXFB', rewardsRateModel: '5xSPBiD3TibamAnwHDhZABdB4z4F9dcj5PnbteroBTTd', claimAccount: 'HN1r4VfkDn53xQQfeGDYrNuDKFdemAhZsHYRwBrFhsW' } as const),
  SOL_LEND: Object.freeze({ lending: 'BeAqbxfrcXmzEYT2Ra62oW2MqkuFDHaCtps47Mzg6Zj3', mint: WSOL_MINT, fTokenMint: '2uQsyo1fXXQkDtcpXnLofWy88PxcvnfH2L8FPSE62FVU', strl: '4Y66HtUEqbbbpZdENGtFdVhUMS3tnagffn3M4do59Nfy', lspol: '4SkEYxmiRgQ4VYyvh9VB4k39M49BpqazyzDUFDzJhXQm', rateModel: 'Acvyi9HBGmqh3Exe1N4PjBVyY8fokq2AdC6fSLqV6KSo', vault: '5JP5zgYCb9W37QQLgAHRHuinFLrKt87akDY1CgZoTPzr', rewardsRateModel: 'CkeQGDRsgMZcCaU8cZEdC2aFAohia4jLzL36RaLcUDsR', claimAccount: '6AQGR8zK4KTVZfZ9UZaRzyEL5ynvwVaF5ywVdmtJT24N' } as const),
} as const)
// Anchor discriminators sha256("global:<name>")[0..8] (contracts 6, recomputed 10-04); Token CloseAccount is tag 9.
const KLEND_REFRESH = [2, 218, 138, 235, 79, 201, 25, 102]
const KLEND_REDEEM = [234, 117, 181, 125, 185, 142, 220, 29]
const JLEND_REDEEM = [184, 12, 86, 149, 70, 196, 97, 225]
const KLEND_DEPOSIT = [169, 201, 30, 126, 6, 205, 102, 68] // deposit_reserve_liquidity a9c91e7e06cd6644
const JLEND_DEPOSIT = [242, 35, 198, 137, 82, 225, 242, 182] // deposit f223c68952e1f2b6
const TOKEN_CLOSE_ACCOUNT = 9

/**
 * The production puller (RESUME: "Puller HJCJ... funded"), the ONLY delegatee an approval from this app may name: without it pinned,
 * a hostile API could have the user approve $5 a day to its own key. ROTATING THE PULLER (a new PULLER_SECRET in the API's env)
 * NEEDS AN APP UPDATE with the new address here, or every "Approve" on the phone is refused (the web page /link is not affected).
 * After go-live (spec 6.5) new links and re-links name leashPda(user, user) instead; ROTATING THE PULLER then no longer needs an app update for links.
 */
export const PULLER = 'HJCJKRQLV2HVKfe3sFdTF5jjBY1xfWgnK8cLcjH7qnHd'

/** The daily limit connect.tsx shows ("Daily limit $5") and api link/[code] builds (DAILY_CAP_RAW, USDC at 6 decimals), per day. */
export const LINK_DAILY_CAP_RAW = 5_000_000n
const DAY_S = 86_400n

// Anchor discriminators from api/src/generated/staking (unstake, cancel_unstake); one-byte ones from @solana/subscriptions 0.5.0
// (init authority 0, create recurring delegation 2, revoke delegation 3, revoke authority 14) and the ATA program (CreateIdempotent 1).
const UNSTAKE = [90, 95, 107, 42, 205, 124, 50, 225]
const CANCEL_UNSTAKE = [64, 65, 53, 227, 125, 153, 3, 167]
const SUB_INIT = 0, SUB_CREATE_RECURRING = 2, SUB_REVOKE_DELEGATION = 3, SUB_REVOKE_AUTHORITY = 14
const ATA_CREATE_IDEMPOTENT = 1

/**
 * What the screen promised, per flow. `user` is the signed-in Seed Vault key (the fee payer and the only signer the API builds).
 * withdraw: the unstake of the plan on screen (shares as the API's decimal string). cancel: "Put it back". link: approve once for this
 * phone's wallet. revoke: Settings' revoke of this phone's wallet.
 */
export type SignFlow =
  | { kind: 'withdraw'; user: string; shares: string }
  | { kind: 'cancel'; user: string }
  | { kind: 'link'; user: string }
  | { kind: 'revoke'; user: string }
  /**
   * Spec 7, R264: one lending position back to the wallet. receiptRaw is the position the screen showed: /api/me positions[].receiptRaw
   * (contracts 5.2), never the build response's receiptRaw (5.3), which the caller only compares with it (a mismatch stops before signing).
   */
  | { kind: 'withdraw_klend'; user: string; asset: LendAsset; receiptRaw: string }
  | { kind: 'withdraw_jlend'; user: string; asset: LendAsset; receiptRaw: string }
  /**
   * Spec 7, R279: a move between lending venues, same asset, Kamino and Jupiter Lend only. receiptRaw is the position the card showed
   * (/api/me moveProposal.receiptRaw); depositRaw is the build's (contracts 5.4: about 99.9% of the redeem's expected out, into the user's
   * own receipt account). part: S3 passed ONE, so the API sends [redeem, deposit] in one wallet session; 'whole' is both in one tx.
   * One member per direction (T14 carry-in), each routed by name below; nothing falls through to the withdraw checks.
   * depositCapRaw (T14 fix round 1, controller ruling): the source position's underlyingRaw from /api/me positions, the amount the card is
   * based on. The deposit draws from the user's own underlying ATA (for USDC the account plantings pull from), so an inflated depositRaw
   * would land on chain; anything above the cap is refused 'amount', and a move with no cap is refused 'plan'.
   */
  | { kind: 'move_klend_to_jlend'; user: string; asset: LendAsset; receiptRaw: string; depositRaw: string; depositCapRaw: string; part: MovePart }
  | { kind: 'move_jlend_to_klend'; user: string; asset: LendAsset; receiptRaw: string; depositRaw: string; depositCapRaw: string; part: MovePart }
  /** R287, contracts 6: the Seed Vault wallet (delegator == user) moves its approval to the leash; web-linked wallets re-link on the link page. */
  | { kind: 'relink'; user: string }
  /** The 409 partial's `unwrapTransaction` (moves/confirm): one Token CloseAccount of the user's WSOL account, its lamports to the user. */
  | { kind: 'unwrap_wsol'; user: string }

export type MovePart = 'redeem' | 'deposit' | 'whole'

/** The sentences a refusal shows; each ends "Nothing was signed." so the screen needs no wording of its own. */
export const REFUSED = {
  unreadable: 'Sprouts could not read this transaction. Nothing was signed.',
  payer: 'This transaction was not built for your wallet. Nothing was signed.',
  signer: 'This transaction asks for a signature besides yours. Nothing was signed.',
  lookup: 'This transaction uses a lookup table Sprouts did not build. Nothing was signed.',
  program: 'This transaction touches a program Sprouts does not use here. Nothing was signed.',
  plan: 'This transaction does not match what the screen shows. Nothing was signed.',
  amount: 'This transaction moves more than your position holds. Nothing was signed.',
} as const

/** A check before signing failed; `message` is one of REFUSED, safe to show as is. */
export class SignRefused extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SignRefused'
  }
}

type Seed = Parameters<typeof getProgramDerivedAddress>[0]["seeds"][number]
type Ix = { program: string; accounts: string[]; data: Uint8Array }

const refuse = (why: keyof typeof REFUSED): never => {
  throw new SignRefused(REFUSED[why])
}
const startsWith = (data: Uint8Array, prefix: readonly number[]) => data.length >= prefix.length && prefix.every((b, i) => data[i] === b)
const u64At = (d: Uint8Array, at: number) => new DataView(d.buffer, d.byteOffset, d.byteLength).getBigUint64(at, true)
const i64At = (d: Uint8Array, at: number) => new DataView(d.buffer, d.byteOffset, d.byteLength).getBigInt64(at, true)

const pda = async (program: string, seeds: Seed[]) => (await getProgramDerivedAddress({ programAddress: program as Address, seeds }))[0] as string
const key = (a: string) => getAddressEncoder().encode(a as Address)

/** The position the unstake and the cancel act on, derived here as api/src/lib/staking.ts userStakePda does (never read from the API). */
export async function userStakePda(user: string): Promise<string> {
  return pda(SKR_STAKING_PROGRAM, ['user_stake', key(STAKE_CONFIG), key(user), key(GUARDIAN_POOL)])
}

/** Contracts 2.2 (DECIDED 10-04): the leash PDA a delegation names, ["leash", delegator, user] under the leash program. */
export async function leashPda(delegator: string, user: string): Promise<string> {
  return pda(LEASH_PROGRAM, ['leash', key(delegator), key(user)])
}

/** Every address the builders put in a user transaction, derived on the phone from the user alone (the delegation also needs the nonce). */
async function derived(user: string) {
  const [position, events, authority, usdcAta] = await Promise.all([
    userStakePda(user),
    pda(SKR_STAKING_PROGRAM, ['__event_authority']),
    pda(SUBSCRIPTIONS_PROGRAM, ['SubscriptionAuthority', key(user), key(USDC_MINT)]),
    pda(ATA_PROGRAM, [key(user), key(TOKEN_PROGRAM), key(USDC_MINT)]),
  ])
  return { position, events, authority, usdcAta }
}

/** @solana/subscriptions findRecurringDelegationPda: ["delegation", authority, delegator, delegatee, nonce u64 LE]. */
async function delegationPda(authority: string, user: string, delegatee: string, nonce: bigint): Promise<string> {
  const n = new Uint8Array(8)
  new DataView(n.buffer).setBigUint64(0, nonce, true)
  return pda(SUBSCRIPTIONS_PROGRAM, ['delegation', key(authority), key(user), key(delegatee), n])
}

/** The instruction's accounts are exactly `expected`, in order (null: any one account, the old delegation a revoke closes). */
function accountsAre(ix: Ix, expected: readonly (string | null)[]) {
  if (ix.accounts.length !== expected.length || expected.some((e, i) => e !== null && ix.accounts[i] !== e)) refuse('plan')
}

/** The staking instruction both SKR flows build: one instruction, the expected discriminator, its exact account list. */
function oneStakingIx(ixs: Ix[], discriminator: readonly number[], dataLength: number, accounts: readonly string[]): Ix {
  if (ixs.length !== 1 || ixs[0].program !== SKR_STAKING_PROGRAM) refuse('program')
  const [ix] = ixs
  if (ix.data.length !== dataLength || !startsWith(ix.data, discriminator)) refuse('plan')
  accountsAre(ix, accounts)
  return ix
}

/** The user's canonical associated token account (classic SPL Token), derived on the phone. */
const ata = (owner: string, mint: string) => pda(ATA_PROGRAM, [key(owner), key(TOKEN_PROGRAM), key(mint)])
/** A raw amount the screen showed, as the u64 the instruction must carry; anything else refuses. */
const amountOf = (s: string): bigint => (/^\d+$/.test(s) && BigInt(s) > 0n && BigInt(s) <= 0xffff_ffff_ffff_ffffn ? BigInt(s) : refuse('plan'))

/** One expected instruction: its program, discriminator, total data length, full account list, the u64 after the discriminator. */
type Step = { program: string; data: readonly number[]; length: number; accounts: readonly (string | null)[]; amount?: bigint; optional?: boolean }
/**
 * The transaction's instructions are exactly `want`, in order (an optional step may be absent). A program outside the flow's set is
 * 'program'; anything else that differs (order, data, an account, the amount, a missing or extra instruction) is 'plan'.
 */
function steps(ixs: Ix[], want: Step[]): void {
  const programs = new Set(want.map((s) => s.program))
  if (ixs.some((ix) => !programs.has(ix.program))) refuse('program')
  let i = 0
  for (const s of want) {
    const ix = ixs[i]
    if (!ix || ix.program !== s.program || !startsWith(ix.data, s.data)) {
      if (!s.optional) return refuse('plan')
      continue
    }
    if (ix.data.length !== s.length) refuse('plan')
    accountsAre(ix, s.accounts)
    if (s.amount !== undefined && u64At(ix.data, s.data.length) !== s.amount) refuse('plan')
    i++
  }
  if (i !== ixs.length) refuse('plan')
}
const ataCreate = (user: string, account: string, mint: string, optional: boolean): Step =>
  ({ program: ATA_PROGRAM, data: [ATA_CREATE_IDEMPOTENT], length: 1, accounts: [user, account, user, mint, SYSTEM_PROGRAM, TOKEN_PROGRAM], optional })
/** Unwraps: the WSOL account closes back to the user, its lamports to the user. */
const closeWsol = (wsolAta: string, user: string): Step => ({ program: TOKEN_PROGRAM, data: [TOKEN_CLOSE_ACCOUNT], length: 1, accounts: [wsolAta, user, user] })
const klendRefresh = (asset: LendAsset): Step =>
  ({ program: KLEND_PROGRAM, data: KLEND_REFRESH, length: 8, accounts: [KLEND_RESERVE[asset].reserve, KLEND_MARKET, KLEND_PROGRAM, KLEND_PROGRAM, KLEND_PROGRAM, KLEND_SCOPE_PRICES] })
/** Contracts 6 withdraw_klend: [create the underlying ATA; required for SOL], refresh, redeem the position into the user's own ATA, [SOL: close]. */
async function klendRedeemSteps(user: string, asset: LendAsset, amount: bigint, close: boolean): Promise<Step[]> {
  const r = KLEND_RESERVE[asset]
  const [und, k] = await Promise.all([ata(user, r.liquidityMint), ata(user, r.collateralMint)])
  return [
    ataCreate(user, und, r.liquidityMint, asset === 'USDC_LEND'),
    klendRefresh(asset),
    { program: KLEND_PROGRAM, data: KLEND_REDEEM, length: 16, amount,
      accounts: [user, KLEND_MARKET, r.reserve, KLEND_LMA, r.liquidityMint, r.collateralMint, r.supplyVault, k, und, TOKEN_PROGRAM, TOKEN_PROGRAM, SYSVAR_INSTRUCTIONS] },
    ...(asset === 'SOL_LEND' && close ? [closeWsol(und, user)] : []),
  ]
}
/** Contracts 6 withdraw_jlend: [create the underlying ATA], redeem the shares (18 accounts), [SOL: close]. */
async function jlendRedeemSteps(user: string, asset: LendAsset, amount: bigint, close: boolean): Promise<Step[]> {
  const j = JLEND[asset]
  const [und, f] = await Promise.all([ata(user, j.mint), ata(user, j.fTokenMint)])
  return [
    ataCreate(user, und, j.mint, true),
    { program: JLEND_PROGRAM, data: JLEND_REDEEM, length: 16, amount,
      accounts: [user, f, und, JLEND_LENDING_ADMIN, j.lending, j.mint, j.fTokenMint, j.strl, j.lspol, j.rateModel, j.vault, j.claimAccount, JLEND_LIQUIDITY, JLEND_LIQUIDITY_PROGRAM, j.rewardsRateModel, TOKEN_PROGRAM, ATA_PROGRAM, SYSTEM_PROGRAM] },
    ...(asset === 'SOL_LEND' && close ? [closeWsol(und, user)] : []),
  ]
}

/** Contracts 6 move deposit to K-Lend: [create the kToken ATA], refresh, deposit from the user's underlying ATA into the user's kToken ATA, [SOL: close]. */
async function klendDepositSteps(user: string, asset: LendAsset, amount: bigint): Promise<Step[]> {
  const r = KLEND_RESERVE[asset]
  const [und, k] = await Promise.all([ata(user, r.liquidityMint), ata(user, r.collateralMint)])
  return [
    ataCreate(user, k, r.collateralMint, true),
    klendRefresh(asset),
    { program: KLEND_PROGRAM, data: KLEND_DEPOSIT, length: 16, amount,
      accounts: [user, r.reserve, KLEND_MARKET, KLEND_LMA, r.liquidityMint, r.supplyVault, r.collateralMint, und, k, TOKEN_PROGRAM, TOKEN_PROGRAM, SYSVAR_INSTRUCTIONS] },
    ...(asset === 'SOL_LEND' ? [closeWsol(und, user)] : []),
  ]
}
/** Contracts 6 move deposit to Jupiter Lend: [create the fToken ATA], deposit (17 accounts), [SOL: close]. */
async function jlendDepositSteps(user: string, asset: LendAsset, amount: bigint): Promise<Step[]> {
  const j = JLEND[asset]
  const [und, f] = await Promise.all([ata(user, j.mint), ata(user, j.fTokenMint)])
  return [
    ataCreate(user, f, j.fTokenMint, true),
    { program: JLEND_PROGRAM, data: JLEND_DEPOSIT, length: 16, amount,
      accounts: [user, und, f, j.mint, JLEND_LENDING_ADMIN, j.lending, j.fTokenMint, j.strl, j.lspol, j.rateModel, j.vault, JLEND_LIQUIDITY, JLEND_LIQUIDITY_PROGRAM, j.rewardsRateModel, TOKEN_PROGRAM, ATA_PROGRAM, SYSTEM_PROGRAM] },
    ...(asset === 'SOL_LEND' ? [closeWsol(und, user)] : []),
  ]
}
/**
 * Contracts 6 move parts: the redeem is the source venue's withdraw except that SOL keeps the WSOL account open (no close: a close there
 * is a Token instruction outside the part's programs, refused as 'program'); the deposit spends it and closes it; 'whole' is both, in order.
 */
function movePart(ixs: Ix[], part: MovePart, redeem: Step[], deposit: Step[]): void {
  if (part === 'redeem') return steps(ixs, redeem)
  if (part === 'deposit') return steps(ixs, deposit)
  if (part === 'whole') return steps(ixs, [...redeem, ...deposit])
  return refuse('plan')
}

/**
 * An approval (link, relink): [create the USDC account], [revoke an old delegation], [init the authority], create the delegation: exactly
 * one create, from this wallet, to one of `delegatees`, at $5 a day with no expiry; at most `maxRevokes` revokes. A fixed delegation or a
 * transfer (other discriminators) is refused. Order (both API builders): the ATA create and the revokes (link/[code] prepends its revoke,
 * contracts 5.5 puts it after the ATA create) before the init, the init before the create, the create last; at most one ATA create and
 * one init. A revoke may not name the delegation being created.
 */
async function checkApproval(ixs: Ix[], user: string, d: Awaited<ReturnType<typeof derived>>, delegatees: readonly string[], maxRevokes: number): Promise<void> {
  let creates = 0
  let revokes = 0
  let atas = 0
  let inits = 0
  const revoked: string[] = []
  // Only the two programs the builders use (no ComputeBudget, contracts 6 AMEND s20); a foreign one is 'program' wherever it sits.
  if (ixs.some((ix) => ix.program !== ATA_PROGRAM && ix.program !== SUBSCRIPTIONS_PROGRAM)) refuse('program')
  for (const ix of ixs) {
    if (creates > 0) refuse('plan') // the create is the last instruction
    if (ix.program === ATA_PROGRAM) {
      if (ix.data.length !== 1 || ix.data[0] !== ATA_CREATE_IDEMPOTENT) refuse('plan')
      accountsAre(ix, [user, d.usdcAta, user, USDC_MINT, SYSTEM_PROGRAM, TOKEN_PROGRAM])
      if (++atas > 1 || inits > 0) refuse('plan')
      continue
    }
    const kind = ix.data[0]
    if (kind === SUB_INIT) {
      if (ix.data.length !== 1) refuse('plan')
      accountsAre(ix, [user, d.authority, USDC_MINT, d.usdcAta, SYSTEM_PROGRAM, TOKEN_PROGRAM])
      if (++inits > 1) refuse('plan')
      continue
    }
    if (kind === SUB_REVOKE_DELEGATION) {
      if (ix.data.length !== 1) refuse('plan')
      accountsAre(ix, [user, null])
      if (++revokes > maxRevokes || inits > 0) refuse('plan')
      revoked.push(ix.accounts[1])
      continue
    }
    if (kind !== SUB_CREATE_RECURRING) refuse('plan')
    // data: u8 discriminator, nonce u64, amountPerPeriod u64, periodLengthS u64, startTs i64, expiryTs i64, initId i64.
    if (ix.data.length !== 49 || ix.accounts.length !== 5) refuse('plan')
    if (u64At(ix.data, 9) !== LINK_DAILY_CAP_RAW || u64At(ix.data, 17) !== DAY_S || i64At(ix.data, 33) !== 0n) refuse('plan')
    const delegatee = ix.accounts[3]
    if (!delegatees.includes(delegatee)) refuse('plan')
    const delegation = await delegationPda(d.authority, user, delegatee, u64At(ix.data, 1))
    accountsAre(ix, [user, d.authority, delegation, delegatee, SYSTEM_PROGRAM])
    if (revoked.includes(delegation)) refuse('plan')
    creates++
  }
  if (creates !== 1) refuse('plan')
}

/**
 * Per flow, what the API's builder puts in (api/src/lib/staking.ts, subscriptions.ts, app/api/link/[code]); nothing else passes. Every
 * account list is pinned in full, in the generated builders' order (unstake: userStake, stakeConfig, guardianPool, user, stakeVault,
 * mint, eventAuthority, program; cancel the same without the mint; ATA create: payer, ata, owner, mint, system, token; init: owner,
 * authority, mint, userAta, system, token; create: delegator, authority, delegation, delegatee, system; revoke delegation: authority,
 * delegation; revoke authority: user, userAta, mint, token, authority), so no extra or swapped account slips in.
 */
async function checkInstructions(ixs: Ix[], flow: SignFlow): Promise<void> {
  const user = flow.user
  // The lending withdraws use none of derived()'s four PDAs (T6 review Minor 4).
  // Two union members (contracts 6), so the kind test narrows them out and the switch's default stays exhaustive. Each kind routes to its
  // own venue's check by name; nothing falls through to Jupiter (T8 review Important 1).
  if (flow.kind === 'withdraw_klend' || flow.kind === 'withdraw_jlend') {
    if (!isLend(flow.asset)) return refuse('plan')
    const amount = amountOf(flow.receiptRaw)
    if (flow.kind === 'withdraw_klend') return steps(ixs, await klendRedeemSteps(user, flow.asset, amount, true))
    if (flow.kind === 'withdraw_jlend') return steps(ixs, await jlendRedeemSteps(user, flow.asset, amount, true))
    return refuse('plan')
  }
  // The moves (T14): each direction by name; the source venue's redeem (no close), then the other venue's deposit.
  if (flow.kind === 'move_klend_to_jlend' || flow.kind === 'move_jlend_to_klend') {
    if (!isLend(flow.asset)) return refuse('plan')
    const receipt = amountOf(flow.receiptRaw)
    const deposit = amountOf(flow.depositRaw)
    // Every part (the deposit tx can be sent without its redeem): never more than the position the card is based on, no upward tolerance.
    if (deposit > amountOf(flow.depositCapRaw)) return refuse('amount')
    if (flow.kind === 'move_klend_to_jlend')
      return movePart(ixs, flow.part, await klendRedeemSteps(user, flow.asset, receipt, false), await jlendDepositSteps(user, flow.asset, deposit))
    if (flow.kind === 'move_jlend_to_klend')
      return movePart(ixs, flow.part, await jlendRedeemSteps(user, flow.asset, receipt, false), await klendDepositSteps(user, flow.asset, deposit))
    return refuse('plan')
  }
  // The unwrap: exactly the one close, nothing else (no ComputeBudget); it touches none of derived()'s PDAs either.
  if (flow.kind === 'unwrap_wsol') return steps(ixs, [closeWsol(await ata(user, WSOL_MINT), user)])
  const d = await derived(user)
  switch (flow.kind) {
    case 'withdraw': {
      // unstake(shares: u128): the shares are the plan's, so the wallet signs the amount the screen showed and no more.
      const ix = oneStakingIx(ixs, UNSTAKE, 24, [d.position, STAKE_CONFIG, GUARDIAN_POOL, user, STAKE_VAULT, SKR_MINT, d.events, SKR_STAKING_PROGRAM])
      const shares = u64At(ix.data, 8) + (u64At(ix.data, 16) << 64n)
      if (!/^\d+$/.test(flow.shares) || shares === 0n || shares !== BigInt(flow.shares)) refuse('plan')
      return
    }
    case 'cancel':
      oneStakingIx(ixs, CANCEL_UNSTAKE, 8, [d.position, STAKE_CONFIG, GUARDIAN_POOL, user, STAKE_VAULT, d.events, SKR_STAKING_PROGRAM])
      return
    case 'revoke':
      // Revoke the delegation, then the authority; both act on the user's own keys, and neither can pay anyone.
      if (ixs.length === 0) refuse('plan')
      for (const ix of ixs) {
        if (ix.program !== SUBSCRIPTIONS_PROGRAM) refuse('program')
        if (ix.data.length !== 1) refuse('plan')
        if (ix.data[0] === SUB_REVOKE_DELEGATION) accountsAre(ix, [user, null])
        else if (ix.data[0] === SUB_REVOKE_AUTHORITY) accountsAre(ix, [user, d.usdcAta, USDC_MINT, TOKEN_PROGRAM, d.authority])
        else refuse('plan')
      }
      return
    case 'link':
      // Before go-live the puller; after it, new links name this wallet's leash PDA (spec 6.5). Nothing else.
      // At most one revoke: the link page only ever prepends one (T7 review ruling).
      return checkApproval(ixs, user, d, [PULLER, await leashPda(user, user)], 1)
    case 'relink':
      // Contracts 6: as link, but only to the leash PDA (delegator and user both this key), never the puller, at most one revoke.
      return checkApproval(ixs, user, d, [await leashPda(user, user)], 1)
    default: {
      // A flow kind this check does not know signs nothing (T7 review).
      const unknown: never = flow
      void unknown
      return refuse('plan')
    }
  }
}

/**
 * Decodes the transaction and refuses (SignRefused) anything the flow's builder would not produce. Static accounts only: the API
 * builds every user transaction without a lookup table (api/src/lib/verify-tx.ts says the same on the way back).
 */
export async function checkBeforeSigning(tx: Transaction, flow: SignFlow): Promise<void> {
  let message
  try {
    message = getCompiledTransactionMessageDecoder().decode(tx.messageBytes)
  } catch {
    return refuse('unreadable')
  }
  // The API compiles every user transaction as v0 (api/src/lib/user-tx.ts, link/[code]); legacy and v1 shapes are not its output.
  if (message.version !== 0) return refuse('unreadable')
  if (message.addressTableLookups && message.addressTableLookups.length > 0) refuse('lookup')
  const keys = message.staticAccounts as readonly string[]
  if (keys[0] !== flow.user) refuse('payer')
  // The user signs and pays; one signer in the header and one slot in the signature map, both the user's.
  const slots = Object.keys(tx.signatures)
  if (message.header.numSignerAccounts !== 1 || slots.length !== 1 || slots[0] !== flow.user) refuse('signer')
  const ixs: Ix[] = message.instructions.map((ix) => ({
    program: keys[ix.programAddressIndex],
    accounts: (ix.accountIndices ?? []).map((i) => keys[i]),
    data: new Uint8Array(ix.data ?? []),
  }))
  if (ixs.some((ix) => ix.program === undefined || ix.accounts.some((a) => a === undefined))) refuse('unreadable')
  await checkInstructions(ixs, flow)
}

/** The API builds every transaction; the app checks it against the flow (above); the Seed Vault signs the bytes; the API sends. */
export function makeSigner(signTransaction: (tx: Transaction) => Promise<Transaction>, flow: SignFlow) {
  return async function signWithSeeker(base64: string): Promise<string> {
    let tx: Transaction
    try {
      tx = getTransactionDecoder().decode(getBase64Encoder().encode(base64))
    } catch {
      return refuse('unreadable')
    }
    await checkBeforeSigning(tx, flow)
    const signed = await signTransaction(tx)
    return getBase64EncodedWireTransaction(signed)
  }
}

/**
 * S3 (contracts 9, VERDICT ONE): several transactions in ONE wallet session, one passcode. Each is checked against its own flow, in order,
 * before the wallet is asked; one refusal (or a count that is not the flows') and the wallet is never asked.
 */
export function makeBatchSigner(signTransactions: (txs: Transaction[]) => Promise<Transaction[]>, flows: readonly SignFlow[]) {
  return async function signAllWithSeeker(base64s: string[]): Promise<string[]> {
    if (base64s.length === 0 || base64s.length !== flows.length) return refuse('plan')
    const txs: Transaction[] = []
    for (const b of base64s) {
      try {
        txs.push(getTransactionDecoder().decode(getBase64Encoder().encode(b)))
      } catch {
        return refuse('unreadable')
      }
    }
    for (let i = 0; i < txs.length; i++) await checkBeforeSigning(txs[i], flows[i])
    const signed = await signTransactions(txs)
    if (signed.length !== txs.length) return refuse('unreadable')
    return signed.map((t) => getBase64EncodedWireTransaction(t))
  }
}
