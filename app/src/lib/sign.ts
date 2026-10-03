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
 * instruction itself where it carries a number the screen showed (the unstake's shares and position; the approval's $5 a day).
 * Anything else throws SignRefused and nothing is signed. The ids below are the API's (api/src/lib/constants.ts), copied, since the
 * app must not take them from the API it is checking.
 */
export const SKR_STAKING_PROGRAM = 'SKRskrmtL83pcL4YqLWt6iPefDqwXQWHSw9S9vz94BZ'
export const STAKE_CONFIG = '4HQy82s9CHTv1GsYKnANHMiHfhcqesYkK6sB3RDSYyqw'
export const GUARDIAN_POOL = 'DPJ58trLsF9yPrBa2pk6UaRkvqW8hWUYjawe788WBuqr'
export const SUBSCRIPTIONS_PROGRAM = 'De1egAFMkMWZSN5rYXRj9CAdheBamobVNubTsi9avR44'
export const ATA_PROGRAM = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL'

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

type Ix = { program: string; accounts: string[]; data: Uint8Array }

const refuse = (why: keyof typeof REFUSED): never => {
  throw new SignRefused(REFUSED[why])
}
const startsWith = (data: Uint8Array, prefix: readonly number[]) => data.length >= prefix.length && prefix.every((b, i) => data[i] === b)
const u64At = (d: Uint8Array, at: number) => new DataView(d.buffer, d.byteOffset, d.byteLength).getBigUint64(at, true)
const i64At = (d: Uint8Array, at: number) => new DataView(d.buffer, d.byteOffset, d.byteLength).getBigInt64(at, true)

/** The position the unstake and the cancel act on, derived here as api/src/lib/staking.ts userStakePda does (never read from the API). */
export async function userStakePda(user: string): Promise<string> {
  const enc = getAddressEncoder()
  const [pda] = await getProgramDerivedAddress({
    programAddress: SKR_STAKING_PROGRAM as Address,
    seeds: ['user_stake', enc.encode(STAKE_CONFIG as Address), enc.encode(user as Address), enc.encode(GUARDIAN_POOL as Address)],
  })
  return pda
}

/** The staking instruction both SKR flows build: one instruction, the expected discriminator, acting on the user's own position. */
async function oneStakingIx(ixs: Ix[], user: string, discriminator: readonly number[], dataLength: number): Promise<Ix> {
  if (ixs.length !== 1 || ixs[0].program !== SKR_STAKING_PROGRAM) refuse('program')
  const [ix] = ixs
  if (ix.data.length !== dataLength || !startsWith(ix.data, discriminator)) refuse('plan')
  // Accounts as the generated builders order them: userStake, stakeConfig, guardianPool, user, ...
  const [position, config, pool, owner] = ix.accounts
  if (position !== (await userStakePda(user)) || config !== STAKE_CONFIG || pool !== GUARDIAN_POOL || owner !== user) refuse('plan')
  return ix
}

/** Per flow, what the API's builder puts in (api/src/lib/staking.ts, subscriptions.ts, app/api/link/[code]); nothing else passes. */
async function checkInstructions(ixs: Ix[], flow: SignFlow): Promise<void> {
  switch (flow.kind) {
    case 'withdraw': {
      // unstake(shares: u128): the shares are the plan's, so the wallet signs the amount the screen showed and no more.
      const ix = await oneStakingIx(ixs, flow.user, UNSTAKE, 24)
      const shares = u64At(ix.data, 8) + (u64At(ix.data, 16) << 64n)
      if (!/^\d+$/.test(flow.shares) || shares === 0n || shares !== BigInt(flow.shares)) refuse('plan')
      return
    }
    case 'cancel':
      await oneStakingIx(ixs, flow.user, CANCEL_UNSTAKE, 8)
      return
    case 'revoke':
      // Revoke the delegation, then the authority; both name the user's own keys, and neither can pay anyone.
      if (ixs.length === 0) refuse('plan')
      for (const ix of ixs) {
        if (ix.program !== SUBSCRIPTIONS_PROGRAM) refuse('program')
        if (ix.data.length < 1 || (ix.data[0] !== SUB_REVOKE_DELEGATION && ix.data[0] !== SUB_REVOKE_AUTHORITY)) refuse('plan')
      }
      return
    case 'link': {
      // [create the USDC account], [revoke the old delegation], [init the authority], create the delegation: exactly one create,
      // from this wallet, at the limit the screen shows. A fixed delegation or a transfer (other discriminators) is refused.
      let creates = 0
      for (const ix of ixs) {
        if (ix.program === ATA_PROGRAM) {
          if (ix.data.length !== 1 || ix.data[0] !== ATA_CREATE_IDEMPOTENT) refuse('plan')
          continue
        }
        if (ix.program !== SUBSCRIPTIONS_PROGRAM) refuse('program')
        const kind = ix.data[0]
        if (kind === SUB_INIT || kind === SUB_REVOKE_DELEGATION) continue
        if (kind !== SUB_CREATE_RECURRING) refuse('plan')
        // data: u8 discriminator, nonce u64, amountPerPeriod u64, periodLengthS u64, startTs i64, expiryTs i64, initId i64.
        if (ix.data.length !== 49 || ix.accounts[0] !== flow.user) refuse('plan')
        if (u64At(ix.data, 9) !== LINK_DAILY_CAP_RAW || u64At(ix.data, 17) !== DAY_S || i64At(ix.data, 33) !== 0n) refuse('plan')
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
