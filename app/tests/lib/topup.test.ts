import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { REFUSED, SignRefused, type SignFlow } from '@/lib/sign'
import { DROPPED_NOTHING_SENT } from '@/lib/wallet-errors'
import { ME_USDC_SETUP, meUsdcSetupKey, ME_USDC_WITH_SOURCES, postLinkUsdc, defaultSource, pickerSources, topUpChoices, topUpClosedView, TOPUP, TopUpFailed, topUpCentsFor, topUpOffer, topUpThisPhone } from '@/lib/topup'

const ME = 'HJCJKRQLV2HVKfe3sFdTF5jjBY1xfWgnK8cLcjH7qnHd'
const OTHER = '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU'
class FakeApiError extends Error {
  constructor(public status: number, message: string) {
    super(message)
  }
}

function run(o: { build?: () => Promise<{ transaction: string; usdcRaw: string }>; sign?: (tx: string) => Promise<string>; confirm?: () => Promise<{ status?: string }> } = {}) {
  const flows: SignFlow[] = []
  const confirm = vi.fn(o.confirm ?? (async () => ({ status: 'confirmed' })))
  const onSigned = vi.fn()
  const out = topUpThisPhone({
    user: ME,
    cents: 500,
    build: o.build ?? (async () => ({ transaction: 'TX', usdcRaw: '5000000' })),
    sign: (flow) => {
      flows.push(flow)
      return o.sign ?? (async () => 'SIGNED')
    },
    confirm,
    onSigned,
  })
  return { out, flows, confirm, onSigned }
}

describe('topUpThisPhone (build, check, sign, send)', () => {
  it("signs under the 'topup' flow with the button's amount, then sends the signed bytes", async () => {
    const r = run()
    await expect(r.out).resolves.toBe('confirmed')
    expect(r.flows).toEqual([{ kind: 'topup', user: ME, usdcRaw: '5000000' }])
    expect(r.confirm).toHaveBeenCalledWith({ signedTransaction: 'SIGNED' })
    expect(r.onSigned).toHaveBeenCalledTimes(1)
  })

  it('a 202 from the confirm is pending, never done', async () => {
    await expect(run({ confirm: async () => ({ status: 'pending' }) }).out).resolves.toBe('pending')
  })

  it("refuses a build for another amount before the wallet is asked", async () => {
    const r = run({ build: async () => ({ transaction: 'TX', usdcRaw: '25000000' }) })
    await expect(r.out).rejects.toThrow(REFUSED.plan)
    expect(r.flows).toEqual([])
  })

  it("the build's own sentence (not enough SOL) is shown as it is; an unanswered build says nothing moved", async () => {
    await expect(run({ build: async () => { throw new FakeApiError(409, 'Not enough SOL.') } }).out).rejects.toThrow('Not enough SOL.')
    await expect(run({ build: async () => { throw new FakeApiError(0, 'x') } }).out).rejects.toThrow(TOPUP.failedBefore)
  })

  it('a decline or a dropped wallet session sent nothing; our own refusal says so in its words', async () => {
    const declined = run({ sign: async () => { throw Object.assign(new Error('declined'), { code: -3 }) } })
    await expect(declined.out).rejects.toThrow(DROPPED_NOTHING_SENT)
    expect(declined.confirm).not.toHaveBeenCalled()
    await expect(run({ sign: async () => { throw new SignRefused(REFUSED.program) } }).out).rejects.toThrow(REFUSED.program)
  })

  it("after the signature, only the route's final answers show as they are; anything else is 'sent, not confirmed'", async () => {
    await expect(run({ confirm: async () => { throw new FakeApiError(400, 'The swap failed on chain.') } }).out).rejects.toThrow('The swap failed on chain.')
    await expect(run({ confirm: async () => { throw new FakeApiError(409, 'The top-up did not go through. Nothing moved. Try again.') } }).out).rejects.toThrow('Nothing moved')
    const lost = run({ confirm: async () => { throw new FakeApiError(0, 'x') } })
    await expect(lost.out).rejects.toBeInstanceOf(TopUpFailed)
    await expect(lost.out).rejects.toThrow(TOPUP.sent)
    expect(TOPUP.sent).not.toMatch(/Nothing moved/)
  })
})

describe('the offer and its amount', () => {
  const pause = (needCents: number | null, resumeAtCents = 201) => ({ reason: 'no_usdc' as const, needCents, resumeAtCents })
  it('$5, or the whole dollars the pause names when more, at most $25', () => {
    expect(topUpCentsFor(null)).toBe(500)
    expect(topUpCentsFor(pause(null))).toBe(500)
    expect(topUpCentsFor(pause(712))).toBe(800)
    expect(topUpCentsFor(pause(9_000))).toBe(2_500)
    expect(topUpCentsFor({ reason: 'user' })).toBe(500)
  })

  it("offers the button only for this phone's wallet; other wallets paused for USDC get a line", () => {
    const me = { user: { pubkey: ME }, wallets: [
      { pubkey: ME, status: 'paused' as const, dailyCapCents: 500, pause: pause(300) },
      { pubkey: OTHER, status: 'paused' as const, dailyCapCents: 500, pause: pause(300) },
    ] }
    expect(topUpOffer(me as never)).toEqual({ phoneCents: 500, others: ["Top up works only for this phone's wallet. Add USDC to 7xKX...gAsU from wherever you use it."] })
    const userPaused = { ...me, wallets: [{ pubkey: ME, status: 'paused' as const, dailyCapCents: 500, pause: { reason: 'user' as const } }] }
    expect(topUpOffer(userPaused as never)).toEqual({ phoneCents: null, others: [] })
    const active = { ...me, wallets: [{ pubkey: ME, status: 'active' as const, dailyCapCents: 500, pause: null }] }
    expect(topUpOffer(active as never)).toEqual({ phoneCents: null, others: [] })
  })

  it('the copy: plain, no em dashes', () => {
    const lines = [TOPUP.open, TOPUP.button(500), TOPUP.how(500, null), TOPUP.how(500, 'About 2 weeks of round-ups'), TOPUP.sendHere, TOPUP.done(500), TOPUP.doneLink(500), TOPUP.sent, TOPUP.failedBefore]
    // 10-27 (his rulings): one "Add USDC"; the swap said outright in the line under it; never "you need SOL"
    expect(TOPUP.open).toBe('Add USDC')
    expect(TOPUP.button(500)).toBe('Add $5 of USDC')
    expect(TOPUP.how(500, 'About 2 weeks of round-ups')).toBe('Swaps SOL already in this wallet for $5 of USDC, about 2 weeks of round-ups. Sprouts takes 0.5% when it\'s planted.')
    expect(TOPUP.done(500)).toBe('Your wallet now has $5.00 more USDC. Sprouts plants again at the next daily planting.')
    for (const l of lines) expect(l).not.toMatch(/—|–/)
  })
})

describe('any-coin top-up (Task 3): the source coin', () => {
  const SKR = 'SKRbvo6Gf7GondiT3BbTfuRDPqLWei4j2Qy2NPGZhW3'
  const WSOL = 'So11111111111111111111111111111111111111112'
  const BONK = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263'
  function go(inputMint: string | undefined, echo?: string) {
    const flows: SignFlow[] = []
    const bodies: unknown[] = []
    const out = topUpThisPhone({
      user: ME,
      cents: 500,
      ...(inputMint !== undefined ? { inputMint } : {}),
      build: async (body) => {
        bodies.push(body)
        return { transaction: 'TX', usdcRaw: '5000000', ...(echo !== undefined ? { inputMint: echo } : {}) }
      },
      sign: (flow) => {
        flows.push(flow)
        return async () => 'SIGNED'
      },
      confirm: async () => ({ status: 'confirmed' }),
    })
    return { out, flows, bodies }
  }

  it("names every coin it can swap", () => {
    expect(TOPUP.swapsLine(['SOL'])).toBe('Swaps a little of your SOL into USDC. Sprouts takes 0.5% when it\'s planted.')
    expect(TOPUP.swapsLine(['SKR'])).toBe('Swaps a little of your SKR into USDC. Sprouts takes 0.5% when it\'s planted.')
    expect(TOPUP.swapsLine(['SOL', 'SKR'])).toBe('Swaps a little of your SOL or SKR into USDC. Sprouts takes 0.5% when it\'s planted.')
    expect(TOPUP.swapsLine([])).toBe('Swaps a little of your SOL into USDC. Sprouts takes 0.5% when it\'s planted.')
    expect(TOPUP.swapsLine(['SOL', 'SKR', 'JUP'])).toBe('Swaps a little of your SOL, SKR or JUP into USDC. Sprouts takes 0.5% when it\'s planted.')
    expect(TOPUP.how(500, null)).toBe('Swaps SOL already in this wallet for $5 of USDC. Sprouts takes 0.5% when it\'s planted.')
    expect(TOPUP.how(500, 'About 2 weeks of round-ups', 'SKR')).toBe('Swaps SKR already in this wallet for $5 of USDC, about 2 weeks of round-ups. Sprouts takes 0.5% when it\'s planted.')
    for (const l of [TOPUP.swapsLine(['SOL', 'SKR', 'JUP']), TOPUP.how(500, null, 'SKR')]) expect(l).not.toMatch(/—|–/)
  })

  it('a token: the build body names it and the flow carries it', async () => {
    const r = go(SKR, SKR)
    await expect(r.out).resolves.toBe('confirmed')
    expect(r.bodies).toEqual([{ cents: 500, inputMint: SKR }])
    expect(r.flows).toEqual([{ kind: 'topup', user: ME, usdcRaw: '5000000', inputMint: SKR }])
  })

  it("SOL: the body is exactly { cents } (as 0.1.11) and the flow has no inputMint, whether the API echoes wSOL or nothing", async () => {
    for (const [mint, echo] of [[undefined, undefined], [undefined, WSOL], [WSOL, WSOL], [WSOL, undefined]] as const) {
      const r = go(mint, echo)
      await expect(r.out).resolves.toBe('confirmed')
      expect(JSON.stringify(r.bodies)).toBe('[{"cents":500}]')
      expect(r.flows).toEqual([{ kind: 'topup', user: ME, usdcRaw: '5000000' }])
      expect('inputMint' in r.flows[0]).toBe(false)
    }
  })

  it("a build that echoes another coin than the one asked is refused before the wallet is asked", async () => {
    for (const [mint, echo] of [[SKR, BONK], [SKR, WSOL], [SKR, undefined], [undefined, SKR], [WSOL, SKR]] as const) {
      const r = go(mint, echo)
      await expect(r.out).rejects.toBeInstanceOf(TopUpFailed)
      await expect(r.out).rejects.toThrow(REFUSED.plan)
      expect(r.flows).toEqual([])
    }
  })

  it('defaultSource: SOL first, else the first source; none when there are no sources', () => {
    const sol = { mint: WSOL, symbol: 'SOL', decimals: 9, valueCents: 900, offers: [500] }
    const skr = { mint: SKR, symbol: 'SKR', decimals: 6, valueCents: 800, offers: [500] }
    expect(defaultSource([skr, sol])).toBe(sol)
    expect(defaultSource([skr])).toBe(skr)
    expect(defaultSource([])).toBeNull()
    expect(defaultSource(null)).toBeNull()
    expect(defaultSource(undefined)).toBeNull()
  })

  it('the picker shows at most 3 coins: SOL first when offered, then the two worth the most', () => {
    const c = (symbol: string, valueCents: number, mint = symbol) => ({ mint, symbol, decimals: 6, valueCents, offers: [500] })
    const sol = c('SOL', 600, WSOL)
    const [a, b, d, e] = [c('A', 900), c('B', 3_000), c('D', 700), c('E', 1_200)]
    expect(pickerSources([sol, a, b, d, e]).map((s) => s.symbol)).toEqual(['SOL', 'B', 'E'])
    expect(pickerSources([a, b, d, e]).map((s) => s.symbol)).toEqual(['B', 'E'])
    expect(pickerSources([a, sol]).map((s) => s.symbol)).toEqual(['SOL', 'A'])
    expect(pickerSources([sol])).toEqual([sol])
    expect(pickerSources([])).toEqual([])
  })

  it('the picker drops any coin the phone would refuse to sign (cbBTC, a K-Lend receipt, USDC)', () => {
    const c = (symbol: string, mint: string, valueCents: number) => ({ mint, symbol, decimals: 6, valueCents, offers: [500] })
    const list = [
      c('USDC', 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', 9_000),
      c('cbBTC', 'cbbtcf3aa214zXHbiAZQwf4122FBYbraNdFqgw4iMij', 8_000),
      c('kUSDC', 'B8V6WVjPxW1UGwVDfxH2d2r8SyT4cqn7dQRK6XneVa7D', 7_000),
      c('SKR', SKR, 800),
      c('SOL', WSOL, 600),
    ]
    expect(topUpChoices(list, null, null).usable?.map((s) => s.symbol)).toEqual(['SOL', 'SKR'])
    expect(topUpChoices(list.slice(0, 3), [500], null)).toMatchObject({ usable: [], choices: [] })
  })

  it("an empty topUpSources is read as absent: SOL and topUpCents as in 0.1.11, never the send-USDC view (review fix round 1, finding 2)", () => {
    for (const sources of [[], null, undefined]) {
      expect(topUpChoices(sources, [500, 1_000], null)).toEqual({ usable: null, source: null, symbol: 'SOL', choices: [500, 1_000] })
      expect(topUpChoices(sources, null, null).choices).toEqual([500, 1_000, 2_500])
      expect(topUpChoices(sources, [], null).choices).toEqual([])
    }
    const sol = { mint: WSOL, symbol: 'SOL', decimals: 9, valueCents: 600, offers: [] as number[] }
    const skr = { mint: SKR, symbol: 'SKR', decimals: 6, valueCents: 800, offers: [500] }
    // A list: its coins with amounts; the picked one's amounts; none with amounts = [].
    expect(topUpChoices([sol, skr], [500], null)).toMatchObject({ symbol: 'SKR', choices: [500] })
    expect(topUpChoices([{ ...sol, offers: [500, 1_000] }, skr], null, SKR)).toMatchObject({ symbol: 'SKR', choices: [500] })
    expect(topUpChoices([{ ...sol, offers: [500, 1_000] }, skr], null, null)).toMatchObject({ symbol: 'SOL', choices: [500, 1_000] })
    expect(topUpChoices([sol], [500], null)).toMatchObject({ usable: [], choices: [] })
  })
})

describe('postLinkUsdc: what Home says under "linked"', () => {
  const W = 'W1111111111111111111111111111xyz9'
  it('no linked param: nothing', () => expect(postLinkUsdc({ linked: undefined, phone: 'P', usdcCents: 0 })).toBeNull())
  it("this phone's wallet: the Add USDC button under 500, nothing at 500 or unread", () => {
    expect(postLinkUsdc({ linked: 'P', phone: 'P', usdcCents: 0 })).toEqual({ line: null, topUp: true })
    expect(postLinkUsdc({ linked: 'P', phone: 'P', usdcCents: 499 })).toEqual({ line: null, topUp: true })
    expect(postLinkUsdc({ linked: 'P', phone: 'P', usdcCents: 500 })).toBeNull()
    expect(postLinkUsdc({ linked: 'P', phone: 'P', usdcCents: null })).toBeNull()
  })
  it('another wallet: where to add it, no button, whatever the balance', () => {
    const want = { line: TOPUP.otherWallet('W111...xyz9'), topUp: false }
    expect(postLinkUsdc({ linked: W, phone: 'P', usdcCents: 0 })).toEqual(want)
    expect(postLinkUsdc({ linked: W, phone: 'P', usdcCents: 9000 })).toEqual(want)
    expect(want.line).toBe("Top up works only for this phone's wallet. Add USDC to W111...xyz9 from wherever you use it.")
  })
})

// Task 7 review: topUpSources is opt-in on the API (a Helius read per call); only Home's read asks for it.
describe('who asks /api/me/usdc for topUpSources', async () => {
  const { readFileSync } = await import('node:fs')
  const read = (p: string) => readFileSync(new URL(`../../src/${p}`, import.meta.url), 'utf8')
  it("Home's read asks, under its own query key; the background refresh and Link a wallet do not", () => {
    expect(ME_USDC_WITH_SOURCES).toBe('/api/me/usdc?sources=1')
    const home = read('app/(tabs)/home.tsx')
    expect(home).toContain("queryKey: ['me-usdc', me?.user.pubkey, 'sources'], queryFn: () => api<MeUsdcResponse>(ME_USDC_WITH_SOURCES)")
    expect(home).not.toContain("'/api/me/usdc'")
    // Task 17b: Link a wallet now reads the setup path (ME_USDC_SETUP, its own key); still never the sources one.
    expect(read('app/connect.tsx')).toContain("queryKey: meUsdcSetupKey(session?.pubkey),\n    queryFn: () => api<MeUsdcResponse>(ME_USDC_SETUP)")
    // Ruling 26: Home's regular read never asks for the setup count (each adds a Helius read)
    expect(home).not.toContain('setup=1')
    expect(home).not.toContain('ME_USDC_SETUP')
    expect(read('lib/background.ts')).not.toContain('setup=1')
    for (const p of ['lib/background.ts', 'app/connect.tsx']) {
      const src = read(p)
      if (p === 'lib/background.ts') expect(src).toMatch(/\/api\/me\/usdc["']/)
      expect(src).not.toContain('sources=1')
      expect(src).not.toContain('ME_USDC_WITH_SOURCES')
    }
  })
})

describe('Task 17b (user rent): the top-up carries the setup count the screen showed', () => {
  const SKR = 'SKRbvo6Gf7GondiT3BbTfuRDPqLWei4j2Qy2NPGZhW3'
  function go(setupMax: number | undefined, inputMint?: string) {
    const flows: SignFlow[] = []
    const bodies: unknown[] = []
    const out = topUpThisPhone({
      user: ME,
      cents: 500,
      ...(inputMint !== undefined ? { inputMint } : {}),
      ...(setupMax !== undefined ? { setupMax } : {}),
      build: async (body) => {
        bodies.push(body)
        return { transaction: 'TX', usdcRaw: '5000000', ...(inputMint ? { inputMint } : {}) }
      },
      sign: (flow) => {
        flows.push(flow)
        return async () => 'SIGNED'
      },
      confirm: async () => ({ status: 'confirmed' }),
    })
    return { out, flows, bodies }
  }
  it("none, 0 or junk: the body and the flow exactly as today (no setupMax key)", async () => {
    for (const n of [undefined, 0, -1, 1.5, Number.NaN]) {
      const r = go(n)
      await r.out
      expect(r.bodies).toEqual([{ cents: 500 }])
      expect(r.flows).toEqual([{ kind: 'topup', user: ME, usdcRaw: '5000000' }])
    }
  })
  it('a count: the body asks for it and the flow allows it, capped at 3 (a top-up never carries more)', async () => {
    const r = go(2)
    await r.out
    expect(r.bodies).toEqual([{ cents: 500, setupMax: 2 }])
    expect(r.flows).toEqual([{ kind: 'topup', user: ME, usdcRaw: '5000000', setupMax: 2 }])
    const capped = go(7, SKR)
    await capped.out
    expect(capped.bodies).toEqual([{ cents: 500, inputMint: SKR, setupMax: 3 }])
    expect(capped.flows).toEqual([{ kind: 'topup', user: ME, usdcRaw: '5000000', inputMint: SKR, setupMax: 3 }])
  })
  it("review fix (ruling 27): the setup read has its own key root, so Home's focus and app-active invalidation of ['me-usdc'] never re-reads it", () => {
    expect(meUsdcSetupKey('W')).toEqual(['me-usdc-setup', 'W'])
    expect(meUsdcSetupKey('W')[0]).not.toBe('me-usdc')
    const src = (p: string) => readFileSync(new URL(`../../src/${p}`, import.meta.url), 'utf8')
    // every setup read goes through the one key; none sits under the 'me-usdc' prefix
    for (const p of ['app/connect.tsx', 'components/TopUp.tsx', 'components/RelinkCard.tsx']) {
      expect(src(p)).toContain('queryKey: meUsdcSetupKey(')
      expect(src(p)).not.toMatch(/\['me-usdc', [^\]]*'setup'\]/)
    }
    // the re-link card reads it once when it first shows: never stale, never refetched on focus, kept for the session
    const relink = src('components/RelinkCard.tsx')
    expect(relink).toMatch(/queryKey: meUsdcSetupKey\(user\)[^\n]*enabled: view\.thisPhone[^\n]*staleTime: Infinity, gcTime: Infinity, refetchOnWindowFocus: false, refetchOnReconnect: false/)
    // a top-up re-reads both (the accounts it set up now exist)
    expect(src('components/TopUp.tsx')).toContain("void qc.invalidateQueries({ queryKey: ['me-usdc-setup'] })")
  })
  it('review fix 8: Link a wallet sends the SAME count to the approval request and to the sign flow', () => {
    const connect = readFileSync(new URL('../../src/app/connect.tsx', import.meta.url), 'utf8')
    expect(connect).toContain('const setupMax = setupCount\n')
    expect(connect).toContain('linkApprovalPath(code, session.pubkey, setupMax)')
    expect(connect).toContain("setupMax > 0 ? { kind: 'link', user: session.pubkey, setupMax } : { kind: 'link', user: session.pubkey }")
    expect(connect.match(/setupAccountsOf\(/g)).toHaveLength(1)
    expect(connect).toContain('const setupCount = setupAccountsOf(usdc?.setupAccounts)')
    expect(connect).toContain('setupLine(setupCount, solUsd)')
  })
  it('the setup read is its own path, never the regular Home read (ruling 26: each adds a Helius read)', () => {
    expect(ME_USDC_WITH_SOURCES).toBe('/api/me/usdc?sources=1')
    expect(ME_USDC_SETUP).toBe('/api/me/usdc?setup=1')
  })
})

describe('11-20 copy pass: the closed card names only coins that can pay; none = the address straight away; Back', () => {
  const SKR = 'SKRbvo6Gf7GondiT3BbTfuRDPqLWei4j2Qy2NPGZhW3'
  const WSOL = 'So11111111111111111111111111111111111111112'
  const c = (symbol: string, mint: string, offers: number[], valueCents = 900) => ({ mint, symbol, decimals: 6, valueCents, offers })
  it('(a) the line names only the usable sources with amounts', () => {
    expect(topUpClosedView([c('SOL', WSOL, []), c('SKR', SKR, [500, 1_000])], null)).toEqual({ kind: 'add', symbols: ['SKR'] })
    expect(topUpClosedView([c('SOL', WSOL, [500]), c('SKR', SKR, [])], null)).toEqual({ kind: 'add', symbols: ['SOL'] })
    expect(topUpClosedView([c('SOL', WSOL, [500]), c('SKR', SKR, [500])], null)).toEqual({ kind: 'add', symbols: ['SOL', 'SKR'] })
    // a coin the phone would not sign never shows, even with amounts
    expect(topUpClosedView([c('cbBTC', 'cbbtcf3aa214zXHbiAZQwf4122FBYbraNdFqgw4iMij', [500]), c('SKR', SKR, [500])], null)).toEqual({ kind: 'add', symbols: ['SKR'] })
  })
  it('(b) no coin can pay: the address view, never "Add USDC" and never a SOL fallback', () => {
    expect(topUpClosedView([c('SOL', WSOL, []), c('SKR', SKR, [])], null)).toEqual({ kind: 'send' })
    expect(topUpClosedView([], [])).toEqual({ kind: 'send' })
    expect(topUpClosedView(null, [])).toEqual({ kind: 'send' })
    expect(topUpClosedView([c('cbBTC', 'cbbtcf3aa214zXHbiAZQwf4122FBYbraNdFqgw4iMij', [500])], [500])).toEqual({ kind: 'send' })
  })
  it('an older API (no list): SOL with its offers, as 0.1.11; unknown offers = every amount', () => {
    expect(topUpClosedView(null, [500])).toEqual({ kind: 'add', symbols: ['SOL'] })
    expect(topUpClosedView(undefined, null)).toEqual({ kind: 'add', symbols: ['SOL'] })
    expect(topUpClosedView([], null)).toEqual({ kind: 'add', symbols: ['SOL'] })
  })
  it('the empty state: just where to send USDC, never a SOL line (Kimi copy item 3)', () => {
    expect(TOPUP.sendHere).toBe('Send USDC to this wallet from any wallet or exchange. Plantings start again once it arrives.')
    expect(TOPUP.sendHere).not.toMatch(/SOL\b/)
    expect(TOPUP.copy).toBe('Copy address')
    expect(TOPUP.back).toBe('Back')
  })
  it('(b, c) TopUp.tsx: the address view comes before the closed button; Back closes without sending, hidden while busy or landed', () => {
    const src = readFileSync(new URL('../../src/components/TopUp.tsx', import.meta.url), 'utf8')
    const send = src.indexOf("if (closed.kind === 'send' || choices.length === 0) return <SendUsdcHere")
    expect(send).toBeGreaterThan(0)
    expect(send).toBeLessThan(src.indexOf('if (!open)'))
    expect(src).toContain('{TOPUP.swapsLine(closed.symbols)}')
    expect(src).toMatch(/const back = \(\) => \{\n\s+setOpen\(false\)\n\s+setPickedMint\(null\)\n\s+setLine\(null\)\n\s+\}/)
    expect(src).toContain('{compact && !phase && !landed ? (')
    expect(src).toContain('<Pressable onPress={back} accessibilityRole="button" accessibilityLabel={TOPUP.back}')
  })
})

describe('0.1.13 cost ranking and the SOL line (his rulings 11-24/25, Kimi step 3 #9-11)', async () => {
  const { pickerSources, solCheaperLine, defaultSource, TOPUP } = await import('@/lib/topup')
  const { WSOL_MINT } = await import('@/lib/sign')
  const SKR = 'SKRbvo6Gf7GondiT3BbTfuRDPqLWei4j2Qy2NPGZhW3'
  const sol = (over = {}) => ({ mint: WSOL_MINT, symbol: 'SOL', decimals: 9, valueCents: 1_400, offers: [500, 1_000], splitPct: 0, costBps: 5, ...over })
  const skr = (over = {}) => ({ mint: SKR, symbol: 'SKR', decimals: 6, valueCents: 5_000, offers: [500, 1_000, 2_500], splitPct: 90, costBps: 99, ...over })
  const jup = (over = {}) => ({ mint: 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN', symbol: 'JUP', decimals: 6, valueCents: 900, offers: [500], splitPct: 0, costBps: 50, ...over })
  it('lists SOL first, then the cheapest coins (not the most valuable) when every coin has a cost', () => {
    expect(pickerSources([skr(), jup(), sol()]).map((s) => s.symbol)).toEqual(['SOL', 'JUP', 'SKR'])
  })
  it('an older API without costs keeps the value order', () => {
    const plain = (s: ReturnType<typeof skr>) => { const { splitPct: _a, costBps: _b, ...rest } = s; return rest }
    expect(pickerSources([plain(jup()), plain(skr()), sol()]).map((s) => s.symbol)).toEqual(['SOL', 'SKR', 'JUP'])
  })
  it('the default stays SOL when it is offered; else the cheapest', () => {
    expect(defaultSource(pickerSources([skr(), sol()]))?.symbol).toBe('SOL')
    expect(defaultSource(pickerSources([skr(), jup()]))?.symbol).toBe('JUP')
  })
  it('SKR picked, 90% of the split, SOL offered for this amount and cheaper: the line names the real share', () => {
    const line = solCheaperLine(skr(), [sol(), skr()], 500)
    expect(line).toBe('Your split plants 90% of it back into SKR, so SOL costs less.')
    expect(TOPUP.how(500, null, 'SKR', line!)).toBe('Swaps SKR already in this wallet for $5 of USDC. Your split plants 90% of it back into SKR, so SOL costs less.')
    expect(solCheaperLine(skr({ splitPct: 37 }), [sol(), skr()], 500)).toContain('37%')
  })
  it('no line when it would be false or not actionable', () => {
    expect(solCheaperLine(skr({ splitPct: 24 }), [sol(), skr()], 500)).toBeNull()      // under 25% of the split
    expect(solCheaperLine(skr(), [sol(), skr()], 2_500)).toBeNull()                    // SOL does not cover $25
    expect(solCheaperLine(skr(), [skr()], 500)).toBeNull()                             // SOL not in the picker
    expect(solCheaperLine(skr({ costBps: 4 }), [sol(), skr({ costBps: 4 })], 500)).toBeNull()   // SOL not cheaper
    expect(solCheaperLine(sol(), [sol(), skr()], 500)).toBeNull()                      // SOL itself picked
    expect(solCheaperLine(skr({ splitPct: undefined }), [sol(), skr()], 500)).toBeNull()        // an older API
    expect(solCheaperLine(null, null, 500)).toBeNull()
  })
})
