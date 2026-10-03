import { describe, it, expect, vi } from 'vitest'
import {
  AccountRole, address, getBase64Decoder, getBase64Encoder, getCompiledTransactionMessageDecoder, getCompiledTransactionMessageEncoder,
  getTransactionDecoder, getTransactionEncoder, type Instruction, type Transaction,
} from '@solana/kit'
import { makeSigner, REFUSED, SignRefused, type SignFlow } from '@/lib/sign'
import { ATTACKER, cancelIx, linkIxs, OTHER, revokeIxs, unstakeIx, USER, wire } from '../fixtures/api-built'

/** A wallet stand-in that records what it was asked to sign and hands it back unchanged. */
function wallet() {
  return vi.fn(async (tx: Transaction) => tx)
}

async function refused(base64: string, flow: SignFlow, why: keyof typeof REFUSED) {
  const sign = wallet()
  const out = makeSigner(sign, flow)(base64)
  await expect(out).rejects.toThrow(SignRefused)
  await expect(out).rejects.toThrow(REFUSED[why])
  expect(sign).not.toHaveBeenCalled()
}

async function signed(base64: string, flow: SignFlow) {
  const sign = wallet()
  expect(await makeSigner(sign, flow)(base64)).toBe(base64)
  expect(sign).toHaveBeenCalledTimes(1)
}

/** Rewrites the compiled message (what a hostile API could send that kit's builder would never produce). */
function tamper(base64: string, edit: (m: Record<string, unknown>) => Record<string, unknown>): string {
  const tx = getTransactionDecoder().decode(getBase64Encoder().encode(base64))
  const m = getCompiledTransactionMessageDecoder().decode(tx.messageBytes) as unknown as Record<string, unknown>
  const messageBytes = getCompiledTransactionMessageEncoder().encode(edit(m) as never)
  return getBase64Decoder().decode(getTransactionEncoder().encode({ ...tx, messageBytes } as never))
}

const SYSTEM = address('11111111111111111111111111111111')
const TOKEN = address('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA')
/** System transfer of 1 SOL from the user to someone else: the drain the check exists for. */
const drain: Instruction = {
  programAddress: SYSTEM,
  accounts: [{ address: USER, role: AccountRole.WRITABLE_SIGNER }, { address: OTHER, role: AccountRole.WRITABLE }],
  data: new Uint8Array([2, 0, 0, 0, 0, 202, 154, 59, 0, 0, 0, 0]),
}
const withdraw = (shares = '5'): SignFlow => ({ kind: 'withdraw', user: USER, shares })
const cancel: SignFlow = { kind: 'cancel', user: USER }
const link: SignFlow = { kind: 'link', user: USER }
const revoke: SignFlow = { kind: 'revoke', user: USER }

/** Replaces bytes of the one instruction carrying `kind` as its first data byte (the create delegation is 2). */
async function linkWith(patch: (data: Uint8Array) => void, o: Parameters<typeof linkIxs>[0] = {}) {
  const ixs = await linkIxs(o)
  return ixs.map((ix) => {
    if (ix.data?.[0] !== 2) return ix
    const data = new Uint8Array(ix.data)
    patch(data)
    return { ...ix, data }
  })
}
/** The instruction with account `i` replaced (same role), or with one writable account added at the end. */
const at = (ix: Instruction, i: number, addr: Instruction['programAddress']): Instruction => ({ ...ix, accounts: (ix.accounts ?? []).map((m, j) => (j === i ? { ...m, address: addr } : m)) })
const plus = (ix: Instruction): Instruction => ({ ...ix, accounts: [...(ix.accounts ?? []), { address: OTHER, role: AccountRole.WRITABLE }] })
const mapFirst = async (ixs: Promise<Instruction[]>, f: (ix: Instruction) => Instruction) => (await ixs).map((ix, i) => (i === 0 ? f(ix) : ix))
const SUBS = address('De1egAFMkMWZSN5rYXRj9CAdheBamobVNubTsi9avR44')
const SKR = address('SKRbvo6Gf7GondiT3BbTfuRDPqLWei4j2Qy2NPGZhW3')
const setU64 = (d: Uint8Array, at: number, v: bigint) => new DataView(d.buffer).setBigUint64(at, v, true)

describe('makeSigner (security R207 #3: the app checks what the Seed Vault signs)', () => {
  describe('signs what the API builds', () => {
    it('withdraw: the unstake of the shares on the plan, from the user position', async () => signed(wire([await unstakeIx(5n)]), withdraw()))
    it('withdraw: shares past 64 bits read as the u128 the program takes', async () => signed(wire([await unstakeIx(2n ** 64n + 3n)]), withdraw(String(2n ** 64n + 3n))))
    it('put it back: the cancel_unstake on the user position', async () => signed(wire([await cancelIx()]), cancel))
    it('link: init + create at $5 a day', async () => signed(wire(await linkIxs()), link))
    it('link: a wallet with no USDC account (ATA create first) re-linking over a live delegation (revoke first)', async () =>
      signed(wire(await linkIxs({ createAta: true, revokeOld: true })), link))
    it('link: a re-link on an existing authority (the create alone)', async () => signed(wire(await linkIxs({ existingInitId: 9n })), link))
    it('revoke: the delegation then the authority', async () => signed(wire(await revokeIxs()), revoke))
  })

  describe('refuses, and the wallet is never asked', () => {
    it('bytes that are not a transaction', () => refused('not a transaction', cancel, 'unreadable'))
    it('a legacy message (the API compiles v0 only)', async () => {
      const legacy = tamper(wire([await cancelIx()]), (m) => ({ ...m, version: 'legacy' }))
      await refused(legacy, cancel, 'unreadable')
    })
    it('a lookup table', async () => {
      const looked = tamper(wire([await cancelIx()]), (m) => ({ ...m, addressTableLookups: [{ lookupTableAddress: OTHER, writableIndexes: [0], readonlyIndexes: [] }] }))
      await refused(looked, cancel, 'lookup')
    })
    it('an instruction index past the account list', async () => {
      const broken = tamper(wire([await cancelIx()]), (m) => ({ ...m, instructions: [{ programAddressIndex: 99, accountIndices: [], data: new Uint8Array() }] }))
      await refused(broken, cancel, 'unreadable')
    })
    it('a fee payer other than the user', async () => refused(wire([await cancelIx(OTHER)], OTHER), cancel, 'payer'))
    it('a second signer (an unstake for another key, paid by the user)', async () => refused(wire([await unstakeIx(5n, OTHER)]), withdraw(), 'signer'))
    it('withdraw with a System transfer added', async () => refused(wire([await unstakeIx(5n), drain]), withdraw(), 'program'))
    it('withdraw that is only a System transfer', async () => refused(wire([drain]), withdraw(), 'program'))
    it('withdraw with two unstakes', async () => refused(wire([await unstakeIx(5n), await unstakeIx(5n)]), withdraw(), 'program'))
    it('withdraw of more shares than the plan', async () => refused(wire([await unstakeIx(6n)]), withdraw('5'), 'plan'))
    it('withdraw of zero shares', async () => refused(wire([await unstakeIx(0n)]), withdraw('0'), 'plan'))
    it('withdraw against a plan whose shares are not a number', async () => refused(wire([await unstakeIx(5n)]), withdraw('5e3'), 'plan'))
    it('withdraw from another position', async () => refused(wire([await unstakeIx(5n, USER, OTHER)]), withdraw(), 'plan'))
    it('withdraw that is a cancel (another discriminator)', async () => refused(wire([await cancelIx()]), withdraw(), 'plan'))
    it('put it back that is an unstake', async () => refused(wire([await unstakeIx(5n)]), cancel, 'plan'))
    it('put it back on another position', async () => refused(wire([await cancelIx(USER, OTHER)]), cancel, 'plan'))
    it('put it back with a System transfer added', async () => refused(wire([await cancelIx(), drain]), cancel, 'program'))
    it('link with a System transfer added', async () => refused(wire([...(await linkIxs()), drain]), link, 'program'))
    it('link calling the Token program directly', async () =>
      refused(wire([...(await linkIxs()), { programAddress: TOKEN, accounts: [{ address: USER, role: AccountRole.WRITABLE_SIGNER }], data: new Uint8Array([4]) }]), link, 'program'))
    it('link at more than $5 a day', async () => refused(wire(await linkIxs({ capRaw: 500_000_000n })), link, 'plan'))
    it('link with a period other than a day', async () => refused(wire(await linkWith((d) => setU64(d, 17, 1n))), link, 'plan'))
    it('link with an expiry', async () => refused(wire(await linkWith((d) => setU64(d, 33, 1n))), link, 'plan'))
    it('link with a Subscriptions instruction other than init, create or revoke (a fixed delegation, 1)', async () =>
      refused(wire(await linkWith((d) => { d[0] = 1 })), link, 'plan'))
    it('link whose create carries other data', async () => {
      const ixs = await linkIxs()
      await refused(wire(ixs.map((ix) => (ix.data?.[0] === 2 ? { ...ix, data: new Uint8Array([...ix.data, 0]) } : ix))), link, 'plan')
    })
    it('link whose create names another delegator', async () => {
      const ixs = await linkIxs()
      const moved = ixs.map((ix) => (ix.data?.[0] === 2 ? { ...ix, accounts: [{ address: OTHER, role: AccountRole.WRITABLE }, ...(ix.accounts ?? []).slice(1)] } : ix))
      await refused(wire(moved), link, 'plan')
    })
    it('link with no create (init only)', async () => refused(wire((await linkIxs()).filter((ix) => ix.data?.[0] !== 2)), link, 'plan'))
    it('link with two creates', async () => {
      const ixs = await linkIxs()
      await refused(wire([...ixs, ...ixs.filter((ix) => ix.data?.[0] === 2)]), link, 'plan')
    })
    it('link whose associated-account call is not CreateIdempotent', async () => {
      const ixs = await linkIxs({ createAta: true })
      await refused(wire([{ ...ixs[0], data: new Uint8Array([0]) }, ...ixs.slice(1)]), link, 'plan')
    })
    it('link handed to the withdraw check', async () => refused(wire(await linkIxs()), withdraw(), 'program'))
    it('revoke that creates a delegation', async () => refused(wire([...(await revokeIxs()), ...(await linkIxs({ existingInitId: 9n }))]), revoke, 'plan'))
    it('revoke with a System transfer added', async () => refused(wire([...(await revokeIxs()), drain]), revoke, 'program'))
    it('revoke with no instruction', async () => refused(wire([]), revoke, 'plan'))

    // Review of 37ab59d: every account the builders emit is pinned, so a swapped or added account is refused too.
    it('link approving the $5 a day to a key that is not the puller', async () => refused(wire(await linkIxs({ delegatee: ATTACKER })), link, 'plan'))
    it('link naming the puller but the delegation account of another key', async () => {
      const theirs = (await linkIxs({ delegatee: ATTACKER })).find((ix) => ix.data?.[0] === 2)!
      const moved = (await linkIxs()).map((ix) => (ix.data?.[0] === 2 ? at(ix, 2, theirs.accounts![2].address) : ix))
      await refused(wire(moved), link, 'plan')
    })
    it('link whose create names another authority', async () => refused(wire((await linkIxs()).map((ix) => (ix.data?.[0] === 2 ? at(ix, 1, OTHER) : ix))), link, 'plan'))
    it('link whose create carries an extra account', async () => refused(wire((await linkIxs()).map((ix) => (ix.data?.[0] === 2 ? plus(ix) : ix))), link, 'plan'))
    it('link whose ATA create is for another owner', async () => refused(wire(await mapFirst(linkIxs({ createAta: true }), (ix) => at(ix, 2, OTHER))), link, 'plan'))
    it('link whose ATA create is for another mint', async () => refused(wire(await mapFirst(linkIxs({ createAta: true }), (ix) => at(ix, 3, SKR))), link, 'plan'))
    it('link whose ATA create makes another account', async () => refused(wire(await mapFirst(linkIxs({ createAta: true }), (ix) => at(ix, 1, OTHER))), link, 'plan'))
    it('link whose init names another USDC account', async () =>
      refused(wire((await linkIxs()).map((ix) => (ix.programAddress === SUBS && ix.data?.[0] === 0 ? at(ix, 3, OTHER) : ix))), link, 'plan'))
    it('link whose init carries data', async () =>
      refused(wire((await linkIxs()).map((ix) => (ix.programAddress === SUBS && ix.data?.[0] === 0 ? { ...ix, data: new Uint8Array([0, 1]) } : ix))), link, 'plan'))
    it('link whose old-delegation revoke carries an extra account', async () => refused(wire(await mapFirst(linkIxs({ revokeOld: true }), plus)), link, 'plan'))
    it('link whose old-delegation revoke carries data', async () =>
      refused(wire(await mapFirst(linkIxs({ revokeOld: true }), (ix) => ({ ...ix, data: new Uint8Array([3, 0]) }))), link, 'plan'))
    it('revoke whose authority revoke names another USDC account', async () => {
      const [del, auth] = await revokeIxs()
      await refused(wire([del, at(auth, 1, OTHER)]), revoke, 'plan')
    })
    it('revoke whose delegation revoke carries an extra account', async () => {
      const [del, auth] = await revokeIxs()
      await refused(wire([plus(del), auth]), revoke, 'plan')
    })
    it('revoke whose instruction carries extra data', async () => {
      const [del, auth] = await revokeIxs()
      await refused(wire([{ ...del, data: new Uint8Array([3, 0]) }, auth]), revoke, 'plan')
    })
    it('withdraw with another stake vault', async () => refused(wire([at(await unstakeIx(5n), 4, OTHER)]), withdraw(), 'plan'))
    it('withdraw with another event authority', async () => refused(wire([at(await unstakeIx(5n), 6, OTHER)]), withdraw(), 'plan'))
    it('withdraw with an extra writable account', async () => refused(wire([plus(await unstakeIx(5n))]), withdraw(), 'plan'))
    it('put it back with an extra writable account', async () => refused(wire([plus(await cancelIx())]), cancel, 'plan'))
    it('withdraw whose data is another staking instruction on the unstake accounts', async () => {
      const ix = await unstakeIx(5n)
      const data = new Uint8Array(ix.data!)
      data[0] ^= 1
      await refused(wire([{ ...ix, data }]), withdraw(), 'plan')
    })
    it('put it back whose data is another staking instruction on the cancel accounts', async () => {
      const ix = await cancelIx()
      await refused(wire([{ ...ix, data: new Uint8Array(8) }]), cancel, 'plan')
    })
    it('revoke with a one-byte Subscriptions call that is not a revoke (close authority, 6)', async () => {
      const [del, auth] = await revokeIxs()
      await refused(wire([{ ...del, data: new Uint8Array([6]) }, auth]), revoke, 'plan')
    })
    it('put it back with another stake vault', async () => refused(wire([at(await cancelIx(), 4, OTHER)]), cancel, 'plan'))
  })
})
