import { describe, it, expect, vi } from 'vitest'
import { address, type Instruction, type Transaction } from '@solana/kit'
import { makeBatchSigner, makeSigner, REFUSED, SignRefused, type MovePart, type SignFlow } from '@/lib/sign'
import { ATTACKER, OTHER, USER, wire } from '../fixtures/api-built'
import { ataOf, ix, jlendDepositIxs, jlendWithdrawIxs, JRES, klendDepositIxs, klendWithdrawIxs, KRES, L } from '../fixtures/lend-built'

type Kind = 'move_klend_to_jlend' | 'move_jlend_to_klend'
type Asset = 'USDC_LEND' | 'SOL_LEND'
const flow = (kind: Kind, asset: Asset, part: MovePart, receiptRaw: string, depositRaw: string): SignFlow => ({ kind, user: USER, asset, receiptRaw, depositRaw, part })
async function refused(base64: string, f: SignFlow, why: keyof typeof REFUSED) {
  const sign = vi.fn(async (tx: Transaction) => tx)
  const out = makeSigner(sign, f)(base64)
  await expect(out).rejects.toThrow(SignRefused)
  await expect(out).rejects.toThrow(REFUSED[why])
  expect(sign).not.toHaveBeenCalled()
}
async function signed(base64: string, f: SignFlow) {
  const sign = vi.fn(async (tx: Transaction) => tx)
  expect(await makeSigner(sign, f)(base64)).toBe(base64)
  expect(sign).toHaveBeenCalledTimes(1)
}
const at = (i: Instruction, n: number, a: string): Instruction => ({ ...i, accounts: (i.accounts ?? []).map((m, j) => (j === n ? { ...m, address: address(a) } : m)) })

describe('a move between lending venues (contracts 6, R279: same asset, Kamino and Jupiter only)', () => {
  it('whole, USDC Kamino to Jupiter: redeem then deposit in one transaction', async () =>
    signed(wire([...(await klendWithdrawIxs({ asset: 'USDC_LEND', amount: 1661200n })), ...(await jlendDepositIxs({ asset: 'USDC_LEND', amount: 1999000n, createAta: true }))]), flow('move_klend_to_jlend', 'USDC_LEND', 'whole', '1661200', '1999000')))
  it('whole, SOL Jupiter to Kamino: the WSOL stays open between them and closes at the end', async () =>
    signed(wire([...(await jlendWithdrawIxs({ asset: 'SOL_LEND', amount: 9408000n, close: false })), ...(await klendDepositIxs({ asset: 'SOL_LEND', amount: 9999000n }))]), flow('move_jlend_to_klend', 'SOL_LEND', 'whole', '9408000', '9999000')))
  it('the redeem part keeps the WSOL open; closing it there is refused', async () => {
    await signed(wire(await klendWithdrawIxs({ asset: 'SOL_LEND', amount: 1340000n, close: false })), flow('move_klend_to_jlend', 'SOL_LEND', 'redeem', '1340000', '1600000'))
    // C4: the close is a Token instruction, a program outside the redeem part's set
    await refused(wire(await klendWithdrawIxs({ asset: 'SOL_LEND', amount: 1340000n })), flow('move_klend_to_jlend', 'SOL_LEND', 'redeem', '1340000', '1600000'), 'program')
    await refused(wire(await jlendWithdrawIxs({ asset: 'SOL_LEND', amount: 9408000n })), flow('move_jlend_to_klend', 'SOL_LEND', 'redeem', '9408000', '9999000'), 'program')
  })
  it('the SOL deposit part spends the WSOL and closes it; leaving it open is refused', async () => {
    await signed(wire(await jlendDepositIxs({ asset: 'SOL_LEND', amount: 1600000n })), flow('move_klend_to_jlend', 'SOL_LEND', 'deposit', '1340000', '1600000'))
    await refused(wire(await jlendDepositIxs({ asset: 'SOL_LEND', amount: 1600000n, close: false })), flow('move_klend_to_jlend', 'SOL_LEND', 'deposit', '1340000', '1600000'), 'plan')
    await refused(wire(await klendDepositIxs({ asset: 'SOL_LEND', amount: 9999000n, close: false })), flow('move_jlend_to_klend', 'SOL_LEND', 'deposit', '9408000', '9999000'), 'plan')
  })
  it('a deposit of another amount than the screen shows', async () =>
    refused(wire(await jlendDepositIxs({ asset: 'USDC_LEND', amount: 1999001n })), flow('move_klend_to_jlend', 'USDC_LEND', 'deposit', '1661200', '1999000'), 'plan'))
  it('a redeem of another amount than the card shows', async () =>
    refused(wire(await klendWithdrawIxs({ asset: 'USDC_LEND', amount: 1661201n })), flow('move_klend_to_jlend', 'USDC_LEND', 'redeem', '1661200', '1999000'), 'plan'))
  it("a deposit into another wallet's receipt account", async () => {
    await refused(wire(await jlendDepositIxs({ asset: 'USDC_LEND', amount: 1999000n, dest: await ataOf(ATTACKER, JRES.USDC_LEND.fMint) })), flow('move_klend_to_jlend', 'USDC_LEND', 'deposit', '1661200', '1999000'), 'plan')
    await refused(wire(await klendDepositIxs({ asset: 'USDC_LEND', amount: 1999000n, dest: await ataOf(ATTACKER, KRES.USDC_LEND.kMint) })), flow('move_jlend_to_klend', 'USDC_LEND', 'deposit', '940000', '1999000'), 'plan')
  })
  it('a "move" that redeems from Kamino and deposits back into Kamino', async () =>
    refused(wire([...(await klendWithdrawIxs({ asset: 'USDC_LEND', amount: 1661200n })), ...(await klendDepositIxs({ asset: 'USDC_LEND', amount: 1999000n }))]), flow('move_klend_to_jlend', 'USDC_LEND', 'whole', '1661200', '1999000'), 'plan'))
  it('deposit before redeem in one transaction', async () =>
    refused(wire([...(await jlendDepositIxs({ asset: 'USDC_LEND', amount: 1999000n })), ...(await klendWithdrawIxs({ asset: 'USDC_LEND', amount: 1661200n }))]), flow('move_klend_to_jlend', 'USDC_LEND', 'whole', '1661200', '1999000'), 'plan'))
  it('the whole move under the other direction', async () =>
    refused(wire([...(await klendWithdrawIxs({ asset: 'USDC_LEND', amount: 1661200n })), ...(await jlendDepositIxs({ asset: 'USDC_LEND', amount: 1999000n }))]), flow('move_jlend_to_klend', 'USDC_LEND', 'whole', '1661200', '1999000'), 'plan'))
  it('a deposit amount on screen of zero or not a number, and a part that is not one of the three', async () => {
    const tx = wire(await jlendDepositIxs({ asset: 'USDC_LEND', amount: 1999000n }))
    for (const d of ['0', '-1', '1e6', '']) await refused(tx, flow('move_klend_to_jlend', 'USDC_LEND', 'deposit', '1661200', d), 'plan')
    await refused(tx, flow('move_klend_to_jlend', 'USDC_LEND', 'both' as never, '1661200', '1999000'), 'plan')
    await refused(tx, { kind: 'move_klend_to_jlend', user: USER, asset: 'cbBTC' as never, receiptRaw: '1661200', depositRaw: '1999000', part: 'deposit' }, 'plan')
  })
  it('a System transfer added after the deposit', async () => {
    const drain = ix(L.SYSTEM, [USER, OTHER], [2, 0, 0, 0, 0, 202, 154, 59, 0, 0, 0, 0])
    await refused(wire([...(await jlendDepositIxs({ asset: 'USDC_LEND', amount: 1999000n })), drain]), flow('move_klend_to_jlend', 'USDC_LEND', 'deposit', '1661200', '1999000'), 'program')
  })
  it('a SOL deposit whose close pays the lamports to someone else', async () => {
    const ixs = await klendDepositIxs({ asset: 'SOL_LEND', amount: 9999000n })
    await refused(wire([...ixs.slice(0, -1), ix(L.TOKEN, [await ataOf(USER, L.WSOL), OTHER, USER], [9])]), flow('move_jlend_to_klend', 'SOL_LEND', 'deposit', '9408000', '9999000'), 'plan')
  })
})

describe('moves and withdraws never stand in for each other (T14 carry-in)', () => {
  it('a move flow against a withdraw transaction is refused', async () => {
    // SOL withdraws close the WSOL; a move's redeem keeps it open
    await refused(wire(await klendWithdrawIxs({ asset: 'SOL_LEND', amount: 1340000n })), flow('move_klend_to_jlend', 'SOL_LEND', 'redeem', '1340000', '1600000'), 'program')
    await refused(wire(await jlendWithdrawIxs({ asset: 'SOL_LEND', amount: 9408000n })), flow('move_jlend_to_klend', 'SOL_LEND', 'redeem', '9408000', '9999000'), 'program')
    // a withdraw is never a move's deposit or whole move
    for (const part of ['deposit', 'whole'] as const) {
      await refused(wire(await klendWithdrawIxs({ asset: 'USDC_LEND', amount: 1661200n })), flow('move_klend_to_jlend', 'USDC_LEND', part, '1661200', '1999000'), part === 'deposit' ? 'program' : 'plan')
      await refused(wire(await jlendWithdrawIxs({ asset: 'USDC_LEND', amount: 940000n })), flow('move_jlend_to_klend', 'USDC_LEND', part, '940000', '999000'), part === 'deposit' ? 'program' : 'plan')
    }
    // the other venue's withdraw under a redeem part
    await refused(wire(await jlendWithdrawIxs({ asset: 'USDC_LEND', amount: 1661200n })), flow('move_klend_to_jlend', 'USDC_LEND', 'redeem', '1661200', '1999000'), 'program')
  })
  it('a withdraw flow against a move transaction is refused', async () => {
    const kWithdraw = (asset: Asset, receiptRaw: string): SignFlow => ({ kind: 'withdraw_klend', user: USER, asset, receiptRaw })
    const jWithdraw = (asset: Asset, receiptRaw: string): SignFlow => ({ kind: 'withdraw_jlend', user: USER, asset, receiptRaw })
    await refused(wire(await klendWithdrawIxs({ asset: 'SOL_LEND', amount: 1340000n, close: false })), kWithdraw('SOL_LEND', '1340000'), 'plan')
    await refused(wire([...(await klendWithdrawIxs({ asset: 'USDC_LEND', amount: 1661200n })), ...(await jlendDepositIxs({ asset: 'USDC_LEND', amount: 1999000n }))]), kWithdraw('USDC_LEND', '1661200'), 'program')
    await refused(wire(await jlendDepositIxs({ asset: 'USDC_LEND', amount: 1999000n })), jWithdraw('USDC_LEND', '1999000'), 'plan')
    await refused(wire(await klendDepositIxs({ asset: 'USDC_LEND', amount: 1999000n })), kWithdraw('USDC_LEND', '1999000'), 'plan')
  })
})

/**
 * Same rigor as the withdraw table (sign-lend.test.ts): every account of every instruction of every move part shape, both directions,
 * both assets, with every optional create present, swapped one at a time for the attacker's key, is refused and the wallet is never asked.
 */
describe('every single-account substitution in every move part is refused', () => {
  it('refuses each one, and counts them all', async () => {
    const shapes: { name: string; ixs: Instruction[]; flow: SignFlow }[] = []
    for (const asset of ['USDC_LEND', 'SOL_LEND'] as const) {
      const kr = await klendWithdrawIxs({ asset, amount: 1340000n, createAta: true, close: false })
      const jd = await jlendDepositIxs({ asset, amount: 1600000n, createAta: true })
      const jr = await jlendWithdrawIxs({ asset, amount: 940000n, createAta: true, close: false })
      const kd = await klendDepositIxs({ asset, amount: 999000n, createAta: true })
      const kj = (part: MovePart) => flow('move_klend_to_jlend', asset, part, '1340000', '1600000')
      const jk = (part: MovePart) => flow('move_jlend_to_klend', asset, part, '940000', '999000')
      shapes.push(
        { name: `${asset} K to J redeem`, ixs: kr, flow: kj('redeem') },
        { name: `${asset} K to J deposit`, ixs: jd, flow: kj('deposit') },
        { name: `${asset} K to J whole`, ixs: [...kr, ...jd], flow: kj('whole') },
        { name: `${asset} J to K redeem`, ixs: jr, flow: jk('redeem') },
        { name: `${asset} J to K deposit`, ixs: kd, flow: jk('deposit') },
        { name: `${asset} J to K whole`, ixs: [...jr, ...kd], flow: jk('whole') },
      )
    }
    const passed: string[] = []
    let tried = 0
    for (const s of shapes) {
      await signed(wire(s.ixs), s.flow) // the untouched shape signs, so each refusal below is the substitution's
      for (const [n, x] of s.ixs.entries()) {
        for (const [a, m] of (x.accounts ?? []).entries()) {
          if (m.address === ATTACKER) continue
          tried++
          const sign = vi.fn(async (tx: Transaction) => tx)
          const tx = wire(s.ixs.map((y, k) => (k === n ? at(y, a, ATTACKER) : y)))
          const ok = await makeSigner(sign, s.flow)(tx).then(() => true, (e: unknown) => !(e instanceof SignRefused))
          if (ok || sign.mock.calls.length > 0) passed.push(`${s.name} ix ${n} account ${a}`)
        }
      }
    }
    expect(passed).toEqual([])
    // Accounts: create 6, K refresh 6, K redeem 12, K deposit 12, J redeem 18, J deposit 17, close 3.
    // USDC: K to J 24 + 23 + 47, J to K 24 + 24 + 48 = 190. SOL: K to J 24 + 26 + 50, J to K 24 + 27 + 51 = 202.
    expect(tried).toBe(392)
  })
})

describe('makeBatchSigner (S3: two transactions, one wallet session)', () => {
  const redeem = flow('move_klend_to_jlend', 'USDC_LEND', 'redeem', '1661200', '1999000')
  const deposit = flow('move_klend_to_jlend', 'USDC_LEND', 'deposit', '1661200', '1999000')
  it('checks both, then asks the wallet ONCE with both', async () => {
    const a = wire(await klendWithdrawIxs({ asset: 'USDC_LEND', amount: 1661200n }))
    const b = wire(await jlendDepositIxs({ asset: 'USDC_LEND', amount: 1999000n }))
    const wallet = vi.fn(async (txs: Transaction[]) => txs)
    expect(await makeBatchSigner(wallet, [redeem, deposit])([a, b])).toEqual([a, b])
    expect(wallet).toHaveBeenCalledTimes(1)
    expect(wallet.mock.calls[0][0]).toHaveLength(2)
  })
  it('one bad transaction and the wallet is never asked', async () => {
    const a = wire(await klendWithdrawIxs({ asset: 'USDC_LEND', amount: 1661200n }))
    const bad = wire(await jlendDepositIxs({ asset: 'USDC_LEND', amount: 1999001n }))
    const wallet = vi.fn(async (txs: Transaction[]) => txs)
    await expect(makeBatchSigner(wallet, [redeem, deposit])([a, bad])).rejects.toThrow(REFUSED.plan)
    await expect(makeBatchSigner(wallet, [redeem, deposit])([bad, a])).rejects.toThrow(SignRefused)
    expect(wallet).not.toHaveBeenCalled()
  })
  it('the two in the wrong order are refused', async () => {
    const a = wire(await klendWithdrawIxs({ asset: 'USDC_LEND', amount: 1661200n }))
    const b = wire(await jlendDepositIxs({ asset: 'USDC_LEND', amount: 1999000n }))
    const wallet = vi.fn(async (txs: Transaction[]) => txs)
    await expect(makeBatchSigner(wallet, [redeem, deposit])([b, a])).rejects.toThrow(SignRefused)
    expect(wallet).not.toHaveBeenCalled()
  })
  it('a count that does not match the flows is refused', async () => {
    const a = wire(await klendWithdrawIxs({ asset: 'USDC_LEND', amount: 1661200n }))
    const wallet = vi.fn(async (txs: Transaction[]) => txs)
    await expect(makeBatchSigner(wallet, [redeem, deposit])([a])).rejects.toThrow(REFUSED.plan)
    await expect(makeBatchSigner(wallet, [redeem, deposit])([a, a, a])).rejects.toThrow(REFUSED.plan)
    await expect(makeBatchSigner(wallet, [])([])).rejects.toThrow(REFUSED.plan)
    expect(wallet).not.toHaveBeenCalled()
  })
  it('an unreadable transaction is refused before the wallet', async () => {
    const a = wire(await klendWithdrawIxs({ asset: 'USDC_LEND', amount: 1661200n }))
    const wallet = vi.fn(async (txs: Transaction[]) => txs)
    await expect(makeBatchSigner(wallet, [redeem, deposit])([a, 'AAAA'])).rejects.toThrow(REFUSED.unreadable)
    expect(wallet).not.toHaveBeenCalled()
  })
  it('a wallet that answers fewer transactions than it was given', async () => {
    const a = wire(await klendWithdrawIxs({ asset: 'USDC_LEND', amount: 1661200n }))
    const b = wire(await jlendDepositIxs({ asset: 'USDC_LEND', amount: 1999000n }))
    const wallet = vi.fn(async (txs: Transaction[]) => txs.slice(0, 1))
    await expect(makeBatchSigner(wallet, [redeem, deposit])([a, b])).rejects.toThrow(SignRefused)
  })
})
