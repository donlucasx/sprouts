import { describe, it, expect, afterEach } from 'vitest'
import { t, writeLangChoice } from '@/i18n'
import { staleLine, usdcNotice, stoppedNotice, walletsLine, valueBlock, lastPlantingLine, previewLine, pauseState } from '@/lib/me-state'
import { nextPlantingRow, nextPlantingText } from '@/lib/next-planting'
import { plantedLine, arrivalLine, formatWallet } from '@/lib/format'
import { moveCopy, MOVE } from '@/lib/moves'
import { UNWRAP } from '@/lib/unwrap'
import { lowUsdcNotice } from '@/lib/notices'
import { coinFullName } from '@/lib/coin-names'
import { FIXTURE_MOVE } from '@/lib/lend-fixtures'

// 0.1.13 Spanish pass P2 (a): Home's lines with variants (mine / other wallet, one / many, plural, fee forks) render whole Spanish
// sentences, and the English stays exactly as before.
afterEach(() => writeLangChoice('auto'))

const PHONE = 'HJCJKRQLV2HVKfe3sFdTF5jjBY1xfWgnK8cLcjH7qnHd'
const WEB = '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU'

describe("t(key, vars, 'es') for a sample of Home's keys", () => {
  it('fills placeholders in Spanish', () => {
    expect(t('home.title.named', { name: 'lucas.skr' }, 'es')).toBe('El jardín de lucas.skr')
    expect(t('home.wallets.other', { n: 3 }, 'es')).toBe('3 billeteras vinculadas')
    expect(t('next.line.tomorrowMorning', { saved: '$1,20' }, 'es')).toBe('$1,20 ahorrados · se planta mañana por la mañana')
    expect(t('home.basket.arrives', { amount: '10,00 SKR', when: '4 oct, 15:00' }, 'es')).toBe('En la canasta: 10,00 SKR, llega el 4 oct, 15:00')
  })
})

describe('Home in Spanish, through the same functions', () => {
  it('the stale line: offline or server, today / yesterday / a day', () => {
    writeLangChoice('es')
    const now = new Date('2026-10-20T15:00:00-07:00')
    expect(staleLine(new Date('2026-10-20T09:12:00-07:00'), now, 0)).toBe('Estás sin conexión. Te mostramos tu jardín de hoy a las 9:12.')
    expect(staleLine(new Date('2026-10-19T14:05:00-07:00'), now, 500)).toBe('Sprouts no pudo cargar tu jardín en este momento. Te lo mostramos como estaba ayer a las 14:05.')
    expect(staleLine(new Date('2026-10-16T09:12:00-07:00'), now, 0)).toBe('Estás sin conexión. Te mostramos tu jardín del 16 oct.')
  })

  it('the USDC notice: the Seed Vault wallet, another wallet, several', () => {
    const me = (wallets: unknown[]) => ({ user: { pubkey: PHONE }, wallets, nextPlanting: {} }) as never
    const active = { pubkey: PHONE, status: 'active' }
    const noUsdc = (pubkey: string, need: number) => ({ pubkey, status: 'paused', pause: { reason: 'no_usdc', needCents: need } })
    writeLangChoice('en')
    expect(usdcNotice(me([active]), { usdcCents: 0, low: false })).toEqual({
      title: 'Seed Vault wallet has no USDC',
      lines: ['Sprouts plants your round-ups with USDC from this wallet. Until you add some, they wait.'],
      topUp: true,
    })
    writeLangChoice('es')
    expect(usdcNotice(me([active]), { usdcCents: 0, low: false })).toEqual({
      title: 'La billetera Seed Vault no tiene USDC',
      lines: ['Sprouts planta tus redondeos con USDC de esta billetera. Hasta que agregues USDC, esperan.'],
      topUp: true,
    })
    expect(usdcNotice(me([active]), { usdcCents: 250, low: true })?.lines[0]).toBe(
      'Sprouts planta tus redondeos con USDC de esta billetera. Quedan $2,50, así que agrega más antes de que se pausen las plantaciones.',
    )
    expect(usdcNotice(me([noUsdc(WEB, 500), active]), { usdcCents: 900, low: false })?.title).toBe('7xKX...gAsU necesita USDC')
    const many = usdcNotice(me([noUsdc(WEB, 500), active]), { usdcCents: 0, low: false })!
    expect(many.title).toBe('2 billeteras necesitan USDC')
    expect(many.lines).toEqual([
      'Sprouts planta tus redondeos con USDC de cada billetera.',
      'Billetera Seed Vault: sin USDC',
      '7xKX...gAsU: necesita $5',
      'Tus redondeos esperan hasta que lo tengan.',
    ])
  })

  it('the stopped notice: this phone or another wallet, one or many', () => {
    const at = (wallets: unknown[]) => ({ user: { pubkey: PHONE }, wallets }) as never
    writeLangChoice('es')
    expect(stoppedNotice(at([{ pubkey: PHONE, status: 'revoked', stopped: 'approval' }]))).toEqual({
      title: 'Sprouts dejó de plantar desde tu billetera Seed Vault',
      lines: [
        'La aprobación de USDC de tu billetera Seed Vault ya no está, así que Sprouts no puede plantar tus redondeos desde ella.',
        'Vincúlala de nuevo para reanudar las plantaciones.',
      ],
      button: 'Vincularla de nuevo',
    })
    const two = stoppedNotice(at([{ pubkey: PHONE, status: 'revoked', stopped: 'approval' }, { pubkey: WEB, status: 'revoked', stopped: 'outside' }]))!
    expect(two.title).toBe('Sprouts dejó de plantar desde 2 billeteras')
    expect(two.lines[1]).toBe('7xKX...gAsU se desvinculó fuera de la app, así que Sprouts no puede plantar tus redondeos desde ella.')
    expect(two.button).toBe('Vincular billeteras')
  })

  it('wallet count, value block, pause line, preview', () => {
    writeLangChoice('es')
    expect(walletsLine([{ status: 'active' }])).toBe('1 billetera vinculada')
    expect(walletsLine([{ status: 'active' }, { status: 'paused' }, { status: 'revoked' }])).toBe('2 billeteras vinculadas')
    const v = valueBlock({ valueUsd: 420.69, earnedUsd: 25.69, putInCents: 39500 }, 0n)
    expect(v.label).toBe('en tu jardín')
    expect(v.side.map((s) => [s.id, s.label])).toEqual([['putIn', 'Aportado'], ['earned', 'Ganado']])
    expect(v.a11y).toBe('$420,69 en tu jardín. Aportado: $395,00. Ganado: $25,69.')
    expect(pauseState([{ status: 'paused' }]).line).toBe('Sprouts está en pausa')
    expect(previewLine({ swaps: 4, savedCents: 123, perSwapSavedCents: 0, partial: true })).toBe('Tus swaps de los últimos 30 días habrían ahorrado al menos $1,23.')
  })

  it('the last planting row: a coin became, lending went into', () => {
    const r = { ts: '2026-10-05T21:00:00Z', usdcPulledCents: 100, amountOutRaw: '1000000', usdPrice: null, networkFeeCents: 0 }
    writeLangChoice('es')
    expect(lastPlantingLine({ ...r, asset: 'SKR', venue: null } as never)).toBe('Última plantación, 5 oct: $1,00 se convirtió en 1,00 SKR')
    expect(lastPlantingLine({ ...r, asset: 'USDC_LEND', venue: 'kamino_klend' } as never)).toBe('Última plantación, 5 oct: $1,00 pasó a USDC en préstamo (Kamino)')
  })

  it('plantedLine: every fee fork is one whole line', () => {
    writeLangChoice('es')
    expect(plantedLine({ usdcInCents: 23, asset: 'SKR', amountOutRaw: '12480000', usdPrice: 0.01833, feeCents: 1, feeAmountRaw: '0' })).toBe('$0,23 se convirtió en 12,48 SKR ($0,23), comisión $0,01')
    expect(plantedLine({ usdcInCents: 203, asset: 'hSOL', amountOutRaw: '12300000', usdPrice: 168, feeCents: 0, feeAmountRaw: '0' })).toBe('$2,03 se convirtió en 0,0123 hSOL ($2,07), comisión menor a 1 centavo')
    expect(plantedLine({ usdcInCents: 200, asset: 'SOL_LEND', amountOutRaw: '1', usdPrice: null, venue: 'jupiter_lend', feeCents: 0 })).toBe('$2,00 pasó a SOL en préstamo (Jupiter), sin comisión de Sprouts')
  })

  it('the Next planting row and the widget line', () => {
    const base = { pendingCents: 300, thresholdCents: 100, hasPlant: true, now: new Date('2026-10-02T20:00:00Z') }
    writeLangChoice('es')
    const row = nextPlantingRow(base)
    expect(row.line).toBe('$3,00 ahorrados · se planta mañana por la mañana')
    expect(row.value).toBe('Mañana, 7:00')
    expect(nextPlantingText(row)).toBe('Próxima: Mañana, 7:00')
    expect(nextPlantingRow({ ...base, paused: true }).value).toBe('En pausa')
    expect(nextPlantingRow({ ...base, pendingCents: 0 }).line).toBe('Esperando tu próximo swap')
    expect(nextPlantingRow({ ...base, pendingCents: 40 }).value).toBe('$0,40 de $1,00')
  })

  it('arrivals, a wallet line, the move card, unwrap, the low-USDC notification, coin names', () => {
    writeLangChoice('es')
    expect(arrivalLine(new Date('2026-10-04T22:00:00Z'), new Date('2026-10-05T12:00:00Z'), true)).toBe('Llega hoy')
    expect(formatWallet({ pubkey: WEB, status: 'paused', dailyCapCents: 500 })).toBe('7xKX...gAsU, en pausa, límite diario $5,00')
    expect(moveCopy(FIXTURE_MOVE).title).toMatch(/^¿Mover tu \w+ a \w+\?$/)
    expect(MOVE.moved).toBe('Movido.')
    expect(UNWRAP.button).toBe('Recuperar tu SOL')
    expect(lowUsdcNotice(0, null, false, false).notice).toEqual({ kind: 'paused', title: 'La billetera Seed Vault no tiene USDC', body: 'Tus redondeos esperan hasta que tenga USDC. Abre Sprouts para agregar USDC.' })
    expect(coinFullName('USDC_LEND')).toBe('USDC en préstamo')
    expect(coinFullName('hSOL')).toBe('Helius Staked SOL')
    writeLangChoice('en')
    expect(MOVE.moved).toBe('Moved.')
    expect(coinFullName('USDC_LEND')).toBe('USDC lending')
  })
})
