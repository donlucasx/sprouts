import { describe, it, expect, vi, afterEach } from 'vitest'
import { address, getAddressEncoder, getProgramDerivedAddress, AccountRole, type Address, type Instruction, type Transaction } from '@solana/kit'
import { fetchSolUsd, makeSigner, parseSharedExactOut, REFUSED, SignRefused, SOL_PRICE_URL, topUpLamportCeiling, type SignFlow, type SolUsdSource } from '@/lib/sign'
import { parseSwapInstructions } from '../../../api/src/lib/jupiter'
import { wire, ATTACKER } from '../fixtures/api-built'
import { ataOf, L } from '../fixtures/lend-built'
import fixture from '../fixtures/jupiter-topup-exactout.json'
import whirlpool from '../fixtures/jupiter-topup-exactout-whirlpool.json'
import plain from '../fixtures/jupiter-topup-exactout-plain.json'

// The SOL top-up as the API builds it (api/src/lib/topup.ts): real Jupiter answers (lite-api swap/v1, 2026-10-22, ExactOut 5 USDC from
// SOL, useSharedAccounts, dexes Raydium CLMM + Whirlpool, wrapAndUnwrapSol, a fresh wallet, so both account creates are in), parsed by
// the API's own parser, compiled without a lookup table.
const USER = address(fixture.user)
const flow: SignFlow = { kind: 'topup', user: USER, usdcRaw: '5000000' }
const JUP = 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4'
const SKR_MINT = 'SKRbvo6Gf7GondiT3BbTfuRDPqLWei4j2Qy2NPGZhW3'
type Fixture = typeof fixture

/** The SOL price the recorded quote implies (5 USDC for inAmount lamports): the fair price the phone would read at that moment. */
const fairPrice = (f: Fixture = fixture) => 5 / (Number(f.quote.inAmount) / 1e9)
const priceOf = (usd: number): SolUsdSource => async () => usd

function built(f: Fixture = fixture): Instruction[] {
  const p = parseSwapInstructions(JSON.parse(JSON.stringify(f.swapInstructions)))
  return [...p.computeBudget, ...p.setup, p.swap, ...(p.cleanup ? [p.cleanup] : [])]
}
const at = (ixs: Instruction[], program: string, nth = 0) => ixs.filter((ix) => ix.programAddress === program)[nth]
const withData = (ix: Instruction, edit: (d: Uint8Array, v: DataView) => Uint8Array | void): Instruction => {
  const d = new Uint8Array(ix.data ?? [])
  const out = edit(d, new DataView(d.buffer)) ?? d
  return { ...ix, data: out }
}
const swap = (ixs: Instruction[], edit: (d: Uint8Array, v: DataView) => Uint8Array | void) => ixs.map((ix) => (ix.programAddress === JUP ? withData(ix, edit) : ix))
const reroute = (ixs: Instruction[], from: string, to: string, program = JUP) =>
  ixs.map((ix) => (ix.programAddress === program ? { ...ix, accounts: ix.accounts!.map((a) => (a.address === from ? { ...a, address: address(to) } : a)) } : ix))
/** One more route account on the swap (where an AMM's accounts go). */
const addRouteAccount = (ixs: Instruction[], who: string, role = AccountRole.WRITABLE) =>
  ixs.map((ix) => (ix.programAddress === JUP ? { ...ix, accounts: [...ix.accounts!, { address: address(who), role }] } : ix))
const ata2022 = async (owner: string, mint: string) =>
  (await getProgramDerivedAddress({ programAddress: L.ATA as Address, seeds: [owner, L.TOKEN_2022, mint].map((a) => getAddressEncoder().encode(a as Address)) }))[0]

async function signs(base64: string, solUsd: SolUsdSource = priceOf(fairPrice())) {
  const sign = vi.fn(async (tx: Transaction) => tx)
  expect(await makeSigner(sign, flow, { solUsd })(base64)).toBe(base64)
  expect(sign).toHaveBeenCalledTimes(1)
}
async function refused(base64: string, why: keyof typeof REFUSED, f: SignFlow = flow, solUsd: SolUsdSource = priceOf(fairPrice())) {
  const sign = vi.fn(async (tx: Transaction) => tx)
  const out = makeSigner(sign, f, { solUsd })(base64)
  await expect(out).rejects.toThrow(SignRefused)
  await expect(out).rejects.toThrow(REFUSED[why])
  expect(sign).not.toHaveBeenCalled()
}
/** The recorded swap with quoted_in and the wrap scaled together, so the swap's own numbers agree with each other. */
function scaled(factor: bigint, f: Fixture = fixture): Instruction[] {
  let maxIn = 0n
  const ixs = swap(built(f), (d, v) => {
    const n = d.length
    const q = v.getBigUint64(n - 11, true) * factor
    v.setBigUint64(n - 11, q, true)
    maxIn = (q * BigInt(10_000 + v.getUint16(n - 3, true)) + 9_999n) / 10_000n + 1n
  })
  return ixs.map((ix) => (ix.programAddress === L.SYSTEM ? withData(ix, (_d, v) => v.setBigUint64(4, maxIn, true)) : ix))
}

describe("topup: this wallet's own SOL to USDC, one Jupiter shared-accounts ExactOut swap", () => {
  it("signs the API's top-up (Raydium CLMM and Whirlpool routes): 5 USDC to this wallet's USDC account, the wSOL closed back", async () => {
    await signs(wire(built(), USER))
    await signs(wire(built(whirlpool), USER), priceOf(fairPrice(whirlpool)))
  })

  it("reads Jupiter's data the way the program does: id, the route plan, then out, quoted in, slippage, fee and nothing after", () => {
    const d = new Uint8Array(Buffer.from(fixture.swapInstructions.swapInstruction.data, 'base64'))
    expect(parseSharedExactOut(d)).toMatchObject({ steps: 1, outAmount: 5_000_000n, quotedIn: BigInt(fixture.quote.inAmount), slippageBps: 50, feeBps: 0 })
    const w = new Uint8Array(Buffer.from(whirlpool.swapInstructions.swapInstruction.data, 'base64'))
    expect(parseSharedExactOut(w)).toMatchObject({ steps: 1, outAmount: 5_000_000n, quotedIn: BigInt(whirlpool.quote.inAmount) })
  })

  it('refuses the plain exact_out_route (the user and its accounts in the route accounts), as Jupiter really answers it', async () => {
    await refused(wire(built(plain as Fixture), USER), 'plan', flow, priceOf(fairPrice(plain as Fixture)))
  })

  it('refuses another amount than the button showed', async () => refused(wire(built(), USER), 'plan', { ...flow, usdcRaw: '6000000' }))

  it("refuses a swap into someone else's account, or out of another account than this wallet's wSOL", async () => {
    await refused(wire(reroute(built(), await ataOf(USER, L.USDC), ATTACKER), USER), 'plan')
    await refused(wire(reroute(built(), await ataOf(USER, L.WSOL), await ataOf(USER, L.USDC)), USER), 'plan')
  })

  it('refuses this wallet, or any of its token accounts, among the route accounts', async () => {
    await refused(wire(addRouteAccount(built(), USER, AccountRole.READONLY), USER), 'plan')
    await refused(wire(addRouteAccount(built(), await ataOf(USER, SKR_MINT)), USER), 'plan')
    await refused(wire(addRouteAccount(built(), await ata2022(USER, SKR_MINT)), USER), 'plan')
    await refused(wire(addRouteAccount(built(), await ataOf(USER, L.USDC)), USER), 'plan')
    await refused(wire(addRouteAccount(built(), await ataOf(USER, L.WSOL)), USER), 'plan')
    await refused(wire(addRouteAccount(built(), await ataOf(USER, 'B8V6WVjPxW1UGwVDfxH2d2r8SyT4cqn7dQRK6XneVa7D')), USER), 'plan') // K-Lend USDC receipt
    await refused(wire(addRouteAccount(built(), await ataOf(USER, 'cbbtcf3aa214zXHbiAZQwf4122FBYbraNdFqgw4iMij')), USER), 'plan')
  })

  it("refuses the fixed accounts moved: another program authority than the data's id, a platform fee account, another event authority", async () => {
    await refused(wire(swap(built(), (d) => void (d[8] = (d[8] + 1) % 8)), USER), 'plan')
    const swapIx = at(built(), JUP)
    await refused(wire(reroute(built(), swapIx.accounts![1].address, ATTACKER), USER), 'plan')
    const fee = built().map((ix) => (ix.programAddress === JUP ? { ...ix, accounts: ix.accounts!.map((a, k) => (k === 9 ? { ...a, address: ATTACKER } : a)) } : ix))
    await refused(wire(fee, USER), 'plan')
    const ev = built().map((ix) => (ix.programAddress === JUP ? { ...ix, accounts: ix.accounts!.map((a, k) => (k === 11 ? { ...a, address: ATTACKER } : a)) } : ix))
    await refused(wire(ev, USER), 'plan')
  })

  it('refuses a second signer', async () => {
    await refused(wire(addRouteAccount(built(), ATTACKER, AccountRole.READONLY_SIGNER), USER), 'signer')
  })

  it('refuses route data Jupiter would read differently: bytes after the fee, an unknown swap, a route length that does not match', async () => {
    await refused(wire(swap(built(), (d) => Uint8Array.from([...d, 0])), USER), 'plan')
    await refused(wire(swap(built(), (d) => Uint8Array.from([...d, 0, 0, 0, 0, 0, 0, 0, 0])), USER), 'plan')
    await refused(wire(swap(built(), (d) => void (d[13] = 105)), USER), 'plan') // Raydium AMM v4 today: payload size not pinned
    await refused(wire(swap(built(), (d) => void (d[13] = 61)), USER), 'plan') // SolFi { is_quote_to_base }: not pinned
    await refused(wire(swap(built(), (_d, v) => v.setUint32(9, 2, true)), USER), 'plan')
    await refused(wire(swap(built(), (_d, v) => v.setUint32(9, 0, true)), USER), 'plan')
    await refused(wire(swap(built(whirlpool), (d) => void (d[14] = 2)), USER), 'plan', flow, priceOf(fairPrice(whirlpool))) // a bool that is not 0 or 1
    await refused(wire(swap(built(), (d) => void (d[14] = 0)), USER), 'plan') // percent 0
    await refused(wire(swap(built(), (d) => d.slice(0, d.length - 1)), USER), 'plan')
  })

  it("refuses a platform fee, slippage above 1%, an ExactIn route, a plain ExactOut discriminator, or a wrap above the swap's maximum", async () => {
    await refused(wire(swap(built(), (d) => void (d[d.length - 1] = 20)), USER), 'plan')
    await refused(wire(swap(built(), (d, v) => v.setUint16(d.length - 3, 500, true)), USER), 'plan')
    await refused(wire(swap(built(), (d) => d.set([0xe5, 0x17, 0xcb, 0x97, 0x7a, 0xe3, 0xad, 0x2a], 0)), USER), 'plan')
    await refused(wire(swap(built(), (d) => d.set([0xd0, 0x33, 0xef, 0x97, 0x7b, 0x2b, 0xed, 0x5c], 0)), USER), 'plan')
    const big = built().map((ix) => (ix.programAddress === L.SYSTEM ? withData(ix, (_d, v) => v.setBigUint64(4, 10_000_000_000n, true)) : ix))
    await refused(wire(big, USER), 'plan')
  })

  it("refuses a swap that may spend more SOL than the USDC is worth at the phone's own price, or more than 1 SOL", async () => {
    // Three times the fair amount, the quote and the wrap agreeing with each other (all a hostile API needs to fool a quote-only check).
    await refused(wire(scaled(3n), USER), 'overpriced')
    // 5% over is refused; the margin is 3%.
    await refused(wire(built(), USER), 'overpriced', flow, priceOf(fairPrice() * 1.06))
    // A price that says SOL is cheap does not lift the 1 SOL ceiling.
    await refused(wire(scaled(25n), USER), 'overpriced', flow, priceOf(2))
  })

  it('refuses when the phone cannot read the SOL price, and never asks the wallet', async () => {
    await refused(wire(built(), USER), 'price', flow, async () => { throw new Error('offline') })
    await refused(wire(built(), USER), 'price', flow, priceOf(Number.NaN))
    await refused(wire(built(), USER), 'price', flow, priceOf(0))
  })

  it('refuses SOL sent anywhere but its own wSOL account, and a priority fee above 0.001 SOL', async () => {
    await refused(wire(reroute(built(), await ataOf(USER, L.WSOL), ATTACKER, L.SYSTEM), USER), 'plan')
    const fee = built().map((ix) => (ix.programAddress === 'ComputeBudget111111111111111111111111111111' && ix.data?.[0] === 3 ? withData(ix, (_d, v) => v.setBigUint64(1, 10_000_000n, true)) : ix))
    await refused(wire(fee, USER), 'plan')
  })

  it('refuses a token Approve before the swap, a second swap, an unwrap to someone else, and anything after the unwrap', async () => {
    const ixs = built()
    const approve: Instruction = { programAddress: address(L.TOKEN), accounts: [
      { address: address(await ataOf(USER, L.USDC)), role: AccountRole.WRITABLE }, { address: ATTACKER, role: AccountRole.READONLY }, { address: USER, role: AccountRole.READONLY_SIGNER },
    ], data: new Uint8Array([4, 1, 0, 0, 0, 0, 0, 0, 0]) }
    const i = ixs.findIndex((ix) => ix.programAddress === JUP)
    await refused(wire([...ixs.slice(0, i), approve, ...ixs.slice(i)], USER), 'plan')
    await refused(wire([...ixs.slice(0, i + 1), ixs[i], ...ixs.slice(i + 1)], USER), 'plan')
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

describe("the phone's own SOL price", () => {
  afterEach(() => vi.unstubAllGlobals())

  it("reads Jupiter's public price API (never the Sprouts API) and refuses an answer it cannot use", async () => {
    expect(new URL(SOL_PRICE_URL).host).toBe('lite-api.jup.ag')
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ So11111111111111111111111111111111111111112: { usdPrice: 103.2 } })))
    vi.stubGlobal('fetch', fetchMock)
    expect(await fetchSolUsd()).toBe(103.2)
    expect(String((fetchMock.mock.calls[0] as unknown[])[0])).toBe(SOL_PRICE_URL)
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 503 })))
    await expect(fetchSolUsd()).rejects.toThrow()
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}')))
    await expect(fetchSolUsd()).rejects.toThrow()
  })

  it('holds 5 USDC at $100 a SOL to 0.05 SOL + 3% + the fee cap, and refuses a price that is not sane', () => {
    expect(topUpLamportCeiling(5_000_000n, 100)).toBe(51_500_000n + 1_000_000n)
    expect(topUpLamportCeiling(5_000_000n, Number.POSITIVE_INFINITY)).toBeNull()
    expect(topUpLamportCeiling(5_000_000n, 0.5)).toBeNull()
  })
})
