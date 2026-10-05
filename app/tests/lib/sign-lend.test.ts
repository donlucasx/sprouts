import { describe, it, expect, vi } from 'vitest'
import {
  AccountRole, address, getBase64Decoder, getBase64Encoder, getCompiledTransactionMessageDecoder, getCompiledTransactionMessageEncoder,
  getTransactionDecoder, getTransactionEncoder, type Instruction, type Transaction,
} from '@solana/kit'
import { JLEND, KLEND_RESERVE, makeSigner, REFUSED, SignRefused, type SignFlow } from '@/lib/sign'
import { ATTACKER, OTHER, USER, wire } from '../fixtures/api-built'
import { ataOf, ix, jlendWithdrawIxs, klendWithdrawIxs, KRES, L, u64le } from '../fixtures/lend-built'

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
function tamper(base64: string, edit: (m: Record<string, unknown>) => Record<string, unknown>): string {
  const tx = getTransactionDecoder().decode(getBase64Encoder().encode(base64))
  const m = getCompiledTransactionMessageDecoder().decode(tx.messageBytes) as unknown as Record<string, unknown>
  return getBase64Decoder().decode(getTransactionEncoder().encode({ ...tx, messageBytes: getCompiledTransactionMessageEncoder().encode(edit(m) as never) } as never))
}
const drain: Instruction = {
  programAddress: address('11111111111111111111111111111111'),
  accounts: [{ address: USER, role: AccountRole.WRITABLE_SIGNER }, { address: OTHER, role: AccountRole.WRITABLE }],
  data: new Uint8Array([2, 0, 0, 0, 0, 202, 154, 59, 0, 0, 0, 0]),
}
const plus = (i: Instruction): Instruction => ({ ...i, accounts: [...(i.accounts ?? []), { address: OTHER, role: AccountRole.WRITABLE }] })
const at = (i: Instruction, n: number, a: string): Instruction => ({ ...i, accounts: (i.accounts ?? []).map((m, j) => (j === n ? { ...m, address: address(a) } : m)) })
const kFlow = (asset: 'USDC_LEND' | 'SOL_LEND', receiptRaw: string): SignFlow => ({ kind: 'withdraw_klend', user: USER, asset, receiptRaw })
const jFlow = (asset: 'USDC_LEND' | 'SOL_LEND', receiptRaw: string): SignFlow => ({ kind: 'withdraw_jlend', user: USER, asset, receiptRaw })
const kUsdc = () => klendWithdrawIxs({ asset: 'USDC_LEND', amount: 1661200n })

describe('withdraw a lending position (contracts 6): signs exactly what the builders make', () => {
  it("K-Lend USDC: refresh, then redeem the position into this wallet's USDC account", async () => signed(wire(await kUsdc()), kFlow('USDC_LEND', '1661200')))
  it('K-Lend USDC with the USDC account created first', async () => signed(wire(await klendWithdrawIxs({ asset: 'USDC_LEND', amount: 1661200n, createAta: true })), kFlow('USDC_LEND', '1661200')))
  it('K-Lend SOL: create the WSOL account, refresh, redeem, close it so SOL lands', async () => signed(wire(await klendWithdrawIxs({ asset: 'SOL_LEND', amount: 1340000n })), kFlow('SOL_LEND', '1340000')))
  it('Jupiter Lend USDC: redeem the shares', async () => signed(wire(await jlendWithdrawIxs({ asset: 'USDC_LEND', amount: 940000n })), jFlow('USDC_LEND', '940000')))
  it('Jupiter Lend USDC with the USDC account created first', async () => signed(wire(await jlendWithdrawIxs({ asset: 'USDC_LEND', amount: 940000n, createAta: true })), jFlow('USDC_LEND', '940000')))
  it('Jupiter Lend SOL: redeem, then close the WSOL account', async () => signed(wire(await jlendWithdrawIxs({ asset: 'SOL_LEND', amount: 9408000n })), jFlow('SOL_LEND', '9408000')))
})

describe('refuses, and the Seed Vault is never asked', () => {
  it("K-Lend redeem into another wallet's USDC account", async () =>
    refused(wire(await klendWithdrawIxs({ asset: 'USDC_LEND', amount: 1661200n, dest: await ataOf(ATTACKER, L.USDC) })), kFlow('USDC_LEND', '1661200'), 'plan'))
  it('K-Lend redeem from the junk 8.6% reserve', async () =>
    refused(wire(await klendWithdrawIxs({ asset: 'USDC_LEND', amount: 1661200n, reserve: L.JUNK_RESERVE })), kFlow('USDC_LEND', '1661200'), 'plan'))
  it('K-Lend redeem of more than the position on screen', async () =>
    refused(wire(await klendWithdrawIxs({ asset: 'USDC_LEND', amount: 1661201n })), kFlow('USDC_LEND', '1661200'), 'plan'))
  it('a position on screen of zero, negative or not a number', async () => {
    const tx = wire(await kUsdc())
    for (const r of ['0', '-1', '5e3', '']) await refused(tx, kFlow('USDC_LEND', r), 'plan')
  })
  it('K-Lend with a System transfer added', async () => refused(wire([...(await kUsdc()), drain]), kFlow('USDC_LEND', '1661200'), 'program'))
  it('K-Lend without the refresh', async () => refused(wire((await kUsdc()).slice(1)), kFlow('USDC_LEND', '1661200'), 'plan'))
  it('K-Lend redeem before its refresh', async () => {
    const [r, x] = await kUsdc()
    await refused(wire([x, r]), kFlow('USDC_LEND', '1661200'), 'plan')
  })
  it('K-Lend SOL that leaves the SOL wrapped (no close)', async () =>
    refused(wire(await klendWithdrawIxs({ asset: 'SOL_LEND', amount: 1340000n, close: false })), kFlow('SOL_LEND', '1340000'), 'plan'))
  it('K-Lend SOL whose close pays the lamports to someone else', async () => {
    const ixs = await klendWithdrawIxs({ asset: 'SOL_LEND', amount: 1340000n })
    const wsol = await ataOf(USER, L.WSOL)
    await refused(wire([...ixs.slice(0, 3), ix(L.TOKEN, [wsol, OTHER, USER], [9])]), kFlow('SOL_LEND', '1340000'), 'plan')
  })
  it('K-Lend SOL without creating the WSOL account', async () =>
    refused(wire(await klendWithdrawIxs({ asset: 'SOL_LEND', amount: 1340000n, createAta: false })), kFlow('SOL_LEND', '1340000'), 'plan'))
  it('K-Lend redeem with an extra account', async () => {
    const [r, x] = await kUsdc()
    await refused(wire([r, plus(x)]), kFlow('USDC_LEND', '1661200'), 'plan')
  })
  it('K-Lend redeem with trailing data', async () => {
    const [r, x] = await kUsdc()
    await refused(wire([r, { ...x, data: new Uint8Array([...x.data!, 0]) }]), kFlow('USDC_LEND', '1661200'), 'plan')
  })
  it('K-Lend refresh of another reserve', async () => {
    const [r, x] = await kUsdc()
    await refused(wire([at(r, 0, KRES.SOL_LEND.reserve), x]), kFlow('USDC_LEND', '1661200'), 'plan')
  })
  it('an associated-account call that is not CreateIdempotent', async () => {
    const ixs = await klendWithdrawIxs({ asset: 'USDC_LEND', amount: 1661200n, createAta: true })
    await refused(wire([{ ...ixs[0], data: new Uint8Array([0]) }, ...ixs.slice(1)]), kFlow('USDC_LEND', '1661200'), 'plan')
  })
  it('a K-Lend transaction handed to the Jupiter Lend check', async () => refused(wire(await kUsdc()), jFlow('USDC_LEND', '1661200'), 'program'))
  it('Jupiter Lend redeem with another claim account', async () => {
    const [x] = await jlendWithdrawIxs({ asset: 'USDC_LEND', amount: 940000n })
    await refused(wire([at(x, 11, OTHER)]), jFlow('USDC_LEND', '940000'), 'plan')
  })
  it("Jupiter Lend redeem into another wallet's USDC account", async () =>
    refused(wire(await jlendWithdrawIxs({ asset: 'USDC_LEND', amount: 940000n, dest: await ataOf(ATTACKER, L.USDC) })), jFlow('USDC_LEND', '940000'), 'plan'))
  it('Jupiter Lend redeem with an account missing', async () => {
    const [x] = await jlendWithdrawIxs({ asset: 'USDC_LEND', amount: 940000n })
    await refused(wire([{ ...x, accounts: x.accounts!.slice(0, 17) }]), jFlow('USDC_LEND', '940000'), 'plan')
  })
  it('a Jupiter Lend USDC withdraw built from the SOL accounts', async () =>
    refused(wire(await jlendWithdrawIxs({ asset: 'SOL_LEND', amount: 940000n, close: false })), jFlow('USDC_LEND', '940000'), 'plan'))
  it('a fee payer other than the user', async () => refused(wire(await kUsdc(), OTHER), kFlow('USDC_LEND', '1661200'), 'payer'))
  it('a lookup table', async () =>
    refused(tamper(wire(await kUsdc()), (m) => ({ ...m, addressTableLookups: [{ lookupTableAddress: OTHER, writableIndexes: [0], readonlyIndexes: [] }] })), kFlow('USDC_LEND', '1661200'), 'lookup'))
  it('a Token-2022 instruction added', async () => refused(wire([...(await kUsdc()), ix(L.TOKEN_2022, [USER], [4])]), kFlow('USDC_LEND', '1661200'), 'program'))
  it('K-Lend SOL with a Token transfer of the USDC account appended after the close', async () => {
    const ixs = await klendWithdrawIxs({ asset: 'SOL_LEND', amount: 1340000n })
    const transfer = ix(L.TOKEN, [await ataOf(USER, L.USDC), await ataOf(ATTACKER, L.USDC), USER], [3, ...u64le(5_000_000n)])
    await refused(wire([...ixs, transfer]), kFlow('SOL_LEND', '1340000'), 'plan')
  })
  it('Jupiter Lend SOL with a second close appended', async () => {
    const ixs = await jlendWithdrawIxs({ asset: 'SOL_LEND', amount: 9408000n })
    await refused(wire([...ixs, ixs[ixs.length - 1]]), jFlow('SOL_LEND', '9408000'), 'plan')
  })
  it('a redeem of zero against a position on screen of zero', async () =>
    refused(wire(await klendWithdrawIxs({ asset: 'USDC_LEND', amount: 0n })), kFlow('USDC_LEND', '0'), 'plan'))
  it('a flow whose asset is not a lending leg', async () => refused(wire(await kUsdc()), { kind: 'withdraw_klend', user: USER, asset: 'cbBTC' as never, receiptRaw: '1661200' }, 'plan'))
})

/**
 * Pre-flight addition (controller, 10-05): every account of every instruction in every signed withdraw shape, swapped one at a time for the
 * attacker's key, is refused and the Seed Vault is never asked. The cases above swap 4 accounts by hand; this swaps all of them.
 */
describe('every single-account substitution in the four withdraw flows is refused', () => {
  it('refuses each one, and counts them all', async () => {
    const shapes: { name: string; ixs: Instruction[]; flow: SignFlow }[] = [
      { name: 'K-Lend USDC', ixs: await kUsdc(), flow: kFlow('USDC_LEND', '1661200') },
      { name: 'K-Lend USDC + create', ixs: await klendWithdrawIxs({ asset: 'USDC_LEND', amount: 1661200n, createAta: true }), flow: kFlow('USDC_LEND', '1661200') },
      { name: 'K-Lend SOL', ixs: await klendWithdrawIxs({ asset: 'SOL_LEND', amount: 1340000n }), flow: kFlow('SOL_LEND', '1340000') },
      { name: 'Jupiter Lend USDC', ixs: await jlendWithdrawIxs({ asset: 'USDC_LEND', amount: 940000n }), flow: jFlow('USDC_LEND', '940000') },
      { name: 'Jupiter Lend USDC + create', ixs: await jlendWithdrawIxs({ asset: 'USDC_LEND', amount: 940000n, createAta: true }), flow: jFlow('USDC_LEND', '940000') },
      { name: 'Jupiter Lend SOL', ixs: await jlendWithdrawIxs({ asset: 'SOL_LEND', amount: 9408000n }), flow: jFlow('SOL_LEND', '9408000') },
    ]
    const passed: string[] = []
    let tried = 0
    for (const s of shapes) {
      await signed(wire(s.ixs), s.flow) // the untouched shape signs, so each refusal below is the substitution's
      for (const [n, x] of s.ixs.entries()) {
        for (const [a, m] of (x.accounts ?? []).entries()) {
          if (m.address === ATTACKER) continue
          tried++
          const sign = wallet()
          const tx = wire(s.ixs.map((y, k) => (k === n ? at(y, a, ATTACKER) : y)))
          const ok = await makeSigner(sign, s.flow)(tx).then(() => true, (e: unknown) => !(e instanceof SignRefused))
          if (ok || sign.mock.calls.length > 0) passed.push(`${s.name} ix ${n} account ${a}`)
        }
      }
    }
    expect(passed).toEqual([])
    // 18 + 24 + 27 (K-Lend: 6 refresh + 12 redeem, 6 create, 3 close) + 18 + 24 + 21 (Jupiter Lend: 18 redeem, 6 create, 3 close)
    expect(tried).toBe(132)
  })
})

describe('the pinned venue tables cannot be loosened at runtime (T6 review Minor 1)', () => {
  it('a write into KLEND_RESERVE or JLEND, at either level, throws and changes nothing', async () => {
    const before = JSON.stringify([KLEND_RESERVE, JLEND])
    const k = KLEND_RESERVE as unknown as Record<string, Record<string, string>>
    const j = JLEND as unknown as Record<string, Record<string, string>>
    expect(() => { k.USDC_LEND.supplyVault = ATTACKER }).toThrow(TypeError)
    expect(() => { k.SOL_LEND = { reserve: ATTACKER } }).toThrow(TypeError)
    expect(() => { delete k.USDC_LEND }).toThrow(TypeError)
    expect(() => { j.USDC_LEND.claimAccount = ATTACKER }).toThrow(TypeError)
    expect(() => { j.SOL_LEND = { lending: ATTACKER } }).toThrow(TypeError)
    expect(() => { j.USDC_LEND.extra = ATTACKER }).toThrow(TypeError)
    expect(JSON.stringify([KLEND_RESERVE, JLEND])).toBe(before)
    for (const t of [KLEND_RESERVE, JLEND]) for (const v of [t, t.USDC_LEND, t.SOL_LEND]) expect(Object.isFrozen(v)).toBe(true)
    await signed(wire(await kUsdc()), kFlow('USDC_LEND', '1661200'))
  })
})

describe('a lending-shaped flow of a kind the check does not know (T8 review Important 1)', () => {
  it('carrying asset and receiptRaw, against a valid Jupiter Lend redeem, is refused, not checked as Jupiter', async () => {
    const tx = wire(await jlendWithdrawIxs({ asset: 'USDC_LEND', amount: 940000n }))
    await signed(tx, jFlow('USDC_LEND', '940000'))   // the same transaction signs under its own kind
    await refused(tx, { kind: 'move_klend_to_jlend', user: USER, asset: 'USDC_LEND', receiptRaw: '940000' } as unknown as SignFlow, 'plan')
  })
})
