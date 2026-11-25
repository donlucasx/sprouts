import { describe, it, expect, afterEach } from 'vitest'
import { t, writeLangChoice } from '@/i18n'
import {
  dayHeader, filterLabel, KIND_FILTERS, KIND_TAG, kindTag, moveRow, plantingRow, spokenLabel, splitRow, swapRow, topUpRow, walletNamer, walletRow, withdrawalRow,
} from '@/model/activity'

// 0.1.13 Spanish pass P3 (b): Activity's rows with variants (wallet mine / other, plural legs, arrival today / a day, the top-up
// ruling) render whole Spanish sentences; the English stays exactly as before (activity.test.ts, activity-merge.test.ts).
afterEach(() => writeLangChoice('auto'))

const PHONE = 'PHONEaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaZZ'
const OTHER = 'FdPpbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbYjB6'

describe("t(key, vars, 'es') for a sample of Activity's keys", () => {
  it('fills placeholders in Spanish', () => {
    expect(t('activity.topup.title', { amount: '$10,00' }, 'es')).toBe('Agregaste $10,00 en USDC a tu billetera')
    expect(t('activity.topup.coin', { coin: 'SOL' }, 'es')).toBe('Con SOL de tu billetera Seed Vault. Sprouts lo usa para plantar tus redondeos.')
    expect(t('activity.planting.many', { n: 3 }, 'es')).toBe('Plantaste 3 monedas')
    expect(t('activity.showMore', { n: 4 }, 'es')).toBe('Mostrar 4 más')
  })
})

describe('Activity in Spanish, through the same functions', () => {
  it("the top-up row follows his ruling, with or without the coin, named or not", () => {
    writeLangChoice('es')
    const r = topUpRow({ ts: '2026-10-27T20:00:00Z', signature: 's', usdcRaw: '10000000', coin: 'SOL' })
    expect(r.label).toBe('Agregaste $10,00 en USDC a tu billetera')
    expect(r.details).toEqual(['Con SOL de tu billetera Seed Vault. Sprouts lo usa para plantar tus redondeos.'])
    expect(topUpRow({ ts: r.ts, signature: 's', usdcRaw: '10000000', coin: 'SOL' }, true).details).toEqual(r.details)
    expect(topUpRow({ ts: r.ts, signature: 's', usdcRaw: '10000000' }).details).toEqual(['Desde tu billetera Seed Vault. Sprouts lo usa para plantar tus redondeos.'])
  })

  it('swaps: priced or not, change planted or waiting, and which wallet', () => {
    writeLangChoice('es')
    const name = walletNamer([{ pubkey: PHONE, status: 'active' }, { pubkey: OTHER, status: 'active' }], PHONE)
    const swap = { signature: 'sw', ts: '2026-10-28T10:00:00Z', usdSizeCents: 1050, roundupCents: 50, plantingId: null }
    expect(swapRow({ ...swap, walletPubkey: PHONE }, name)).toMatchObject({ label: 'Swap de $10,50', amount: '+$0,50', details: ['Cambio de $0,50, esperando a plantarse.', 'En tu billetera Seed Vault.'] })
    expect(swapRow({ ...swap, plantingId: 'p', walletPubkey: OTHER }, name).details).toEqual(['Cambio de $0,50, plantado.', 'En FdPp...YjB6.'])
    expect(swapRow({ ...swap, usdSizeCents: null, roundupCents: 0 }).label).toBe('Swap sin precio')
  })

  it('plantings: one leg names it (lending in Spanish), several count them', () => {
    writeLangChoice('es')
    const usdc = { asset: 'USDC_LEND' as const, usdcInCents: 62, amountOutRaw: '515000', feeCents: 0, feeAmountRaw: '0', usdPrice: 1, venue: 'kamino_klend' as const }
    const p = { id: 'p', ts: '2026-10-05T15:00:00Z', status: 'confirmed', signature: 's', usdcPulledCents: 62, networkFeeCents: 0 } as const
    expect(plantingRow({ ...p, legs: [usdc] })?.label).toBe('Plantaste USDC en préstamo')
    expect(plantingRow({ ...p, legs: [usdc, { ...usdc, asset: 'SOL_LEND' as never }] })?.label).toBe('Plantaste 2 monedas')
  })

  it('splits: the AI tag, the change summary and the stop in Spanish; the why stays as the server sent it', () => {
    writeLangChoice('es')
    const s = { ts: '2026-10-03T14:00:00.000Z', by: 'manager', from: { SKR: 45, USDC_LEND: 10 }, to: { SKR: 40, USDC_LEND: 15 }, stop: 'balanced', why: 'Kamino paid more this week.', fallback: null } as never
    expect(splitRow(s, 0)).toMatchObject({ tag: 'IA', label: 'La IA cambió tu reparto', details: ['SKR de 45 a 40, USDC en préstamo de 10 a 15', 'Kamino paid more this week.'] })
    expect(splitRow({ ...(s as object), by: 'you', turnedOn: true } as never, 0).details[0]).toBe('Equilibrado.')
  })

  it('an SKR withdrawal: arriving on a day, today, or put back', () => {
    writeLangChoice('es')
    const w = { id: 'w', ts: '2026-10-03T12:00:00Z', amountRaw: null, cancelled: false, delivered: false, source: 'wallet', withdrawSignature: null, unstakeSignature: null } as never
    expect(withdrawalRow(w, null, '2026-10-04T22:00:00Z', new Date('2026-10-03T12:00:00Z')).details).toEqual(['Llega el 4 oct, 15:00.', 'Iniciado desde tu billetera.'])
    expect(withdrawalRow(w, null, '2026-10-04T22:00:00Z', new Date('2026-10-05T12:00:00Z')).details[0]).toBe('Llega hoy.')
    expect(withdrawalRow({ ...(w as object), cancelled: true } as never, null).label).toBe('Retiro devuelto')
  })

  it('moves and wallet rows', () => {
    writeLangChoice('es')
    const m = { ts: '2026-10-03T12:00:00Z', asset: 'USDC_LEND', from: 'kamino_klend', to: 'jupiter_lend' } as never
    expect(moveRow({ ...(m as object), status: 'done' } as never)).toMatchObject({ label: 'Moviste USDC', details: ['De Kamino a Jupiter.'] })
    expect(moveRow({ ...(m as object), status: 'dismissed' } as never)).toMatchObject({ label: 'Dejaste USDC en Kamino', details: ['No se movió a Jupiter.'] })
    const ts = '2026-10-28T10:00:00Z'
    expect(walletRow({ ts, kind: 'linked', wallet: PHONE, why: null, signature: null }, PHONE).label).toBe('Vinculaste tu billetera Seed Vault')
    expect(walletRow({ ts, kind: 'revoked', wallet: OTHER, why: 'approval', signature: null }, PHONE)).toMatchObject({ label: 'Se dejó de plantar desde FdPp...YjB6', details: ['Su aprobación de USDC se quitó en la billetera.'] })
  })

  it('day headers, chips, tags and what TalkBack reads', () => {
    writeLangChoice('es')
    const now = new Date(2026, 9, 5, 12)
    expect(dayHeader('2026-10-05', now)).toBe('Hoy')
    expect(dayHeader('2026-10-04', now)).toBe('Ayer')
    expect(KIND_FILTERS.map(filterLabel)).toEqual(['Todo', 'Plantar', 'Swap', 'Retirar', 'Reparto', 'Billetera'])
    expect(kindTag('topup')).toBe('Agregar')
    expect(KIND_TAG.topup).toBe('Top up')
    expect(spokenLabel({ key: 'k', ts: '2026-10-03T20:00:00Z', label: 'L', amount: null, details: [], signature: null })).toBe('3 de octubre de 2026, 13:00, L')
    expect(spokenLabel({ key: 'k', ts: '2026-10-03', label: 'L', amount: '6,1%', details: [], signature: null })).toBe('3 de octubre de 2026, L, 6,1%')
  })
})
