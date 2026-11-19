import { describe, it, expect, vi, afterEach } from 'vitest'
import { address, getAddressEncoder, getProgramDerivedAddress, AccountRole, type Address, type Instruction, type Transaction } from '@solana/kit'
import { fetchSolUsd, fetchUsdPrice, makeSigner, parseSharedExactOut, REFUSED, REFUSED_COIN, SignRefused, SOL_PRICE_URL, topUpLamportCeiling, type SignFlow, type SolUsdSource, type UsdPriceSource } from '@/lib/sign'
import { parseSwapInstructions } from '../../../api/src/lib/jupiter'
import { wire, ATTACKER } from '../fixtures/api-built'
import { ataOf, L } from '../fixtures/lend-built'
import fixture from '../fixtures/jupiter-topup-exactout.json'
import whirlpool from '../fixtures/jupiter-topup-exactout-whirlpool.json'
import plain from '../fixtures/jupiter-topup-exactout-plain.json'
import tokenFixture from '../fixtures/jupiter-topup-exactout-token.json'

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
    // A second tail after the real one: a reader that takes the tail from the end sees these numbers, Jupiter reads the first ones.
    await refused(wire(swap(built(), (d) => Uint8Array.from([...d, ...d.slice(-19)])), USER), 'plan')
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

// Task 3 (season economics): any-coin top-up. A real Jupiter answer (api.jup.ag swap/v1, 2026-11-19, ExactOut 5 USDC from JUP,
// useSharedAccounts, dexes Raydium CLMM + Whirlpool, wrapAndUnwrapSol false, the same placeholder wallet), parsed by the API's own parser.
describe("topup from a token: this wallet's own token account to USDC, one Jupiter shared-accounts ExactOut swap, nothing wrapped", () => {
  const T = tokenFixture
  const MINT = T.quote.inputMint
  const DECIMALS = 6
  const tflow: SignFlow = { kind: 'topup', user: USER, usdcRaw: '5000000', inputMint: MINT }
  /** The token price the recorded quote implies (5 USDC for inAmount base units). */
  const fair = 5 / (Number(T.quote.inAmount) / 10 ** DECIMALS)
  const usdOf = (usd: number, decimals = DECIMALS): UsdPriceSource => async (mint) => {
    expect(mint).toBe(MINT)
    return { usd, decimals }
  }
  const tbuilt = () => built(T as unknown as Fixture)
  const authority = () => at(tbuilt(), JUP).accounts![1].address
  /** The fixture re-pointed at `m`: the mint, this wallet's source account and the authority's account for it all agree. */
  const rebrand = async (m: string, ixs = tbuilt()) => {
    ixs = reroute(ixs, MINT, m)
    ixs = reroute(ixs, await ataOf(USER, MINT), await ataOf(USER, m))
    return reroute(ixs, await ataOf(authority(), MINT), await ataOf(authority(), m))
  }
  async function tsigns(base64: string, usdPrice: UsdPriceSource = usdOf(fair), f: SignFlow = tflow) {
    const sign = vi.fn(async (tx: Transaction) => tx)
    expect(await makeSigner(sign, f, { usdPrice, solUsd: async () => { throw new Error('the token path never reads the SOL price') } })(base64)).toBe(base64)
    expect(sign).toHaveBeenCalledTimes(1)
  }
  async function trefused(base64: string, why: keyof typeof REFUSED, f: SignFlow = tflow, usdPrice: UsdPriceSource = usdOf(fair)) {
    const sign = vi.fn(async (tx: Transaction) => tx)
    const out = makeSigner(sign, f, { usdPrice, solUsd: priceOf(fairPrice()), coinSymbol: 'JUP' })(base64)
    await expect(out).rejects.toThrow(SignRefused)
    await expect(out).rejects.toThrow(why === 'price' || why === 'overpriced' ? REFUSED_COIN[why]('JUP') : REFUSED[why])
    expect(sign).not.toHaveBeenCalled()
  }

  it("signs a token top-up (fixture): 5 USDC to this wallet's USDC account, from its own JUP account, nothing wrapped or closed", async () => {
    expect(T.user).toBe(fixture.user)
    await tsigns(wire(tbuilt(), USER))
  })

  it("refuses the same wire for another mint than the flow's, and the SOL flow (no inputMint) reads it as not the plan", async () => {
    await trefused(wire(tbuilt(), USER), 'plan', { ...tflow, inputMint: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263' }, async () => ({ usd: 1, decimals: 5 }))
    await refused(wire(tbuilt(), USER), 'plan', flow)
  })

  it('refuses a token top-up with a second USDC account create before the swap', async () => {
    const ixs = tbuilt()
    const i = ixs.findIndex((ix) => ix.programAddress === L.ATA)
    expect(i).toBeGreaterThanOrEqual(0)
    await trefused(wire([...ixs.slice(0, i + 1), ixs[i], ...ixs.slice(i + 1)], USER), 'plan')
  })

  it('refuses inputMint = USDC, = wSOL (the SOL path), = a garden coin (cbBTC) or a receipt (K-Lend USDC)', async () => {
    const any: UsdPriceSource = async () => ({ usd: 1, decimals: 6 })
    for (const m of [L.USDC, L.WSOL, 'cbbtcf3aa214zXHbiAZQwf4122FBYbraNdFqgw4iMij', 'B8V6WVjPxW1UGwVDfxH2d2r8SyT4cqn7dQRK6XneVa7D'])
      await trefused(wire(tbuilt(), USER), 'plan', { ...tflow, inputMint: m }, any)
  })

  it("SKR may be the chosen source (controller ruling 11-19): its account only as the swap's source; anywhere else still refused", async () => {
    const skr: SignFlow = { ...tflow, inputMint: SKR_MINT }
    const skrPrice: UsdPriceSource = async () => ({ usd: fair, decimals: DECIMALS })
    await tsigns(wire(await rebrand(SKR_MINT), USER), skrPrice, skr)
    // SKR's account among the route accounts of its own top-up, its Token-2022 account, or another source than its own account.
    await trefused(wire(addRouteAccount(await rebrand(SKR_MINT), await ataOf(USER, SKR_MINT)), USER), 'plan', skr, skrPrice)
    await trefused(wire(addRouteAccount(await rebrand(SKR_MINT), await ata2022(USER, SKR_MINT)), USER), 'plan', skr, skrPrice)
    await trefused(wire(reroute(await rebrand(SKR_MINT), await ataOf(USER, SKR_MINT), ATTACKER), USER), 'plan', skr, skrPrice)
    // A JUP top-up or a SOL top-up that touches this wallet's SKR account anywhere is still refused.
    await trefused(wire(addRouteAccount(tbuilt(), await ataOf(USER, SKR_MINT)), USER), 'plan')
    await trefused(wire(await rebrand(SKR_MINT), USER), 'plan')
    await refused(wire(addRouteAccount(built(), await ataOf(USER, SKR_MINT)), USER), 'plan')
  })

  it('refuses the same swap moved onto USDC, wSOL, a garden coin or a receipt (its accounts consistent with that mint)', async () => {
    const any: UsdPriceSource = async () => ({ usd: 1, decimals: 6 })
    for (const m of [L.USDC, L.WSOL, 'cbbtcf3aa214zXHbiAZQwf4122FBYbraNdFqgw4iMij', 'B8V6WVjPxW1UGwVDfxH2d2r8SyT4cqn7dQRK6XneVa7D'])
      await trefused(wire(await rebrand(m), USER), 'plan', { ...tflow, inputMint: m }, any)
    for (const m of ['storenSbvkfzircixnaosc5CbzNZVrHJ6S3EKrS1yqR', 'he1iusmfkpAdwvxLNGV8Y1iSbj4rUy6yMhEA3fotn9A', 'J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn', 'jupSoLaHXQiZZTSfEWMTRRgpnyFm8f6sZdosWBjx93v'])
      await trefused(wire(await rebrand(m), USER), 'plan', { ...tflow, inputMint: m }, any)
    // The re-pointing itself is sound: onto another plain coin it signs (at that coin's fair price).
    const BONK = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263'
    const sign = vi.fn(async (tx: Transaction) => tx)
    await makeSigner(sign, { ...tflow, inputMint: BONK }, { usdPrice: async () => ({ usd: fair, decimals: DECIMALS }) })(wire(await rebrand(BONK), USER))
    expect(sign).toHaveBeenCalledTimes(1)
  })

  it("refuses a source account that is not this wallet's own classic account for the mint, and its Token-2022 account anywhere", async () => {
    await trefused(wire(reroute(tbuilt(), await ataOf(USER, MINT), ATTACKER), USER), 'plan')
    await trefused(wire(reroute(tbuilt(), await ataOf(USER, MINT), await ata2022(USER, MINT)), USER), 'plan')
    await trefused(wire(addRouteAccount(tbuilt(), await ata2022(USER, MINT)), USER), 'plan')
  })

  it("refuses a swap into someone else's account, this wallet or its accounts among the route accounts, a fee, slippage over 1%, another amount", async () => {
    await trefused(wire(reroute(tbuilt(), await ataOf(USER, L.USDC), ATTACKER), USER), 'plan')
    await trefused(wire(addRouteAccount(tbuilt(), USER, AccountRole.READONLY), USER), 'plan')
    await trefused(wire(addRouteAccount(tbuilt(), await ataOf(USER, MINT)), USER), 'plan')
    await trefused(wire(addRouteAccount(tbuilt(), await ataOf(USER, L.USDC)), USER), 'plan')
    await trefused(wire(addRouteAccount(tbuilt(), await ataOf(USER, SKR_MINT)), USER), 'plan')
    await trefused(wire(swap(tbuilt(), (d) => void (d[d.length - 1] = 20)), USER), 'plan')
    await trefused(wire(swap(tbuilt(), (d, v) => v.setUint16(d.length - 3, 500, true)), USER), 'plan')
    await trefused(wire(tbuilt(), USER), 'plan', { ...tflow, usdcRaw: '6000000' })
    await trefused(wire(swap(tbuilt(), (d) => void (d[8] = (d[8] + 1) % 8)), USER), 'plan')
  })

  it('refuses an added SOL transfer, SyncNative or close, and anything after the swap', async () => {
    const ixs = tbuilt()
    const i = ixs.findIndex((ix) => ix.programAddress === JUP)
    const wsol = address(await ataOf(USER, L.WSOL))
    const transfer: Instruction = { programAddress: address(L.SYSTEM), accounts: [{ address: USER, role: AccountRole.WRITABLE_SIGNER }, { address: wsol, role: AccountRole.WRITABLE }], data: new Uint8Array([2, 0, 0, 0, 64, 66, 15, 0, 0, 0, 0, 0]) }
    const sync: Instruction = { programAddress: address(L.TOKEN), accounts: [{ address: wsol, role: AccountRole.WRITABLE }], data: new Uint8Array([17]) }
    const close: Instruction = { programAddress: address(L.TOKEN), accounts: [{ address: wsol, role: AccountRole.WRITABLE }, { address: USER, role: AccountRole.WRITABLE }, { address: USER, role: AccountRole.READONLY_SIGNER }], data: new Uint8Array([9]) }
    const theft: Instruction = { ...transfer, accounts: [transfer.accounts![0], { address: ATTACKER, role: AccountRole.WRITABLE }] }
    await trefused(wire([...ixs.slice(0, i), transfer, ...ixs.slice(i)], USER), 'plan')
    await trefused(wire([...ixs.slice(0, i), transfer, sync, ...ixs.slice(i)], USER), 'plan')
    await trefused(wire([...ixs, close], USER), 'plan')
    await trefused(wire([...ixs, theft], USER), 'plan')
    await trefused(wire([...ixs.slice(0, i + 1), ixs[i]], USER), 'plan')
  })

  it("refuses a route priced 5% under the phone's own price, a swap scaled up, and when the phone cannot read the token's price", async () => {
    // The route pays 5% less USDC per coin than the phone's price says the coin is worth: the swap may spend more than 3% over fair.
    await trefused(wire(tbuilt(), USER), 'overpriced', tflow, usdOf(fair * 1.05))
    // Within the margin (2% plus the route's 0.5% slippage) it signs.
    await tsigns(wire(tbuilt(), USER), usdOf(fair * 1.02))
    await trefused(wire(swap(tbuilt(), (d, v) => v.setBigUint64(d.length - 11, v.getBigUint64(d.length - 11, true) * 2n, true)), USER), 'overpriced')
    await trefused(wire(tbuilt(), USER), 'price', tflow, async () => { throw new Error('offline') })
    await trefused(wire(tbuilt(), USER), 'price', tflow, usdOf(Number.NaN))
    await trefused(wire(tbuilt(), USER), 'price', tflow, usdOf(0))
    await trefused(wire(tbuilt(), USER), 'price', tflow, usdOf(fair, 99))
  })

  it('names the chosen coin in the price refusals (SOL keeps its words)', async () => {
    expect(REFUSED_COIN.price('SOL')).toBe(REFUSED.price)
    expect(REFUSED_COIN.overpriced('SOL')).toBe(REFUSED.overpriced)
    const sign = vi.fn(async (tx: Transaction) => tx)
    await expect(makeSigner(sign, tflow, { usdPrice: usdOf(fair * 1.05), coinSymbol: 'JUP' })(wire(tbuilt(), USER))).rejects.toThrow('This swap asks for more JUP than the USDC is worth right now. Nothing was signed.')
    await expect(makeSigner(sign, tflow, { usdPrice: async () => { throw new Error('offline') }, coinSymbol: 'JUP' })(wire(tbuilt(), USER))).rejects.toThrow('Sprouts could not check the JUP price, so nothing was asked of your wallet. Try again.')
    expect(sign).not.toHaveBeenCalled()
  })
})

describe("the phone's own token price", () => {
  afterEach(() => vi.unstubAllGlobals())
  it("reads Jupiter's public price API for the mint and throws when it has no number", async () => {
    const MINT = tokenFixture.quote.inputMint
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ [MINT]: { usdPrice: 0.25, decimals: 6 } })))
    vi.stubGlobal('fetch', fetchMock)
    expect(await fetchUsdPrice(MINT)).toEqual({ usd: 0.25, decimals: 6 })
    expect(String((fetchMock.mock.calls[0] as unknown[])[0])).toBe(`https://lite-api.jup.ag/price/v3?ids=${MINT}`)
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 503 })))
    await expect(fetchUsdPrice(MINT)).rejects.toThrow()
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ [MINT]: { usdPrice: 0.25 } }))))
    await expect(fetchUsdPrice(MINT)).rejects.toThrow()
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}')))
    await expect(fetchUsdPrice(MINT)).rejects.toThrow()
  })
})
