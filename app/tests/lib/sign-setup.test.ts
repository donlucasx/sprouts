import { describe, it, expect, vi } from 'vitest'
import { AccountRole, address, getAddressEncoder, getProgramDerivedAddress, type Address, type Instruction, type Transaction } from '@solana/kit'
import { leashPda, makeSigner, REFUSED, SETUP_MAX, SETUP_MINTS, SignRefused, type SignFlow, type SolUsdSource, type UsdPriceSource } from '@/lib/sign'
import { parseSwapInstructions } from '../../../api/src/lib/jupiter'
import { linkIxs, USER, wire } from '../fixtures/api-built'
import fixture from '../fixtures/jupiter-topup-exactout.json'
import tokenFixture from '../fixtures/jupiter-topup-exactout-token.json'

/**
 * Task 17b (user rent, design 4): the leading setup block. Every address below is typed here from the design's table (never read from
 * sign.ts), so a wrong or missing mint in the app's list fails this file instead of agreeing with itself.
 */
const MINTS = {
  stORE: 'storenSbvkfzircixnaosc5CbzNZVrHJ6S3EKrS1yqR',
  hSOL: 'he1iusmfkpAdwvxLNGV8Y1iSbj4rUy6yMhEA3fotn9A',
  cbBTC: 'cbbtcf3aa214zXHbiAZQwf4122FBYbraNdFqgw4iMij',
  kUSDC: 'B8V6WVjPxW1UGwVDfxH2d2r8SyT4cqn7dQRK6XneVa7D',
  fUSDC: '9BEcn9aPEmhSPbPQeFGjidRiEKki46fVQDyPpSQXPA2D',
  kSOL: '2UywZrUdyqs5vDchy7fKQJKau2RVyuzBev2XKGPDSiX1',
  fSOL: '2uQsyo1fXXQkDtcpXnLofWy88PxcvnfH2L8FPSE62FVU',
} as const
const SEVEN = Object.values(MINTS)
const NOT_SETUP = {
  USDC: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  wSOL: 'So11111111111111111111111111111111111111112',
  SKR: 'SKRbvo6Gf7GondiT3BbTfuRDPqLWei4j2Qy2NPGZhW3',
  JitoSOL: 'J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn',
  random: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263',
}
const ATA = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL'
const TOKEN = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'
const TOKEN_2022 = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb'
const SYSTEM = '11111111111111111111111111111111'
const ATTACKER = 'HN7cABqLq46Es1jh92dQQisAq662SmxELLLsHHe4YWrH'
const JUP = 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4'

const enc = (a: string) => getAddressEncoder().encode(address(a))
const ataOf = async (owner: string, mint: string, tokenProgram = TOKEN) =>
  (await getProgramDerivedAddress({ programAddress: address(ATA), seeds: [enc(owner), enc(tokenProgram), enc(mint)] }))[0] as string

type Shape = { payer?: string; owner?: string; account?: string; tokenProgram?: string; data?: number[]; extra?: string; drop?: boolean }
/** The API's setup create (api/src/lib/user-setup.ts setupCreates): CreateIdempotent [payer, ata, owner, mint, system, token], data [1]. */
async function setup(user: string, mint: string, s: Shape = {}): Promise<Instruction> {
  const payer = s.payer ?? user
  const owner = s.owner ?? user
  const tokenProgram = s.tokenProgram ?? TOKEN
  const account = s.account ?? (await ataOf(owner, mint, tokenProgram))
  const accounts = [
    { address: address(payer), role: payer === user ? AccountRole.WRITABLE_SIGNER : AccountRole.WRITABLE },
    { address: address(account), role: AccountRole.WRITABLE },
    { address: address(owner), role: AccountRole.READONLY },
    { address: address(mint), role: AccountRole.READONLY },
    { address: address(SYSTEM), role: AccountRole.READONLY },
    { address: address(tokenProgram), role: AccountRole.READONLY },
    ...(s.extra ? [{ address: address(s.extra), role: AccountRole.READONLY }] : []),
  ]
  if (s.drop) accounts.pop()
  return { programAddress: address(ATA), accounts, data: new Uint8Array(s.data ?? [1]) }
}
const setups = (user: string, mints: readonly string[]) => Promise.all(mints.map((m) => setup(user, m)))

async function signs(base64: string, flow: SignFlow, opts: { solUsd?: SolUsdSource; usdPrice?: UsdPriceSource } = {}) {
  const sign = vi.fn(async (tx: Transaction) => tx)
  expect(await makeSigner(sign, flow, opts)(base64)).toBe(base64)
  expect(sign).toHaveBeenCalledTimes(1)
}
async function refused(base64: string, flow: SignFlow, why: keyof typeof REFUSED | null = 'plan', opts: { solUsd?: SolUsdSource; usdPrice?: UsdPriceSource } = {}) {
  const sign = vi.fn(async (tx: Transaction) => tx)
  const out = makeSigner(sign, flow, opts)(base64)
  await expect(out).rejects.toThrow(SignRefused)
  if (why) await expect(out).rejects.toThrow(REFUSED[why])
  expect(sign).not.toHaveBeenCalled()
}

describe('the setup list (design 2, 4; controller ruling: frozen, the API table order)', () => {
  it('is exactly the 7 mints in the order stORE, hSOL, cbBTC, kUSDC, fUSDC, kSOL, fSOL, frozen, and SETUP_MAX is 7', () => {
    expect([...SETUP_MINTS]).toEqual(SEVEN)
    expect(Object.isFrozen(SETUP_MINTS)).toBe(true)
    expect(SETUP_MAX).toBe(7)
    expect(() => (SETUP_MINTS as string[]).push(ATTACKER)).toThrow()
  })
})

describe('link and relink with a leading setup block', () => {
  const link = (setupMax?: number): SignFlow => ({ kind: 'link', user: USER, ...(setupMax === undefined ? {} : { setupMax }) })
  const relink = (setupMax?: number): SignFlow => ({ kind: 'relink', user: USER, ...(setupMax === undefined ? {} : { setupMax }) })
  const linkShape = () => linkIxs({ createAta: true, revokeOld: true }) // [revoke, USDC create, init, create]: the link page's worst case
  const relinkShape = async () => linkIxs({ delegatee: (await leashPda(USER, USER)) as Address, createAta: true, revokeOld: true })

  it('1..7 creates with setupMax N pass; N+1 is refused (plan)', async () => {
    for (let n = 1; n <= 7; n++) {
      const lead = await setups(USER, SEVEN.slice(0, n))
      await signs(wire([...lead, ...(await linkShape())]), link(n))
      await signs(wire([...lead, ...(await relinkShape())]), relink(n))
      // fewer than shown is fine (an account appeared, SOL or size short): the screen's number is a bound
      await signs(wire([...lead, ...(await linkShape())]), link(7))
      if (n > 1) {
        await refused(wire([...lead, ...(await linkShape())]), link(n - 1))
        await refused(wire([...lead, ...(await relinkShape())]), relink(n - 1))
      }
    }
  })

  it('setupMax absent or 0 with any setup create: refused (today); with none: today exactly', async () => {
    for (const m of SEVEN) {
      await refused(wire([await setup(USER, m), ...(await linkShape())]), link())
      await refused(wire([await setup(USER, m), ...(await linkShape())]), link(0))
      await refused(wire([await setup(USER, m), ...(await relinkShape())]), relink())
    }
    await signs(wire(await linkShape()), link())
    await signs(wire(await linkShape()), link(0))
    await signs(wire(await linkShape()), link(7))
    await signs(wire(await relinkShape()), relink(3))
  })

  it('setupMax 8, -1, 1.5, NaN: refused even with no setup create', async () => {
    for (const bad of [8, -1, 1.5, Number.NaN, Infinity]) {
      await refused(wire(await linkShape()), link(bad))
      await refused(wire(await relinkShape()), relink(bad))
    }
  })

  it('each of the 7 mints passes alone', async () => {
    for (const m of SEVEN) {
      await signs(wire([await setup(USER, m), ...(await linkShape())]), link(1))
      await signs(wire([await setup(USER, m), ...(await relinkShape())]), relink(1))
    }
  })

  it('USDC, wSOL, SKR, JitoSOL or a random mint as a leading create is not a setup create (refused; the link USDC create still passes once, as today)', async () => {
    for (const m of [NOT_SETUP.wSOL, NOT_SETUP.SKR, NOT_SETUP.JitoSOL, NOT_SETUP.random]) {
      await refused(wire([await setup(USER, m), ...(await linkShape())]), link(1))
      await refused(wire([await setup(USER, m), ...(await relinkShape())]), relink(1))
    }
    // a second USDC create (the link shape already has one) is refused, as today
    await refused(wire([await setup(USER, NOT_SETUP.USDC), ...(await linkShape())]), link(7))
    // the USDC create alone at the front (no revoke): the link check reads it as today
    await signs(wire(await linkIxs({ createAta: true })), link(3))
    // a setup create then the USDC create then the rest: passes
    await signs(wire([await setup(USER, MINTS.stORE), ...(await linkIxs({ createAta: true }))]), link(1))
  })

  it("refuses another owner or payer, a non-derived account, Token-2022, Create (data [0] or empty or [2]), an extra or missing account, the same mint twice", async () => {
    const m = MINTS.hSOL
    const bad: Instruction[] = [
      await setup(USER, m, { owner: ATTACKER }),
      await setup(USER, m, { payer: ATTACKER }),
      await setup(USER, m, { account: await ataOf(ATTACKER, m) }),
      await setup(USER, m, { account: await ataOf(USER, MINTS.cbBTC) }),
      await setup(USER, m, { tokenProgram: TOKEN_2022 }),
      await setup(USER, m, { tokenProgram: TOKEN_2022, account: await ataOf(USER, m) }),
      await setup(USER, m, { data: [0] }),
      await setup(USER, m, { data: [] }),
      await setup(USER, m, { data: [2] }),
      await setup(USER, m, { data: [1, 0] }),
      await setup(USER, m, { extra: ATTACKER }),
      await setup(USER, m, { drop: true }),
    ]
    for (const ix of bad) {
      await refused(wire([ix, ...(await linkShape())]), link(7))
      await refused(wire([ix, ...(await relinkShape())]), relink(7))
    }
    await refused(wire([await setup(USER, m), await setup(USER, m), ...(await linkShape())]), link(7))
    await refused(wire([await setup(USER, m), await setup(USER, MINTS.stORE), await setup(USER, m), ...(await relinkShape())]), relink(7))
  })

  it('a setup create after the first other instruction (after the revoke, in the middle, after the delegation create) is refused', async () => {
    const s = await setup(USER, MINTS.cbBTC)
    const shape = await linkShape()
    for (let at = 1; at <= shape.length; at++) {
      const ixs = [...shape]
      ixs.splice(at, 0, s)
      await refused(wire(ixs), link(7))
    }
    const r = await relinkShape()
    for (let at = 1; at <= r.length; at++) {
      const ixs = [...r]
      ixs.splice(at, 0, s)
      await refused(wire(ixs), relink(7))
    }
  })

  it('review fix 1: an instruction from another program with the exact setup shape ([user, ata, user, mint, system, token], data [1]) is not peeled and is refused', async () => {
    for (const program of [TOKEN, SYSTEM, ATTACKER]) {
      const lookAlike = { ...(await setup(USER, MINTS.stORE)), programAddress: address(program) }
      await refused(wire([lookAlike, ...(await linkShape())]), link(7), null)
      await refused(wire([lookAlike, ...(await relinkShape())]), relink(7), null)
      await refused(wire([await setup(USER, MINTS.hSOL), lookAlike, ...(await linkShape())]), link(7), null)
    }
  })

  it('setupMax on another flow kind changes nothing (a setup create on revoke is refused)', async () => {
    const flow = { kind: 'revoke', user: USER, setupMax: 7 } as unknown as SignFlow
    await refused(wire([await setup(USER, MINTS.stORE)]), flow, 'program')
  })
})

describe('both top-ups with a leading setup block (before the compute budget)', () => {
  const TUSER = fixture.user
  type Fixture = typeof fixture
  const built = (f: Fixture = fixture): Instruction[] => {
    const p = parseSwapInstructions(JSON.parse(JSON.stringify(f.swapInstructions)))
    return [...p.computeBudget, ...p.setup, p.swap, ...(p.cleanup ? [p.cleanup] : [])]
  }
  const fair = 5 / (Number(fixture.quote.inAmount) / 1e9)
  const solUsd: SolUsdSource = async () => fair
  const sol = (setupMax?: number): SignFlow => ({ kind: 'topup', user: TUSER, usdcRaw: '5000000', ...(setupMax === undefined ? {} : { setupMax }) })
  const T = tokenFixture as unknown as Fixture
  const MINT = tokenFixture.quote.inputMint
  const tfair = 5 / (Number(tokenFixture.quote.inAmount) / 1e6)
  const usdPrice: UsdPriceSource = async () => ({ usd: tfair, decimals: 6 })
  const token = (setupMax?: number): SignFlow => ({ kind: 'topup', user: TUSER, usdcRaw: '5000000', inputMint: MINT, ...(setupMax === undefined ? {} : { setupMax }) })

  it('SOL and token top-ups with 1..3 creates and setupMax N pass; N+1 refused; absent refused', async () => {
    await signs(wire(built(), TUSER as Address), sol(), { solUsd })
    await signs(wire(built(T), TUSER as Address), token(), { usdPrice })
    for (let n = 1; n <= 3; n++) {
      const lead = await setups(TUSER, SEVEN.slice(7 - n))
      await signs(wire([...lead, ...built()], TUSER as Address), sol(n), { solUsd })
      await signs(wire([...lead, ...built(T)], TUSER as Address), token(n), { usdPrice })
      await refused(wire([...lead, ...built()], TUSER as Address), sol(n - 1), null, { solUsd })
      await refused(wire([...lead, ...built(T)], TUSER as Address), token(n - 1), null, { usdPrice })
      await refused(wire([...lead, ...built()], TUSER as Address), sol(), null, { solUsd })
    }
  })

  it('each of the 7 mints passes as a top-up setup create', async () => {
    for (const m of SEVEN) await signs(wire([await setup(TUSER, m), ...built()], TUSER as Address), sol(1), { solUsd })
  })

  it('a setup create after the compute budget, after the swap, or not the wallet own: refused', async () => {
    const s = await setup(TUSER, MINTS.kSOL)
    const ixs = built()
    const swapAt = ixs.findIndex((ix) => ix.programAddress === JUP)
    for (const at of [1, swapAt, swapAt + 1, ixs.length]) {
      const x = [...ixs]
      x.splice(at, 0, s)
      await refused(wire(x, TUSER as Address), sol(3), null, { solUsd })
    }
    await refused(wire([await setup(TUSER, MINTS.kSOL, { owner: ATTACKER }), ...ixs], TUSER as Address), sol(3), null, { solUsd })
    await refused(wire([await setup(TUSER, MINTS.kSOL, { tokenProgram: TOKEN_2022 }), ...ixs], TUSER as Address), sol(3), null, { solUsd })
    await refused(wire([await setup(TUSER, NOT_SETUP.SKR), ...ixs], TUSER as Address), sol(3), null, { solUsd })
  })
})
