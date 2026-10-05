import { describe, it, expect, vi } from 'vitest'
import { AccountRole, address, getAddressEncoder, getProgramDerivedAddress, type Address, type Instruction, type Transaction } from '@solana/kit'
import { leashPda, LEASH_PROGRAM, makeSigner, REFUSED, SignRefused, type SignFlow } from '@/lib/sign'
import { ATTACKER, linkIxs, OTHER, PULLER, USER, wire } from '../fixtures/api-built'
import { buildRevokeDelegationIx, delegationPda } from '../../../api/src/lib/subscriptions'

const enc = (a: string) => getAddressEncoder().encode(address(a))
/** Contracts 2.2: ["leash", delegator, user] under the leash program, derived here, not by sign.ts. */
const leashOf = async (delegator: string, user: string) => (await getProgramDerivedAddress({ programAddress: address(LEASH_PROGRAM), seeds: ['leash', enc(delegator), enc(user)] }))[0] as Address
const relink: SignFlow = { kind: 'relink', user: USER }
const link: SignFlow = { kind: 'link', user: USER }
const wallet = () => vi.fn(async (tx: Transaction) => tx)
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
const drain: Instruction = { programAddress: address('11111111111111111111111111111111'), accounts: [{ address: USER, role: AccountRole.WRITABLE_SIGNER }, { address: OTHER, role: AccountRole.WRITABLE }], data: new Uint8Array([2, 0, 0, 0, 0, 202, 154, 59, 0, 0, 0, 0]) }
const patchCreate = (ixs: Instruction[], f: (d: Uint8Array) => void) => ixs.map((i) => { if (i.data?.[0] !== 2) return i; const d = new Uint8Array(i.data); f(d); return { ...i, data: d } })
const setU64 = (d: Uint8Array, at: number, v: bigint) => new DataView(d.buffer).setBigUint64(at, v, true)

describe('the leash PDA (contracts 2.2, 5.5)', () => {
  it('is the contract derivation, ordered delegator then user', async () => {
    expect(await leashPda(USER, USER)).toBe(await leashOf(USER, USER))
    expect(await leashPda(USER, OTHER)).toBe(await leashOf(USER, OTHER))
    expect(await leashPda(USER, OTHER)).not.toBe(await leashPda(OTHER, USER))
  })
})

describe('relink: one Seed Vault signature that revokes the old approval and makes the leash one (R287, spec 6.5)', () => {
  it("revoke the old puller delegation, create one to this wallet's own leash PDA", async () =>
    signed(wire(await linkIxs({ delegatee: await leashOf(USER, USER), revokeOld: true })), relink))
  it('a wallet with no USDC account and no authority yet (create, init, create delegation)', async () =>
    signed(wire(await linkIxs({ delegatee: await leashOf(USER, USER), createAta: true })), relink))
  it('on an existing authority (the create alone)', async () => signed(wire(await linkIxs({ delegatee: await leashOf(USER, USER), existingInitId: 9n })), relink))
  it('refuses the puller (the old model) as the new delegatee', async () => refused(wire(await linkIxs({ revokeOld: true })), relink, 'plan'))
  it('refuses an attacker key', async () => refused(wire(await linkIxs({ delegatee: ATTACKER })), relink, 'plan'))
  it('refuses the leash PDA of this wallet and ANOTHER garden (cross-pair)', async () => refused(wire(await linkIxs({ delegatee: await leashOf(USER, ATTACKER) })), relink, 'plan'))
  it('refuses the leash PDA of another delegator', async () => refused(wire(await linkIxs({ delegatee: await leashOf(ATTACKER, USER) })), relink, 'plan'))
  it('refuses two revokes', async () => {
    const ixs = await linkIxs({ delegatee: await leashOf(USER, USER), revokeOld: true })
    ixs.unshift(buildRevokeDelegationIx({ delegator: USER, delegationPda: await delegationPda({ delegator: USER, delegatee: PULLER, nonce: 8n }) }) as Instruction)
    await refused(wire(ixs), relink, 'plan')
  })
  it('refuses a revoke with no new delegation', async () => refused(wire((await linkIxs({ delegatee: await leashOf(USER, USER), revokeOld: true })).filter((i) => i.data?.[0] !== 2)), relink, 'plan'))
  it('refuses more than $5 a day', async () => refused(wire(await linkIxs({ delegatee: await leashOf(USER, USER), capRaw: 500_000_000n })), relink, 'plan'))
  it('refuses a period other than a day', async () => refused(wire(patchCreate(await linkIxs({ delegatee: await leashOf(USER, USER) }), (d) => setU64(d, 17, 1n))), relink, 'plan'))
  it('refuses an expiry', async () => refused(wire(patchCreate(await linkIxs({ delegatee: await leashOf(USER, USER) }), (d) => setU64(d, 33, 1n))), relink, 'plan'))
  it('refuses a System transfer added', async () => refused(wire([...(await linkIxs({ delegatee: await leashOf(USER, USER) })), drain]), relink, 'program'))
  it('refuses a create with an extra account', async () => {
    const ixs = (await linkIxs({ delegatee: await leashOf(USER, USER) })).map((i) => (i.data?.[0] === 2 ? { ...i, accounts: [...(i.accounts ?? []), { address: OTHER, role: AccountRole.WRITABLE }] } : i))
    await refused(wire(ixs), relink, 'plan')
  })
})

describe('Review Focus 5: link after go-live (new links point at the leash PDA)', () => {
  it('link: the leash PDA of this user is accepted', async () => signed(wire(await linkIxs({ delegatee: await leashOf(USER, USER) })), link))
  it('link: the puller is still accepted before go-live', async () => signed(wire(await linkIxs()), link))
  it('link: the leash PDA of another user is refused', async () => refused(wire(await linkIxs({ delegatee: await leashOf(USER, ATTACKER) })), link, 'plan'))
})

/** Contracts 5.5 order: [ATA create], [revoke], [init], create (the link page prepends its revoke instead; both orders are the API's). */
async function relinkShapes(): Promise<[string, Instruction[]][]> {
  const leash = await leashOf(USER, USER)
  const full = await linkIxs({ delegatee: leash, createAta: true, revokeOld: true }) // [revoke, ATA, init, create]
  return [
    ['revoke, init, create', await linkIxs({ delegatee: leash, revokeOld: true })],
    ['ATA, init, create', await linkIxs({ delegatee: leash, createAta: true })],
    ['create alone', await linkIxs({ delegatee: leash, existingInitId: 9n })],
    ['revoke, create alone', await linkIxs({ delegatee: leash, existingInitId: 9n, revokeOld: true })],
    ['revoke, ATA, init, create (link page order)', full],
    ['ATA, revoke, init, create (contracts 5.5 order)', [full[1], full[0], full[2], full[3]]],
  ]
}
const isRevoke = (i: Instruction) => i.data?.length === 1 && i.data[0] === 3

describe('relink: the exact shape (contracts 5.5, 6; AMEND 10-04 s20)', () => {
  it('signs every shape the API builds (both revoke positions)', async () => {
    for (const [, ixs] of await relinkShapes()) await signed(wire(ixs), relink)
  })
  it('refuses a ComputeBudget instruction (no priority-fee drain)', async () => {
    const price: Instruction = { programAddress: address('ComputeBudget111111111111111111111111111111'), accounts: [], data: new Uint8Array([3, 0, 0, 0, 0, 0, 0, 0, 1]) }
    for (const [, ixs] of await relinkShapes()) await refused(wire([price, ...ixs]), relink, 'program')
  })
  it('refuses a create that is not last (a revoke after it could close the new delegation)', async () => {
    const ixs = await linkIxs({ delegatee: await leashOf(USER, USER), revokeOld: true }) // [revoke, init, create]
    await refused(wire([ixs[1], ixs[2], ixs[0]]), relink, 'plan')
    // On an existing authority there is no init, so only the create-last rule stands between this order and a signature.
    const [revoke, create] = await linkIxs({ delegatee: await leashOf(USER, USER), existingInitId: 9n, revokeOld: true })
    await refused(wire([create, revoke]), relink, 'plan')
    await refused(wire([create, revoke]), link, 'plan')
  })
  it('refuses the init before the ATA create, a second ATA create, a second init', async () => {
    const [ata, init, create] = await linkIxs({ delegatee: await leashOf(USER, USER), createAta: true })
    await refused(wire([init, ata, create]), relink, 'plan')
    await refused(wire([ata, ata, init, create]), relink, 'plan')
    await refused(wire([ata, init, init, create]), relink, 'plan')
  })
  it('refuses a revoke between the init and the create', async () => {
    const [revoke, init, create] = await linkIxs({ delegatee: await leashOf(USER, USER), revokeOld: true })
    await refused(wire([init, revoke, create]), relink, 'plan')
  })
  it('refuses a revoke that names the delegation this transaction creates', async () => {
    const ixs = await linkIxs({ delegatee: await leashOf(USER, USER), revokeOld: true })
    const created = ixs.find((i) => i.data?.[0] === 2)!.accounts![2].address
    await refused(wire(ixs.map((i) => (isRevoke(i) ? { ...i, accounts: [i.accounts![0], { ...i.accounts![1], address: created }] } : i))), relink, 'plan')
  })
  it('a relink handed to the link check still signs (link accepts the leash PDA too); a link to the puller handed to relink does not', async () => {
    const ixs = await linkIxs({ delegatee: await leashOf(USER, USER), revokeOld: true })
    await signed(wire(ixs), link)
    await refused(wire(await linkIxs({ revokeOld: true })), relink, 'plan')
  })
})

describe('every single-account substitution in every relink shape is refused', () => {
  it('refuses each one, and counts them all (the revoked delegation is the one free slot, by design)', async () => {
    let tried = 0
    let free = 0
    for (const [name, ixs] of await relinkShapes()) {
      for (let n = 0; n < ixs.length; n++) {
        for (let a = 0; a < (ixs[n].accounts?.length ?? 0); a++) {
          const swapped = ixs.map((i, j) => (j === n ? { ...i, accounts: i.accounts!.map((m, k) => (k === a ? { ...m, address: ATTACKER } : m)) } : i))
          const sign = wallet()
          const out = makeSigner(sign, relink)(wire(swapped))
          if (isRevoke(ixs[n]) && a === 1) {
            // Contracts 6: RevokeDelegation [user, null]; the old delegation's nonce is not on the phone. It can only close a delegation
            // this wallet signed for (or fail on chain); it cannot name the new one (tested above).
            await expect(out, `${name}: ix ${n} account ${a}`).resolves.toBeTypeOf('string')
            free++
            continue
          }
          await expect(out, `${name}: ix ${n} account ${a}`).rejects.toThrow(SignRefused)
          expect(sign).not.toHaveBeenCalled()
          tried++
        }
      }
    }
    // Accounts per ix: revoke 2, ATA 6, init 6, create 5. Shapes: 13-1, 17, 5, 7-1, 19-1, 19-1 = 76 tried, 4 free.
    expect(tried).toBe(76)
    expect(free).toBe(4)
  })
})

describe('link and unknown flows (T7 review)', () => {
  it('link refuses two revokes (the link page only ever adds one)', async () => {
    const ixs = await linkIxs({ revokeOld: true })
    ixs.unshift(buildRevokeDelegationIx({ delegator: USER, delegationPda: await delegationPda({ delegator: USER, delegatee: PULLER, nonce: 8n }) }) as Instruction)
    await refused(wire(ixs), link, 'plan')
  })
  it('link with one revoke still signs', async () => signed(wire(await linkIxs({ revokeOld: true })), link))
  it('a flow kind the check does not know is refused', async () =>
    refused(wire(await linkIxs()), { kind: 'mystery', user: USER } as unknown as SignFlow, 'plan'))
})
