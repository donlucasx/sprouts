import { describe, it, expect, vi } from 'vitest'
import { address, AccountRole, type Instruction, type Transaction } from '@solana/kit'
import { makeSigner, REFUSED, SignRefused, type SignFlow } from '@/lib/sign'
import { parseSwapInstructions } from '../../../api/src/lib/jupiter'
import { wire, ATTACKER } from '../fixtures/api-built'
import { ataOf, L } from '../fixtures/lend-built'
import fixture from '../fixtures/jupiter-topup-exactout.json'

// The SOL top-up as the API builds it (api/src/lib/topup.ts): a real Jupiter answer (lite-api swap/v1, 2026-10-22, ExactOut 5 USDC from
// SOL, wrapAndUnwrapSol, a fresh wallet, so both account creates are in), parsed by the API's own parser, compiled without a lookup table.
const USER = address(fixture.user)
const flow: SignFlow = { kind: 'topup', user: USER, usdcRaw: '5000000' }
const JUP = 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4'

function built(): Instruction[] {
  const p = parseSwapInstructions(JSON.parse(JSON.stringify(fixture.swapInstructions)))
  return [...p.computeBudget, ...p.setup, p.swap, ...(p.cleanup ? [p.cleanup] : [])]
}
const at = (ixs: Instruction[], program: string, nth = 0) => ixs.filter((ix) => ix.programAddress === program)[nth]
const withData = (ix: Instruction, edit: (d: Uint8Array, v: DataView) => void): Instruction => {
  const d = new Uint8Array(ix.data ?? [])
  edit(d, new DataView(d.buffer))
  return { ...ix, data: d }
}
const swap = (ixs: Instruction[], edit: (d: Uint8Array, v: DataView) => void) => ixs.map((ix) => (ix.programAddress === JUP ? withData(ix, edit) : ix))
const reroute = (ixs: Instruction[], from: string, to: string, program = JUP) =>
  ixs.map((ix) => (ix.programAddress === program ? { ...ix, accounts: ix.accounts!.map((a) => (a.address === from ? { ...a, address: address(to) } : a)) } : ix))

async function refused(base64: string, why: keyof typeof REFUSED, f: SignFlow = flow) {
  const sign = vi.fn(async (tx: Transaction) => tx)
  const out = makeSigner(sign, f)(base64)
  await expect(out).rejects.toThrow(SignRefused)
  await expect(out).rejects.toThrow(REFUSED[why])
  expect(sign).not.toHaveBeenCalled()
}

describe("topup: this wallet's own SOL to USDC, one Jupiter ExactOut swap", () => {
  it("signs the API's top-up: 5 USDC to this wallet's USDC account, the wSOL closed back", async () => {
    const sign = vi.fn(async (tx: Transaction) => tx)
    const tx = wire(built(), USER)
    expect(await makeSigner(sign, flow)(tx)).toBe(tx)
    expect(sign).toHaveBeenCalledTimes(1)
  })

  it('refuses another amount than the button showed', async () => refused(wire(built(), USER), 'plan', { ...flow, usdcRaw: '6000000' }))

  it("refuses a swap into someone else's account, or out of another account than this wallet's wSOL", async () => {
    await refused(wire(reroute(built(), await ataOf(USER, L.USDC), ATTACKER), USER), 'plan')
    await refused(wire(reroute(built(), await ataOf(USER, L.WSOL), await ataOf(USER, L.USDC)), USER), 'plan')
  })

  it('refuses a platform fee, slippage above 1%, an ExactIn route, or a wrap above the swap maximum', async () => {
    await refused(wire(swap(built(), (d) => void (d[d.length - 1] = 20)), USER), 'plan')
    await refused(wire(swap(built(), (d, v) => v.setUint16(d.length - 3, 500, true)), USER), 'plan')
    await refused(wire(swap(built(), (d) => d.set([0xe5, 0x17, 0xcb, 0x97, 0x7a, 0xe3, 0xad, 0x2a], 0)), USER), 'plan')
    const big = built().map((ix) => (ix.programAddress === L.SYSTEM ? withData(ix, (_d, v) => v.setBigUint64(4, 10_000_000_000n, true)) : ix))
    await refused(wire(big, USER), 'plan')
  })

  it('refuses SOL sent anywhere but its own wSOL account, and a priority fee above 0.001 SOL', async () => {
    await refused(wire(reroute(built(), await ataOf(USER, L.WSOL), ATTACKER, L.SYSTEM), USER), 'plan')
    const fee = built().map((ix) => (ix.programAddress === 'ComputeBudget111111111111111111111111111111' && ix.data?.[0] === 3 ? withData(ix, (_d, v) => v.setBigUint64(1, 10_000_000n, true)) : ix))
    await refused(wire(fee, USER), 'plan')
  })

  it('refuses a token Approve before the swap, an unwrap to someone else, and anything after the unwrap', async () => {
    const ixs = built()
    const approve: Instruction = { programAddress: address(L.TOKEN), accounts: [
      { address: address(await ataOf(USER, L.USDC)), role: AccountRole.WRITABLE }, { address: ATTACKER, role: AccountRole.READONLY }, { address: USER, role: AccountRole.READONLY_SIGNER },
    ], data: new Uint8Array([4, 1, 0, 0, 0, 0, 0, 0, 0]) }
    const i = ixs.findIndex((ix) => ix.programAddress === JUP)
    await refused(wire([...ixs.slice(0, i), approve, ...ixs.slice(i)], USER), 'plan')
    const close = at(ixs, L.TOKEN, 1)
    await refused(wire([...ixs.slice(0, -1), { ...close, accounts: close.accounts!.map((a, k) => (k === 1 ? { ...a, address: ATTACKER } : a)) }], USER), 'plan')
    await refused(wire([...ixs, close], USER), 'plan')
  })

  it('refuses a program a top-up never uses, and a transaction for another wallet', async () => {
    const odd: Instruction = { programAddress: address('SKRskrmtL83pcL4YqLWt6iPefDqwXQWHSw9S9vz94BZ'), accounts: [], data: new Uint8Array([1]) }
    await refused(wire([odd, ...built()], USER), 'program')
    await refused(wire(built(), address(ATTACKER)), 'payer')
  })
})
