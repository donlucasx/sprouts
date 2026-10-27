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
/** SPL Token Approve, and the allowance the subscription init grants (the most a u64 holds); the re-link's reapprove repeats both. */
const TOKEN_APPROVE = 4
const APPROVE_ALL = 18_446_744_073_709_551_615n
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
  /**
   * The SOL top-up (10-22): the user's own SOL swapped to USDC in the user's own wallet, one Jupiter ExactOut swap. usdcRaw is the amount
   * the button showed (USDC base units), never the build response's; the swap must deliver exactly that, to this wallet's USDC account.
   */
  | { kind: 'topup'; user: string; usdcRaw: string }

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
  /** The top-up: the phone could not read the SOL price itself, so the amount could not be held to it. */
  price: 'Sprouts could not check the SOL price, so nothing was asked of your wallet. Try again.',
  /** The top-up: the swap may spend more SOL than the USDC is worth at the phone's own price (or over 1 SOL). */
  overpriced: 'This swap asks for more SOL than the USDC is worth right now. Nothing was signed.',
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
  let reapproves = 0
  // Only the programs the builders use (no ComputeBudget, contracts 6 AMEND s20); a foreign one is 'program' wherever it sits. The Token
  // program only for the re-link's one Approve (10-27, Kimi's 0.1.5 audit: the API's reapprove, api/src/lib/subscriptions.ts, was
  // refused here, so a wallet whose USDC approval was removed in its wallet could never link again from this phone).
  if (ixs.some((ix) => ix.program !== ATA_PROGRAM && ix.program !== SUBSCRIPTIONS_PROGRAM && ix.program !== TOKEN_PROGRAM)) refuse('program')
  for (const ix of ixs) {
    if (creates > 0) refuse('plan') // the create is the last instruction
    if (ix.program === TOKEN_PROGRAM) {
      // exactly the confirm route's allow-list (api/src/app/api/link/confirm/route.ts): SPL Approve (4) of the full allowance, from this
      // wallet's USDC account to its own USDC subscription authority, signed by the wallet; once, on an authority that exists (no init)
      if (ix.data.length !== 9 || ix.data[0] !== TOKEN_APPROVE || u64At(ix.data, 1) !== APPROVE_ALL) refuse('plan')
      accountsAre(ix, [d.usdcAta, d.authority, user])
      if (++reapproves > 1 || inits > 0) refuse('plan')
      continue
    }
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
  if (creates !== 1 || (reapproves > 0 && inits > 0)) refuse('plan')
}

/** The SOL top-up's programs (api/src/lib/topup.ts), copied. */
export const JUPITER_PROGRAM = 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4'
export const COMPUTE_BUDGET_PROGRAM = 'ComputeBudget111111111111111111111111111111'
const TOKEN_2022_PROGRAM = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb'
const TOKEN_SYNC_NATIVE = 17
const SYSTEM_TRANSFER = 2
/** The most a top-up may pay in priority fee (compute limit x price), in lamports: 0.001 SOL. */
export const TOPUP_MAX_PRIORITY_LAMPORTS = 1_000_000n
export const TOPUP_MAX_SLIPPAGE_BPS = 100
/** Never more than 1 SOL leaves the wallet in a top-up, whatever the price (the button offers at most $25). */
export const TOPUP_MAX_LAMPORTS = 1_000_000_000n
/** The SOL a top-up may spend, against the phone's own SOL price: the fair amount plus 3%, plus the priority-fee cap. */
export const TOPUP_PRICE_MARGIN_BPS = 300n

/**
 * Jupiter v6 shared_accounts_exact_out_route (sha256("global:shared_accounts_exact_out_route")[0..8]), the ONLY swap a top-up may carry.
 * The shared-accounts route swaps through Jupiter's own program authority, so the AMMs never see this wallet: the user's key and its
 * token accounts sit in the fixed slots only (the plain exact_out_route passes the user as the AMM's authority in the route accounts,
 * which is what a hostile builder would abuse). The API asks Jupiter for useSharedAccounts and only the dexes below (api topup.ts).
 * Data, Borsh (Jupiter v6 IDL): discriminator, id u8, route_plan Vec<RoutePlanStep { swap: Swap, percent u8, input_index u8,
 * output_index u8 }>, out_amount u64, quoted_in_amount u64, slippage_bps u16, platform_fee_bps u8, and nothing after.
 */
const SHARED_EXACT_OUT = [0xb0, 0xd1, 0x69, 0xa8, 0x9a, 0x7d, 0x45, 0x3e]
/**
 * The Swap enum variants a top-up route may use, with the size of their payload (Jupiter v6 IDL, @jup-ag/instruction-parser 6.0.28;
 * every payload byte here is a bool, 0 or 1). Any other variant is refused: its payload size is not pinned here, so the data after it
 * could not be read safely. Whirlpool and Raydium CLMM are the dexes the API asks for (Meteora DLMM has no ExactOut route).
 */
const SWAP_VARIANTS: Readonly<Record<number, number>> = Object.freeze({ 17: 1 /* Whirlpool { a_to_b } */, 26: 0 /* RaydiumClmm */, 40: 0 /* RaydiumClmmV2 */ })
/** Jupiter's program authorities are ids 0..7 (PDA ["authority", id]); a route plan longer than this does not fit a top-up's 20 accounts. */
const JUPITER_AUTHORITIES = 8
const MAX_ROUTE_STEPS = 4
/** Jupiter v6's Anchor event authority, PDA ["__event_authority"] under the program. */
const JUPITER_EVENT_AUTHORITY = 'D8cy77BBepLMngZx6ZukaTff5hCt1HrWyKk3Hnd9oitf'

/**
 * The mints whose accounts this wallet may hold beside SOL and USDC (api domain/coins.ts and the lending receipts above), copied: none
 * of the user's accounts for them may appear anywhere in a top-up, under either token program.
 */
const TOPUP_FOREIGN_MINTS: readonly string[] = Object.freeze([
  SKR_MINT,
  'storenSbvkfzircixnaosc5CbzNZVrHJ6S3EKrS1yqR', // stORE
  'he1iusmfkpAdwvxLNGV8Y1iSbj4rUy6yMhEA3fotn9A', // hSOL
  'cbbtcf3aa214zXHbiAZQwf4122FBYbraNdFqgw4iMij', // cbBTC
  'J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn', // JitoSOL (retired, may still be held)
  'jupSoLaHXQiZZTSfEWMTRRgpnyFm8f6sZdosWBjx93v', // JupSOL (retired, may still be held)
  KLEND_RESERVE.USDC_LEND.collateralMint,
  KLEND_RESERVE.SOL_LEND.collateralMint,
  JLEND.USDC_LEND.fTokenMint,
  JLEND.SOL_LEND.fTokenMint,
])

const u16At = (d: Uint8Array, at: number) => new DataView(d.buffer, d.byteOffset, d.byteLength).getUint16(at, true)
const u32At = (d: Uint8Array, at: number) => new DataView(d.buffer, d.byteOffset, d.byteLength).getUint32(at, true)
const listIs = (ix: Ix, expected: readonly string[]) => ix.accounts.length === expected.length && expected.every((e, i) => ix.accounts[i] === e)

/** The swap's data, read the way Jupiter's program reads it; anything it cannot read in full, or with bytes left over, refuses. */
export function parseSharedExactOut(d: Uint8Array): { id: number; steps: number; outAmount: bigint; quotedIn: bigint; slippageBps: number; feeBps: number } {
  if (!startsWith(d, SHARED_EXACT_OUT) || d.length < 8 + 1 + 4) return refuse('plan')
  const id = d[8]
  const steps = u32At(d, 9)
  if (id >= JUPITER_AUTHORITIES || steps < 1 || steps > MAX_ROUTE_STEPS) return refuse('plan')
  let at = 13
  for (let s = 0; s < steps; s++) {
    if (at >= d.length) return refuse('plan')
    const payload = SWAP_VARIANTS[d[at]]
    if (payload === undefined) return refuse('plan')
    at++
    if (at + payload + 3 > d.length) return refuse('plan')
    for (let b = 0; b < payload; b++) if (d[at + b] > 1) return refuse('plan')
    at += payload
    const percent = d[at]
    if (percent < 1 || percent > 100) return refuse('plan')
    at += 3 // percent, input_index, output_index
  }
  if (d.length - at !== 8 + 8 + 2 + 1) return refuse('plan')
  return { id, steps, outAmount: u64At(d, at), quotedIn: u64At(d, at + 8), slippageBps: u16At(d, at + 16), feeBps: d[at + 18] }
}

/** The SOL price in USD, from a source that is not the Sprouts API. Throws when it cannot say. */
export type SolUsdSource = () => Promise<number>
/** Jupiter's public price API (no key), 4 s at most. The app reads it itself: the API it checks never hands it a price. */
export const SOL_PRICE_URL = `https://lite-api.jup.ag/price/v3?ids=${WSOL_MINT}`
export const fetchSolUsd: SolUsdSource = async () => {
  const abort = new AbortController()
  const timer = setTimeout(() => abort.abort(), 4_000)
  try {
    const res = await fetch(SOL_PRICE_URL, { signal: abort.signal })
    if (!res.ok) throw new Error(`price ${res.status}`)
    const body = (await res.json()) as Record<string, { usdPrice?: unknown } | undefined>
    const p = body?.[WSOL_MINT]?.usdPrice
    if (typeof p !== 'number') throw new Error('no SOL price')
    return p
  } finally {
    clearTimeout(timer)
  }
}
export type CheckOptions = { solUsd?: SolUsdSource }

/** The most lamports `usdcRaw` USDC is worth at `solUsd`, plus the margin and the priority-fee cap; null when the price is not sane. */
export function topUpLamportCeiling(usdcRaw: bigint, solUsd: number): bigint | null {
  if (typeof solUsd !== 'number' || !Number.isFinite(solUsd) || solUsd < 1 || solUsd > 100_000) return null
  const microUsdPerSol = BigInt(Math.round(solUsd * 1e6))
  const fair = (usdcRaw * 1_000_000_000n + microUsdPerSol - 1n) / microUsdPerSol
  return (fair * (10_000n + TOPUP_PRICE_MARGIN_BPS)) / 10_000n + TOPUP_MAX_PRIORITY_LAMPORTS
}

/**
 * The SOL top-up, in this order and nothing else: compute budget (at most one limit and one price, the priority fee at most 0.001 SOL);
 * [create this wallet's wSOL account]; one SOL transfer into it; SyncNative; [create this wallet's USDC account]; ONE Jupiter
 * shared_accounts_exact_out_route, its data parsed in full (pinned swap variants only), every fixed account pinned (Jupiter's program
 * authority for the data's id and that authority's own wSOL and USDC accounts, this wallet as the transfer authority, its wSOL account as
 * the source, its USDC account as the destination, no platform fee account), this wallet and its token accounts nowhere in the route
 * accounts; delivering exactly `usdcRaw` USDC, slippage at most 1%, the wrap no larger than the swap's own maximum; then the wSOL account
 * closed back to this wallet. None of this wallet's other token accounts appears anywhere. Last, the SOL spent is held to the phone's
 * own SOL price (+3%, + the fee cap) and to 1 SOL: a price the phone cannot read refuses, it never skips the bound.
 */
async function checkTopUp(ixs: Ix[], user: string, usdcRaw: bigint, solUsd: SolUsdSource): Promise<void> {
  const [wsolAta, usdcAta] = await Promise.all([ata(user, WSOL_MINT), ata(user, USDC_MINT)])
  const allowed = new Set([COMPUTE_BUDGET_PROGRAM, ATA_PROGRAM, SYSTEM_PROGRAM, TOKEN_PROGRAM, JUPITER_PROGRAM])
  if (ixs.some((ix) => !allowed.has(ix.program))) refuse('program')
  // The wallet's other token accounts (both token programs) and its wSOL / USDC accounts under Token-2022: in no instruction at all.
  const foreign = new Set(
    await Promise.all([
      ...TOPUP_FOREIGN_MINTS.flatMap((m) => [ata(user, m), pda(ATA_PROGRAM, [key(user), key(TOKEN_2022_PROGRAM), key(m)])]),
      pda(ATA_PROGRAM, [key(user), key(TOKEN_2022_PROGRAM), key(WSOL_MINT)]),
      pda(ATA_PROGRAM, [key(user), key(TOKEN_2022_PROGRAM), key(USDC_MINT)]),
    ]),
  )
  if (ixs.some((ix) => foreign.has(ix.program) || ix.accounts.some((a) => foreign.has(a)))) refuse('plan')
  let i = 0
  let limit: bigint | null = null
  let price: bigint | null = null
  for (; i < ixs.length && ixs[i].program === COMPUTE_BUDGET_PROGRAM; i++) {
    const d = ixs[i].data
    if (ixs[i].accounts.length !== 0) refuse('plan')
    if (d.length === 5 && d[0] === 2 && limit === null) limit = BigInt(u32At(d, 1))
    else if (d.length === 9 && d[0] === 3 && price === null) price = u64At(d, 1)
    else refuse('plan')
  }
  if (((limit ?? 1_400_000n) * (price ?? 0n) + 999_999n) / 1_000_000n > TOPUP_MAX_PRIORITY_LAMPORTS) refuse('plan')
  let wsolCreate = false
  let usdcCreate = false
  let synced = false
  let wrap: bigint | null = null
  for (; i < ixs.length && ixs[i].program !== JUPITER_PROGRAM; i++) {
    const ix = ixs[i]
    if (ix.program === ATA_PROGRAM) {
      if (ix.data.length !== 1 || ix.data[0] !== ATA_CREATE_IDEMPOTENT) refuse('plan')
      if (!wsolCreate && wrap === null && listIs(ix, [user, wsolAta, user, WSOL_MINT, SYSTEM_PROGRAM, TOKEN_PROGRAM])) wsolCreate = true
      else if (!usdcCreate && listIs(ix, [user, usdcAta, user, USDC_MINT, SYSTEM_PROGRAM, TOKEN_PROGRAM])) usdcCreate = true
      else refuse('plan')
    } else if (ix.program === SYSTEM_PROGRAM) {
      if (wrap !== null || ix.data.length !== 12 || u32At(ix.data, 0) !== SYSTEM_TRANSFER || !listIs(ix, [user, wsolAta])) refuse('plan')
      wrap = u64At(ix.data, 4)
    } else if (ix.program === TOKEN_PROGRAM) {
      if (synced || wrap === null || ix.data.length !== 1 || ix.data[0] !== TOKEN_SYNC_NATIVE || !listIs(ix, [wsolAta])) refuse('plan')
      synced = true
    } else refuse('plan')
  }
  if (wrap === null || !synced) return refuse('plan')
  const swap = ixs[i++]
  if (!swap || swap.program !== JUPITER_PROGRAM) return refuse('plan')
  const route = parseSharedExactOut(swap.data)
  const authority = await pda(JUPITER_PROGRAM, ['authority', new Uint8Array([route.id])])
  const [authorityWsol, authorityUsdc] = await Promise.all([ata(authority, WSOL_MINT), ata(authority, USDC_MINT)])
  // shared_accounts_exact_out_route's 13 fixed accounts (IDL order): token program, program authority, user transfer authority, source,
  // program source, program destination, destination, source mint, destination mint, platform fee (None), token-2022 (None), event
  // authority, program. Then the route's own accounts: at least one, and none of this wallet's.
  const fixed = [TOKEN_PROGRAM, authority, user, wsolAta, authorityWsol, authorityUsdc, usdcAta, WSOL_MINT, USDC_MINT, JUPITER_PROGRAM, JUPITER_PROGRAM, JUPITER_EVENT_AUTHORITY, JUPITER_PROGRAM]
  if (swap.accounts.length <= fixed.length || fixed.some((a, k) => swap.accounts[k] !== a)) refuse('plan')
  const mine = new Set([user, wsolAta, usdcAta])
  if (swap.accounts.slice(fixed.length).some((a) => mine.has(a))) refuse('plan')
  if (route.outAmount !== usdcRaw || route.feeBps !== 0 || route.slippageBps > TOPUP_MAX_SLIPPAGE_BPS || route.quotedIn <= 0n) refuse('plan')
  const maxIn = (route.quotedIn * BigInt(10_000 + route.slippageBps) + 9_999n) / 10_000n + 1n
  if (wrap > maxIn) refuse('plan')
  const close = ixs[i++]
  if (!close || close.program !== TOKEN_PROGRAM || close.data.length !== 1 || close.data[0] !== TOKEN_CLOSE_ACCOUNT || !listIs(close, [wsolAta, user, user])) refuse('plan')
  if (i !== ixs.length) refuse('plan')
  // The amount, against a price the API never touched. The swap can spend up to its maximum (more than the wrap if the wSOL account
  // already held some), and the wrap is at most that maximum, so the maximum is what is bounded.
  if (maxIn > TOPUP_MAX_LAMPORTS) refuse('overpriced')
  let ceiling: bigint | null
  try {
    ceiling = topUpLamportCeiling(usdcRaw, await solUsd())
  } catch {
    ceiling = null
  }
  if (ceiling === null) return refuse('price')
  if (maxIn > ceiling) refuse('overpriced')
}

/**
 * Per flow, what the API's builder puts in (api/src/lib/staking.ts, subscriptions.ts, app/api/link/[code]); nothing else passes. Every
 * account list is pinned in full, in the generated builders' order (unstake: userStake, stakeConfig, guardianPool, user, stakeVault,
 * mint, eventAuthority, program; cancel the same without the mint; ATA create: payer, ata, owner, mint, system, token; init: owner,
 * authority, mint, userAta, system, token; create: delegator, authority, delegation, delegatee, system; revoke delegation: authority,
 * delegation; revoke authority: user, userAta, mint, token, authority), so no extra or swapped account slips in.
 */
async function checkInstructions(ixs: Ix[], flow: SignFlow, opts: CheckOptions): Promise<void> {
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
  if (flow.kind === 'topup') return checkTopUp(ixs, user, amountOf(flow.usdcRaw), opts.solUsd ?? fetchSolUsd)
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
export async function checkBeforeSigning(tx: Transaction, flow: SignFlow, opts: CheckOptions = {}): Promise<void> {
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
  // The fee payer is a writable signer, so no signer may be read-only (and nothing else may sign).
  if (message.header.numSignerAccounts !== 1 || message.header.numReadonlySignerAccounts !== 0 || slots.length !== 1 || slots[0] !== flow.user) refuse('signer')
  const ixs: Ix[] = message.instructions.map((ix) => ({
    program: keys[ix.programAddressIndex],
    accounts: (ix.accountIndices ?? []).map((i) => keys[i]),
    data: new Uint8Array(ix.data ?? []),
  }))
  if (ixs.some((ix) => ix.program === undefined || ix.accounts.some((a) => a === undefined))) refuse('unreadable')
  await checkInstructions(ixs, flow, opts)
}

/** The API builds every transaction; the app checks it against the flow (above); the Seed Vault signs the bytes; the API sends. */
export function makeSigner(signTransaction: (tx: Transaction) => Promise<Transaction>, flow: SignFlow, opts: CheckOptions = {}) {
  return async function signWithSeeker(base64: string): Promise<string> {
    let tx: Transaction
    try {
      tx = getTransactionDecoder().decode(getBase64Encoder().encode(base64))
    } catch {
      return refuse('unreadable')
    }
    await checkBeforeSigning(tx, flow, opts)
    const signed = await signTransaction(tx)
    return getBase64EncodedWireTransaction(signed)
  }
}

/**
 * S3 (contracts 9, VERDICT ONE): several transactions in ONE wallet session, one passcode. Each is checked against its own flow, in order,
 * before the wallet is asked; one refusal (or a count that is not the flows') and the wallet is never asked.
 */
export function makeBatchSigner(signTransactions: (txs: Transaction[]) => Promise<Transaction[]>, flows: readonly SignFlow[], opts: CheckOptions = {}) {
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
    for (let i = 0; i < txs.length; i++) await checkBeforeSigning(txs[i], flows[i], opts)
    const signed = await signTransactions(txs)
    if (signed.length !== txs.length) return refuse('unreadable')
    return signed.map((t) => getBase64EncodedWireTransaction(t))
  }
}
