import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { REFUSED, SignRefused, type SignFlow } from '@/lib/sign'
import { DROPPED_NOTHING_SENT } from '@/lib/wallet-errors'
import { cardCoins, choiceFor, greyedCoins, ME_USDC_SETUP, meUsdcSetupKey, ME_USDC_WITH_SOURCES, postLinkUsdc, SEND_PICK, TOPUP, TopUpFailed, topUpCard, topUpCentsFor, topUpOffer, topUpThisPhone } from '@/lib/topup'

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
    const lines = [TOPUP.open, TOPUP.disclaimer, TOPUP.coinTitle('SOL'), TOPUP.coinLine('SOL'), TOPUP.send, TOPUP.sendLine, TOPUP.button(500), TOPUP.done(500), TOPUP.doneLink(500), TOPUP.sent, TOPUP.failedBefore]
    // 11-27 (his ruling): one "Top up"; each coin's row says the swap outright; never "you need SOL"
    expect(TOPUP.open).toBe('Top up')
    expect(TOPUP.button(500)).toBe('Add $5 of USDC')
    expect(TOPUP.coinLine('SOL')).toBe('Swaps SOL in this wallet for USDC.')
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

describe('0.1.13 the no-USDC card (his ruling 11-27, Kimi scope 11-27 #2): order, greyed rows, the flow', () => {
  const SKR = 'SKRbvo6Gf7GondiT3BbTfuRDPqLWei4j2Qy2NPGZhW3'
  const WSOL = 'So11111111111111111111111111111111111111112'
  const JUP = 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN'
  const WIF = 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm'
  const sol = (over = {}) => ({ mint: WSOL, symbol: 'SOL', decimals: 9, valueCents: 1_400, offers: [500, 1_000], splitPct: 0, costBps: 5, ...over })
  const skr = (over = {}) => ({ mint: SKR, symbol: 'SKR', decimals: 6, valueCents: 5_000, offers: [500, 1_000, 2_500], splitPct: 90, costBps: 99, ...over })
  const coin = (symbol: string, mint: string, over = {}) => ({ mint, symbol, decimals: 6, valueCents: 9_000, offers: [500], splitPct: 0, costBps: 1, ...over })
  const plain = <T extends { splitPct?: number; costBps?: number }>(s: T) => { const { splitPct: _a, costBps: _b, ...rest } = s; return rest }
  const base = { open: true, waiting: false, pick: null as string | null, sources: null as never, unavailable: null as never, offers: null as number[] | null }

  it('payable coins by the server cost ranking (cheapest first), whichever coin that is', () => {
    expect(cardCoins([skr(), sol()], null).map((s) => s.symbol)).toEqual(['SOL', 'SKR'])
    expect(cardCoins([sol({ costBps: 120 }), skr({ costBps: 40 })], null).map((s) => s.symbol)).toEqual(['SKR', 'SOL'])
    // ties: more value first
    expect(cardCoins([sol({ costBps: 50, valueCents: 600 }), skr({ costBps: 50 })], null).map((s) => s.symbol)).toEqual(['SKR', 'SOL'])
  })
  it('without costs (an older API or no split): SOL first, then by value', () => {
    expect(cardCoins([plain(skr()), plain(sol())], null).map((s) => s.symbol)).toEqual(['SOL', 'SKR'])
  })
  it('only SKR and SOL ever show (his "Not now" for WIF and the rest), and only coins with amounts the phone would sign', () => {
    expect(cardCoins([coin('WIF', WIF), coin('JUP', JUP), skr(), sol()], null).map((s) => s.symbol)).toEqual(['SOL', 'SKR'])
    expect(cardCoins([sol({ offers: [] }), skr()], null).map((s) => s.symbol)).toEqual(['SKR'])
    expect(cardCoins([coin('WIF', WIF)], [500])).toEqual([])
  })
  it('an older API with no list (Link a wallet, 0.1.11): SOL with topUpCents; null = every amount; [] = SOL cannot pay', () => {
    for (const sources of [null, undefined, []]) {
      expect(cardCoins(sources, [500, 1_000])).toEqual([{ mint: WSOL, symbol: 'SOL', decimals: 9, valueCents: 0, offers: [500, 1_000] }])
      expect(cardCoins(sources, null)[0].offers).toEqual([500, 1_000, 2_500])
      expect(cardCoins(sources, [])).toEqual([])
    }
  })
  it('greyed rows: only SKR/SOL, never one that pays, never an unknown reason or a repeat, in the server order', () => {
    const u = (symbol: string, mint: string, reason: string) => ({ mint, symbol, reason }) as never
    const payable = cardCoins([sol()], null)
    expect(greyedCoins([u('SKR', SKR, 'none_here'), u('SOL', WSOL, 'not_enough')], payable)).toEqual([{ mint: SKR, symbol: 'SKR', reason: 'none_here' }])
    expect(greyedCoins([u('WIF', WIF, 'none_here'), u('SKR', SKR, 'no_route'), u('SKR', SKR, 'not_enough'), u('SKR', SKR, 'none_here')], [])).toEqual([{ mint: SKR, symbol: 'SKR', reason: 'not_enough' }])
    expect(greyedCoins(null, payable)).toEqual([])
    expect(greyedCoins(undefined, [])).toEqual([])
  })
  it('the greyed reasons, en', () => {
    expect(TOPUP.greyed('SKR', 'none_here')).toBe('No SKR in this wallet')
    expect(TOPUP.greyed('SOL', 'not_enough')).toBe('Not enough SOL for $5')
  })
  it('the flow: closed -> open (payable, then greyed, then Send USDC) -> a coin (its amounts) or Send USDC (the address)', () => {
    const sources = [skr(), sol({ offers: [] })]
    const unavailable = [{ mint: WSOL, symbol: 'SOL', reason: 'not_enough' as const }]
    expect(topUpCard({ ...base, open: false, sources, unavailable })).toEqual({ step: 'closed', waiting: false })
    const opened = topUpCard({ ...base, sources, unavailable })
    expect(opened).toMatchObject({ step: 'open', picked: null })
    if (opened.step !== 'open') throw new Error('open')
    expect(opened.coins.map((s) => s.symbol)).toEqual(['SKR'])
    expect(opened.greyed).toEqual(unavailable)
    expect(topUpCard({ ...base, sources, unavailable, pick: SKR })).toMatchObject({ picked: { kind: 'coin', source: { symbol: 'SKR', offers: [500, 1_000, 2_500] } } })
    expect(topUpCard({ ...base, sources, unavailable, pick: SEND_PICK })).toMatchObject({ picked: { kind: 'send' } })
    // a greyed coin cannot be picked
    expect(topUpCard({ ...base, sources, unavailable, pick: WSOL })).toMatchObject({ picked: null })
  })
  it('loading: [Top up] holds (closed, waiting) until the ?sources=1 read lands, even when tapped', () => {
    expect(topUpCard({ ...base, waiting: true, sources: [sol()] })).toEqual({ step: 'closed', waiting: true })
  })
  it('late offers: the picked coin keeps its row while its amounts change in place; one that can no longer pay drops back to nothing picked', () => {
    expect(topUpCard({ ...base, pick: SKR, sources: [sol(), skr({ offers: [500] })] })).toMatchObject({ picked: { kind: 'coin', source: { symbol: 'SKR', offers: [500] } } })
    expect(topUpCard({ ...base, pick: SKR, sources: [sol(), skr({ offers: [500, 1_000] })] })).toMatchObject({ picked: { kind: 'coin', source: { symbol: 'SKR', offers: [500, 1_000] } } })
    expect(topUpCard({ ...base, pick: SKR, sources: [sol()] })).toMatchObject({ picked: null })
    // the amount chip: one the new offers do not hold is never built (the smallest that covers the suggestion instead)
    expect(choiceFor(700, [500, 1_000])).toBe(1_000)
    expect(choiceFor(700, [500])).toBe(500)
  })
  it('TopUp.tsx renders the view: [Top up] + its line closed, rows with a11y role/state/label, the greyed ones not pressable, Send USDC last', () => {
    const src = readFileSync(new URL('../../src/components/TopUp.tsx', import.meta.url), 'utf8')
    expect(src).toContain('const view = topUpCard({ open, waiting, pick, sources, unavailable, offers })')
    expect(src).toMatch(/<Button title=\{TOPUP\.open\} loading=\{view\.waiting\} onPress=\{\(\) => setOpen\(true\)\} \/>\n\s+<ThemedText[^>]*>\n\s+\{TOPUP\.disclaimer\}/)
    const coins = src.indexOf('{view.coins.map(')
    const greyed = src.indexOf('{view.greyed.map(')
    const send = src.indexOf('<OptionRow title={TOPUP.send}')
    expect(coins).toBeGreaterThan(0)
    expect(greyed).toBeGreaterThan(coins)
    expect(send).toBeGreaterThan(greyed)
    expect(src).toContain('line={TOPUP.greyed(g.symbol, g.reason)} selected={false} disabled greyed')
    expect(src).toContain('accessibilityState={{ selected, disabled }}')
    expect(src).toContain('accessibilityLabel={`${title}. ${line}`}')
    expect(src).toContain('minHeight: TARGET')
    expect(src).toMatch(/const back = \(\) => \{\n\s+setOpen\(false\)\n\s+setPick\(null\)\n\s+setLine\(null\)\n\s+\}/)
    expect(src).toContain('<Pressable onPress={back} accessibilityRole="button" accessibilityLabel={TOPUP.back}')
    // after it lands: only the confirmation line
    expect(src).toMatch(/if \(landed\)\n\s+return \(\n\s+<ThemedText tone="accentText"/)
  })
  it("Home passes the greyed list and holds [Top up] while its read is pending; Link a wallet keeps the same component", () => {
    const home = readFileSync(new URL('../../src/app/(tabs)/home.tsx', import.meta.url), 'utf8')
    expect(home).toContain('const { data: usdcRead, isPending: usdcPending } = useQuery(')
    expect(home.match(/unavailable=\{usdcRead\?\.topUpUnavailable \?\? null\} waiting=\{usdcPending\}/g)?.length).toBe(2)
    const connect = readFileSync(new URL('../../src/app/connect.tsx', import.meta.url), 'utf8')
    expect(connect).toContain('<TopUpButton compact user={session.pubkey}')
  })
})

describe('0.1.13 the SOL line (his rulings 11-24/25, Kimi step 3 #9-11)', async () => {
  const { solCheaperLine } = await import('@/lib/topup')
  const { WSOL_MINT } = await import('@/lib/sign')
  const SKR = 'SKRbvo6Gf7GondiT3BbTfuRDPqLWei4j2Qy2NPGZhW3'
  const sol = (over = {}) => ({ mint: WSOL_MINT, symbol: 'SOL', decimals: 9, valueCents: 1_400, offers: [500, 1_000], splitPct: 0, costBps: 5, ...over })
  const skr = (over = {}) => ({ mint: SKR, symbol: 'SKR', decimals: 6, valueCents: 5_000, offers: [500, 1_000, 2_500], splitPct: 90, costBps: 99, ...over })
  it('SKR picked, 90% of the split, SOL offered for this amount and cheaper: the line names the real share', () => {
    expect(solCheaperLine(skr(), [sol(), skr()], 500)).toBe('Your split plants 90% of it back into SKR, so SOL costs less.')
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
