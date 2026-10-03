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

/**
 * Security R207 #3 (10-03): the API builds every transaction and the Seed Vault key signs it, so a compromised API (or its domain)
 * could hand the phone "transfer everything" under a screen that says "Withdraw". The web page already checks what it signs
 * (api/src/lib/wallet-choice.ts); the app now checks more, per flow, before the wallet is asked: the fee payer is the user, the
 * user is the only signer, no lookup table, only the programs the API's builder uses (as top-level instructions), and the
 * instruction itself where it carries a number the screen showed (the unstake's shares and position; the approval's $5 a day to the
 * puller), with every account list pinned in full (review of 37ab59d).
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

/**
 * The production puller (RESUME: "Puller HJCJ... funded"), the ONLY delegatee an approval from this app may name: without it pinned,
 * a hostile API could have the user approve $5 a day to its own key. ROTATING THE PULLER (a new PULLER_SECRET in the API's env)
 * NEEDS AN APP UPDATE with the new address here, or every "Approve" on the phone is refused (the web page /link is not affected).
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

/** The sentences a refusal shows; each ends "Nothing was signed." so the screen needs no wording of its own. */
export const REFUSED = {
  unreadable: 'Sprouts could not read this transaction. Nothing was signed.',
  payer: 'This transaction was not built for your wallet. Nothing was signed.',
  signer: 'This transaction asks for a signature besides yours. Nothing was signed.',
  lookup: 'This transaction uses a lookup table Sprouts did not build. Nothing was signed.',
  program: 'This transaction touches a program Sprouts does not use here. Nothing was signed.',
  plan: 'This transaction does not match what the screen shows. Nothing was signed.',
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

/**
 * Per flow, what the API's builder puts in (api/src/lib/staking.ts, subscriptions.ts, app/api/link/[code]); nothing else passes. Every
 * account list is pinned in full, in the generated builders' order (unstake: userStake, stakeConfig, guardianPool, user, stakeVault,
 * mint, eventAuthority, program; cancel the same without the mint; ATA create: payer, ata, owner, mint, system, token; init: owner,
 * authority, mint, userAta, system, token; create: delegator, authority, delegation, delegatee, system; revoke delegation: authority,
 * delegation; revoke authority: user, userAta, mint, token, authority), so no extra or swapped account slips in.
 */
async function checkInstructions(ixs: Ix[], flow: SignFlow): Promise<void> {
  const user = flow.user
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
    case 'link': {
      // [create the USDC account], [revoke the old delegation], [init the authority], create the delegation: exactly one create,
      // from this wallet, to the puller, at the limit the screen shows. A fixed delegation or a transfer (other discriminators) is refused.
      let creates = 0
      for (const ix of ixs) {
        if (ix.program === ATA_PROGRAM) {
          if (ix.data.length !== 1 || ix.data[0] !== ATA_CREATE_IDEMPOTENT) refuse('plan')
          accountsAre(ix, [user, d.usdcAta, user, USDC_MINT, SYSTEM_PROGRAM, TOKEN_PROGRAM])
          continue
        }
        if (ix.program !== SUBSCRIPTIONS_PROGRAM) refuse('program')
        const kind = ix.data[0]
        if (kind === SUB_INIT) {
          if (ix.data.length !== 1) refuse('plan')
          accountsAre(ix, [user, d.authority, USDC_MINT, d.usdcAta, SYSTEM_PROGRAM, TOKEN_PROGRAM])
          continue
        }
        if (kind === SUB_REVOKE_DELEGATION) {
          if (ix.data.length !== 1) refuse('plan')
          accountsAre(ix, [user, null])
          continue
        }
        if (kind !== SUB_CREATE_RECURRING) refuse('plan')
        // data: u8 discriminator, nonce u64, amountPerPeriod u64, periodLengthS u64, startTs i64, expiryTs i64, initId i64.
        if (ix.data.length !== 49) refuse('plan')
        if (u64At(ix.data, 9) !== LINK_DAILY_CAP_RAW || u64At(ix.data, 17) !== DAY_S || i64At(ix.data, 33) !== 0n) refuse('plan')
        accountsAre(ix, [user, d.authority, await delegationPda(d.authority, user, PULLER, u64At(ix.data, 1)), PULLER, SYSTEM_PROGRAM])
        creates++
      }
      if (creates !== 1) refuse('plan')
      return
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
