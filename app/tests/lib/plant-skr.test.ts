import { describe, it, expect, vi, beforeEach } from 'vitest'
import { address, createNoopSigner, type Address, type Instruction, type Transaction } from '@solana/kit'
import { getStakeInstructionAsync } from '../../../api/src/generated/staking'
import { GUARDIAN_POOL, SKR_MINT, SKR_STAKING_PROGRAM, STAKE_CONFIG, STAKE_VAULT } from '../../../api/src/lib/constants'
import { makeSigner, REFUSED, SignRefused, userStakePda, type SignFlow } from '@/lib/sign'
import { homeCoinRows, idleSkrRow, IDLE_SKR_ROW_KEY, idleSkrOf, MIN_PLANT_RAW, PLANT_DEFAULT, PlantFailed, plantAmountRaw, plantOptions, plantSkrThisPhone, plantUsdText, showPlantMarker, skrAmountText } from '@/lib/plant-skr'
import { plantCard } from '@/lib/plant-card'
import { coinRows } from '@/lib/me-state'
import { coinSheet } from '@/lib/coin-sheet'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { skrPlantRow } from '@/model/activity'
import { writeLangChoice } from '@/i18n'
import { en } from '@/i18n/en'
import { es } from '@/i18n/es'
import type { MeResponse } from '@/lib/api'
import { wire, USER, OTHER, ATTACKER } from '../fixtures/api-built'
import { ataOf } from '../fixtures/lend-built'

// 0.1.13 Plant my SKR (brief 2026-11-25, Kimi scope check #4, #8, #13, #15).
const AMOUNT = 1_240_000_000n
const flow: SignFlow = { kind: 'stake', user: USER, amountRaw: AMOUNT.toString() }

/** ComputeBudget SetComputeUnitLimit / SetComputeUnitPrice, as @solana-program/compute-budget encodes them (no accounts). */
const CB = address('ComputeBudget111111111111111111111111111111')
const cuLimit = (units: number): Instruction => { const d = new Uint8Array(5); d[0] = 2; new DataView(d.buffer).setUint32(1, units, true); return { programAddress: CB, data: d } }
const cuPrice = (micro: bigint): Instruction => { const d = new Uint8Array(9); d[0] = 3; new DataView(d.buffer).setBigUint64(1, micro, true); return { programAddress: CB, data: d } }

/** api/src/lib/staking.ts buildStakeIx, same arguments: payer = user = the wallet, SKR out of the payer's own SKR account. */
async function stakeIx(amount: bigint, payer: Address = USER, user: Address = USER): Promise<Instruction> {
  return getStakeInstructionAsync({
    stakeConfig: STAKE_CONFIG, guardianPool: GUARDIAN_POOL, payer: createNoopSigner(payer), user, userStake: (await userStakePda(user)) as Address,
    userTokenAccount: (await ataOf(payer, SKR_MINT)) as Address, stakeVault: STAKE_VAULT, mint: SKR_MINT, program: SKR_STAKING_PROGRAM, amount,
  }) as Promise<Instruction>
}
/** api/src/lib/plant-skr.ts plantSkrIxs: the capped compute budget (120k units at 1,000 micro-lamports), then the stake. */
const built = async (amount = AMOUNT) => [cuLimit(120_000), cuPrice(1_000n), await stakeIx(amount)]
const retarget = (ix: Instruction, k: number, to: string): Instruction => ({ ...ix, accounts: ix.accounts!.map((a, i) => (i === k ? { ...a, address: address(to) } : a)) })

async function signs(ixs: Instruction[], f: SignFlow = flow) {
  const sign = vi.fn(async (tx: Transaction) => tx)
  await makeSigner(sign, f)(wire(ixs))
  expect(sign).toHaveBeenCalledTimes(1)
}
async function refused(ixs: Instruction[], f: SignFlow = flow, why?: keyof typeof REFUSED) {
  const sign = vi.fn(async (tx: Transaction) => tx)
  const out = makeSigner(sign, f)(wire(ixs))
  await expect(out).rejects.toThrow(SignRefused)
  if (why) await expect(out).rejects.toThrow(REFUSED[why])
  expect(sign).not.toHaveBeenCalled()
}

describe("sign.ts 'stake': only the capped compute budget and one stake of exactly the amount shown, every account pinned", () => {
  it('signs the API-shaped stake (and one with no compute budget at all)', async () => {
    await signs(await built())
    await signs([await stakeIx(AMOUNT)])
  })
  it('refuses another amount, a stake of zero, and a non-number flow amount', async () => {
    await refused(await built(AMOUNT + 1n), flow, 'plan')
    await refused(await built(), { ...flow, amountRaw: '0' }, 'plan')
    await refused(await built(), { ...flow, amountRaw: '12.5' }, 'plan')
  })
  it('refuses an extra instruction: a second stake, a compute budget after it, a token transfer, a second limit', async () => {
    const [l, p, s] = await built()
    await refused([l, p, s, s], flow, 'plan')
    await refused([l, p, s, cuPrice(1n)], flow, 'program')
    const transfer: Instruction = { programAddress: address('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'), accounts: s.accounts!.slice(5, 7), data: new Uint8Array([3, 1, 0, 0, 0, 0, 0, 0, 0]) }
    await refused([l, p, transfer, s], flow, 'program')
    await refused([l, l, s], flow, 'plan')
    await refused([l, p], flow, 'plan')
  })
  it('refuses an uncapped priority fee (over 0.001 SOL)', async () => {
    const s = await stakeIx(AMOUNT)
    await refused([cuLimit(1_400_000), cuPrice(1_000_000n), s], flow, 'plan')
    await signs([cuLimit(1_000_000), cuPrice(1_000_000n), s]) // exactly 0.001 SOL: the top-up's cap
  })
  it('refuses every account but the pinned one: position, config, pool, payer, user, SKR account, vault, mint, token, system, events, program', async () => {
    const [l, p, s] = await built()
    for (let k = 0; k < 12; k++) await refused([l, p, retarget(s, k, ATTACKER)], flow)
    // a stake paid from another wallet's SKR, or for another beneficiary
    await refused([l, p, await stakeIx(AMOUNT, OTHER, USER)], flow)
    await refused([l, p, await stakeIx(AMOUNT, USER, OTHER)], flow)
  })
  it("refuses another wallet's flow on the same bytes (fee payer)", async () => {
    await refused(await built(), { ...flow, user: OTHER }, 'payer')
  })
})

const idle = { raw: 1_240_123_456n, usdCents: 2480 }
describe('amounts: [25%] [50%] [All], All first, floored, the dollars from /api/me', () => {
  it('floors each share to hundredths of SKR, so the button names exactly what is signed', () => {
    expect(PLANT_DEFAULT).toBe('all')
    expect(plantAmountRaw(idle.raw, 'all')).toBe(1_240_120_000n)
    expect(plantAmountRaw(idle.raw, '50')).toBe(620_060_000n)
    expect(plantAmountRaw(idle.raw, '25')).toBe(310_030_000n)
    expect(skrAmountText(1_240_000_000n)).toBe('1,240')
    expect(skrAmountText(310_030_000n)).toBe('310.03')
    expect(plantUsdText(1_240_000_000n, { raw: 1_240_000_000n, usdCents: 2480 })).toBe('24.80')
  })
  it('options in order, labelled 25% 50% All; a share under 1 SKR is not offered', () => {
    writeLangChoice('en')
    expect(plantOptions(idle).map((o) => o.label)).toEqual(['25%', '50%', 'All'])
    expect(plantOptions({ raw: 3_000_000n, usdCents: 600 }).map((o) => o.value)).toEqual(['50', 'all'])
    expect(plantAmountRaw(3_000_000n, '25')).toBeLessThan(MIN_PLANT_RAW)
  })
  it("the owner's lines, verbatim, with the amount and the dollars", () => {
    writeLangChoice('en')
    expect(en['plant.amount'].replace('{amount}', '1,240').replace('{usd}', '24.80')).toBe('1,240 SKR (about $24.80)')
    expect(en['plant.button']).toBe('Plant {amount} SKR')
    expect(en['plant.line']).toBe('Stakes this SKR in your garden, where it earns staking rewards. Taking it out later takes 48 hours.')
    expect(en['plant.instead']).toBe('Plant my SKR instead')
    expect(en['activity.planted']).toBe('Planted {amount} SKR')
    expect(en['activity.planted.from']).toBe('From this wallet.')
    // fix round 1 (his copy, 11-25)
    expect(en['plant.done']).toBe('Planted {amount} SKR. Your garden updates within a minute.')
    expect(en['plant.sent']).toBe('Not confirmed yet. Check your SKR plant in a minute before trying again.')
  })
  it('no fee wording and never "free", in English or Spanish; every new key has its Spanish line', () => {
    const keys = Object.keys(en).filter((k) => k.startsWith('plant.') || k.startsWith('activity.planted'))
    expect(keys.length).toBeGreaterThan(8)
    for (const k of keys) {
      const lines = [en[k as keyof typeof en], es[k as keyof typeof en] ?? '']
      expect(es[k as keyof typeof en], k).toBeTruthy()
      for (const l of lines) expect(l, k).not.toMatch(/\bfee|free|gratis|comisi|tarifa/i)
    }
    expect(es['plant.title']).toBe('Planta mi SKR')
  })
})

const pot = { skrStakedRaw: '34900000', skrEarnedRaw: '2000000', skrUsd: 0.02 } as MeResponse['pot']
const meWith = (idleSkr?: MeResponse['idleSkr']) =>
  ({ pot, holdings: [], positions: [], nextPlanting: { pendingCents: 0, thresholdCents: 100, capLeftCents: 0, asset: 'SKR' }, ...(idleSkr === undefined ? {} : { idleSkr }) }) as unknown as MeResponse

describe('the marker (Kimi #13): the SKR row and the SKR plant card, only while idleSkr is set', () => {
  beforeEach(() => writeLangChoice('en'))
  it('an older API (no idleSkr) or null: no marker on the row or the card', () => {
    for (const m of [meWith(), meWith(null), meWith({ raw: 'x', usdCents: 600 } as never), meWith({ raw: '0', usdCents: 600 })]) {
      expect(idleSkrOf(m)).toBeNull()
      const row = coinRows(m).find((r) => r.asset === 'SKR')
      expect(showPlantMarker(m, row)).toBe(false)
      expect(plantCard(m, 'SKR').marker).toBeNull()
    }
  })
  it('idleSkr set: the SKR row and card carry it; no other coin does', () => {
    const m = meWith({ raw: '500000000', usdCents: 1000 })
    const row = coinRows(m).find((r) => r.asset === 'SKR')
    expect(showPlantMarker(m, row)).toBe(true)
    expect(plantCard(m, 'SKR').marker).toBe('SKR you can plant')
    expect(plantCard(m, 'hSOL').marker).toBeNull()
    expect(showPlantMarker(m, null)).toBe(false)
  })
})

describe('plantSkrThisPhone (the topUpThisPhone shape)', () => {
  const okSign = (seen: SignFlow[]) => (f: SignFlow) => async (tx: string) => { seen.push(f); return `signed:${tx}` }
  it("builds the button's amount, signs the 'stake' flow for exactly it, confirms; 202 is pending", async () => {
    const seen: SignFlow[] = []
    const build = vi.fn(async (b: { amountRaw: string }) => ({ transaction: 'T', amountRaw: b.amountRaw }))
    const confirm = vi.fn(async () => ({ status: 'confirmed' }))
    expect(await plantSkrThisPhone({ user: USER, amountRaw: AMOUNT, build, sign: okSign(seen), confirm })).toBe('confirmed')
    expect(build).toHaveBeenCalledWith({ amountRaw: '1240000000' })
    expect(seen).toEqual([{ kind: 'stake', user: USER, amountRaw: '1240000000' }])
    expect(confirm).toHaveBeenCalledWith({ signedTransaction: 'signed:T' })
    expect(await plantSkrThisPhone({ user: USER, amountRaw: AMOUNT, build, sign: okSign([]), confirm: async () => ({ status: 'pending' }) })).toBe('pending')
  })
  it('a build for another amount is refused before the wallet is asked', async () => {
    const seen: SignFlow[] = []
    await expect(plantSkrThisPhone({ user: USER, amountRaw: AMOUNT, build: async () => ({ transaction: 'T', amountRaw: '1240000001' }), sign: okSign(seen), confirm: async () => ({}) })).rejects.toThrow(REFUSED.plan)
    expect(seen).toHaveLength(0)
  })
  it("errors say what they mean: the API's words before and after, 'sent' when the answer is lost", async () => {
    writeLangChoice('en')
    const apiErr = (status: number, message: string) => Object.assign(new Error(message), { status })
    const stale = 'Your SKR balance changed. Nothing was asked of your wallet. Pick an amount again.'
    await expect(plantSkrThisPhone({ user: USER, amountRaw: AMOUNT, build: async () => { throw apiErr(409, stale) }, sign: okSign([]), confirm: async () => ({}) })).rejects.toThrow(stale)
    await expect(plantSkrThisPhone({ user: USER, amountRaw: AMOUNT, build: async () => { throw new Error('offline') }, sign: okSign([]), confirm: async () => ({}) })).rejects.toThrow(en['plant.failedBefore'])
    const ok = async (b: { amountRaw: string }) => ({ transaction: 'T', amountRaw: b.amountRaw })
    await expect(plantSkrThisPhone({ user: USER, amountRaw: AMOUNT, build: ok, sign: () => async () => { throw new Error('dropped') }, confirm: async () => ({}) })).rejects.toBeInstanceOf(PlantFailed)
    await expect(plantSkrThisPhone({ user: USER, amountRaw: AMOUNT, build: ok, sign: okSign([]), confirm: async () => { throw apiErr(500, 'x') } })).rejects.toThrow(en['plant.sent'])
    await expect(plantSkrThisPhone({ user: USER, amountRaw: AMOUNT, build: ok, sign: okSign([]), confirm: async () => { throw apiErr(503, 'paused') } })).rejects.toThrow('paused')
  })
})

describe("Activity's row: 'Planted {amount} SKR' / 'From this wallet.'", () => {
  it('in English and Spanish; a malformed amount is no row', () => {
    writeLangChoice('en')
    expect(skrPlantRow({ ts: '2026-11-25T10:00:00Z', signature: 'S', amountRaw: '1240000000' })).toMatchObject({ label: 'Planted 1,240 SKR', details: ['From this wallet.'], signature: 'S', amount: null })
    writeLangChoice('es')
    expect(skrPlantRow({ ts: '2026-11-25T10:00:00Z', signature: 'S', amountRaw: '1240000000' })?.label).toBe('Plantaste 1.240 SKR')
    writeLangChoice('en')
    expect(skrPlantRow({ ts: '2026-11-25T10:00:00Z', signature: 'S', amountRaw: 'nope' })).toBeNull()
  })
})

describe('fix round 1: the $0 SKR row when nothing is staked (his ruling 11-25)', () => {
  const zero = { ...pot, skrStakedRaw: '0', skrEarnedRaw: '0' } as MeResponse['pot']
  const fresh = (idleSkr?: MeResponse['idleSkr']) =>
    ({ pot: zero, holdings: [], positions: [], basket: null, history: { plantings: [], picks: [] }, nextPlanting: { pendingCents: 0, thresholdCents: 100, capLeftCents: 0, asset: 'SKR' }, ...(idleSkr === undefined ? {} : { idleSkr }) }) as unknown as MeResponse
  beforeEach(() => writeLangChoice('en'))
  it('idleSkr set and nothing staked: Home lists an SKR row at $0 first, with the marker; the plant card opens it', () => {
    const m = fresh({ raw: '500000000', usdCents: 1000 })
    const row = idleSkrRow(m)
    expect(row).toMatchObject({ key: IDLE_SKR_ROW_KEY, asset: 'SKR', usd: '$0.00', venue: null })
    expect(homeCoinRows(m)[0]).toEqual(row)
    expect(showPlantMarker(m, row)).toBe(true)
    expect(plantCard(m, 'SKR')).toMatchObject({ value: '$0.00', marker: 'SKR you can plant' })
    expect(plantCard(m, 'SKR').row?.key).toBe(IDLE_SKR_ROW_KEY)
  })
  it('its sheet: Put in $0.00 and Where, no Withdraw, no wallet line, no plantings', () => {
    const m = fresh({ raw: '500000000', usdCents: 1000 })
    const sheet = coinSheet(m, idleSkrRow(m)!)
    expect(sheet.lines).toEqual([{ label: 'Put in', value: '$0.00' }, { label: 'Where', value: 'Nothing planted here yet' }])
    expect(sheet.withdrawKey).toBeUndefined()
    expect(sheet.walletNote).toBeNull()
    expect(sheet.plantings).toEqual([])
  })
  it('goes once idleSkr is null (or from an older API); never added beside a staked SKR row', () => {
    expect(idleSkrRow(fresh(null))).toBeNull()
    expect(idleSkrRow(fresh())).toBeNull()
    expect(homeCoinRows(fresh(null)).some((r) => r.asset === 'SKR')).toBe(false)
    const staked = meWith({ raw: '500000000', usdCents: 1000 })
    expect(idleSkrRow(staked)).toBeNull()
    expect(homeCoinRows(staked).filter((r) => r.asset === 'SKR')).toHaveLength(1)
    expect(homeCoinRows(staked)[0].key).toBe('SKR')
  })
  it('the seed marker is the mark\'s seed alone: the seed group and its crack mask, no sprout', () => {
    const src = readFileSync(path.resolve(__dirname, '../../src/components/Mark.tsx'), 'utf8')
    const seed = src.slice(src.indexOf('const SEED_ART'), src.indexOf('export function SeedMark'))
    expect(seed).toContain('k6b-ms')
    expect(seed).not.toContain('k6b-mb')
    expect(seed).not.toContain('<circle')
    expect(src).toContain("export function SeedMark")
  })
})
