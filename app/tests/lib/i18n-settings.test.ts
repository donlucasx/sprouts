import { describe, it, expect, afterEach } from 'vitest'
import { t, writeLangChoice } from '@/i18n'
import { en } from '@/i18n/en'
import { es } from '@/i18n/es'
import { weekLine } from '@/lib/week'
import { amountProblem, maxAmountText, parseSkr } from '@/lib/forms'
import { lendAmountProblem, lendMaxText, lendScreenLines, parseCoinAmount, POOL_FULL_LINE } from '@/lib/lend-withdraw'
import { withdrawRows } from '@/lib/withdraw-list'
import { FIXTURE_POSITIONS, FIXTURE_VENUES } from '@/lib/lend-fixtures'
import { venueLines } from '@/model/venues'
import { splitTotal, undoLine, stopLabel, STOP_LINE, ROWS_LINE } from '@/model/manager'
import { disclosures, DISCLOSURES, HOW_IT_WORKS } from '@/lib/settings-copy'
import { joinsLine } from '@/lib/opening'
import type { MeResponse } from '@/lib/api'

// 0.1.13 Spanish pass P4 (c): Settings, Rules, Withdraw, lending withdraw, venues, Message us. Lines with variants (plural week,
// basket today / a day, rate with or without rewards and average, total over / under 100) render whole Spanish sentences; amounts and
// the Max prefill follow the language's separators; the English stays exactly as before (the area's own tests).
afterEach(() => writeLangChoice('auto'))

const now = new Date('2026-10-08T20:00:00Z')
const at = (daysAgo: number) => new Date(now.getTime() - daysAgo * 24 * 3600 * 1000).toISOString()
const pot = { skrStakedRaw: '34900000', skrUsd: 0.0183 } as MeResponse['pot']

describe("t(key, vars, 'es') for a sample of the area's keys", () => {
  it('fills placeholders in Spanish', () => {
    expect(t('settings.wallets.revoke.a11y', { wallet: 'Fdpp...YjB6' }, 'es')).toBe('Revocar la billetera Fdpp...YjB6')
    expect(t('rules.cap.chip', { amount: '$5' }, 'es')).toBe('Límite diario $5')
    expect(t('support.thanks', { email: 'a@b.co' }, 'es')).toBe('Gracias. Te responderemos a a@b.co, normalmente en un día.')
    expect(t('terms.agreed', { date: '3 de octubre de 2025' }, 'es')).toBe('Aceptaste estos Términos el 3 de octubre de 2025.')
  })
  it("Rules says Home's preview words: \"Agregar 10¢ a cada swap\"", () => {
    const option = t('rules.perSwap', { amount: '10¢' }, 'es')
    expect(option).toBe('Agregar 10¢ a cada swap')
    expect(t('home.preview.perSwap', { amount: '$1,00' }, 'es')).toContain(`"${option.replace('¢', '¢')}"`)
  })
})

describe('the area in Spanish, through the same functions', () => {
  it('the week line: none, one swap, several, with Spanish money', () => {
    writeLangChoice('es')
    expect(weekLine([], now)).toBe('Aún no hay redondeos esta semana.')
    expect(weekLine([{ ts: at(0.5), roundupCents: 35 }], now)).toBe('Esta semana: 1 swap, $0,35 de cambio.')
    expect(weekLine([{ ts: at(1), roundupCents: 100 }, { ts: at(2), roundupCents: 54 }], now)).toBe('Esta semana: 2 swaps, $1,54 de cambio.')
  })
  it('the SKR amount: problems in Spanish, Max with a decimal comma that the field reads back', () => {
    writeLangChoice('es')
    const held = 34_910_172n
    expect(amountProblem('x', held)).toBe('Escribe un monto en SKR.')
    expect(amountProblem('0,5', held)).toBe('El retiro mínimo es de 1 SKR.')
    expect(amountProblem('99', held)).toBe('Eso es más de lo que tiene tu jardín.')
    expect(maxAmountText(held)).toBe('34,910172')
    expect(maxAmountText(2_000_000n)).toBe('2')
    expect(parseSkr(maxAmountText(held))).toBe(held)
    expect(amountProblem(maxAmountText(held), held)).toBeNull()
    expect(maxAmountText(held, 'en')).toBe('34.910172')
  })
  it('the lending amount: the smallest withdrawal with a decimal comma, Max read back, the screen lines', () => {
    writeLangChoice('es')
    const kamino = FIXTURE_POSITIONS[0]
    expect(lendAmountProblem('0,001', kamino)).toBe('El retiro mínimo es de 0,01 USDC.')
    expect(lendAmountProblem('0.00001', FIXTURE_POSITIONS[2])).toBe('El retiro mínimo es de 0,0001 SOL.')
    expect(lendAmountProblem('?', kamino)).toBe('Escribe un monto en USDC.')
    expect(lendMaxText(kamino)).toBe('1,999752')
    expect(parseCoinAmount(lendMaxText(kamino), 6)).toBe(BigInt(kamino.underlyingRaw))
    const lines = lendScreenLines(kamino)
    expect(lines.title).toBe('Retirar USDC de Kamino')
    expect(lines.venue).toBe('De Kamino de vuelta a tu billetera como USDC.')
    expect(lines.notes).toEqual(['Lo que queda sigue ganando.', 'Una plataforma puede pausar los retiros cuando su fondo está prestado por completo; tu dinero sigue siendo tuyo.'])
    expect(POOL_FULL_LINE).toBe(en['lend.poolFull'])   // the constant stays English
  })
  it("Withdraw's list: locked SKR, the basket today or on a day, a wallet coin", () => {
    writeLangChoice('es')
    const hsol = { asset: 'hSOL', heldRaw: '12300000', putInCents: 203, valueUsd: 2.07, earnedUsd: 0.04, earnedUnderlyingRaw: '1' } as const
    const rows = withdrawRows({ pot, basket: null, holdings: [hsol] })
    expect(rows[0]).toMatchObject({ label: 'Retirar SKR', note: 'bloqueado en tu Seed Vault, 48 horas para salir' })
    expect(rows[1].note).toBe('en tu billetera. Intercámbialo o envíalo desde la app de tu billetera.')
    const basket = { id: 'b', asset: 'SKR', amountRaw: '1000000', unstakeTs: '2026-10-02T12:00:00Z', readyAt: '2026-10-04T12:00:00Z', delivered: false, deliveredSignature: null } as const
    const [later] = withdrawRows({ pot: { ...pot, skrStakedRaw: '0' }, basket, holdings: [] }, new Date('2026-10-03T00:00:00Z'))
    expect(later.note).toMatch(/^en la canasta, llega el [45] oct, \d{1,2}:00$/)
    const [today] = withdrawRows({ pot: { ...pot, skrStakedRaw: '0' }, basket, holdings: [] }, new Date('2026-10-04T13:00:00Z'))
    expect(today.note).toBe('en la canasta, llega hoy')
  })
  it('the venue lines: rate with and without rewards, the average or one day measured, the state, Spanish percents', () => {
    writeLangChoice('es')
    const lines = venueLines(FIXTURE_VENUES)
    expect(lines[0]).toMatchObject({ title: 'USDC en Kamino', detail: 'Esta mañana 4,43%, 7 días 4,41%. La elegida de hoy.' })
    expect(lines[1].detail).toBe('Esta mañana 3,83% + 0,36% en recompensas, 7 días 3,90%. No elegida hoy.')
    expect(lines[2].detail).toBe('Esta mañana 5,62%, 7 días 5,50%. Omitida hoy: casi prestada por completo.')
    expect(lines[4].detail).toBe('Esta mañana 2,96% + 1,21% en recompensas, medido 1 día. Solo comparada.')
    expect(lines[5].detail).toBe('Rate unavailable. Solo comparada.')   // the API's own note for the venue stays as sent (server text)
    expect(venueLines({ ...FIXTURE_VENUES, venues: [{ ...FIXTURE_VENUES.venues[5], note: null }] })[0].detail).toBe('Tasa no disponible. Solo comparada.')
  })
  it('Rules: the total over and under 100, the undo day, the stop names, the joins line', () => {
    writeLangChoice('es')
    const split = (s: Record<string, number>) => ({ SKR: 0, stORE: 0, USDC_LEND: 0, SOL_LEND: 0, hSOL: 0, cbBTC: 0, ...s })
    expect(splitTotal(split({ SKR: 90, stORE: 15 }))).toMatchObject({ line: 'Total: 105%.', fix: 'Quita 5% de otra moneda para guardar.' })
    expect(splitTotal(split({ SKR: 80, stORE: 10 }))).toMatchObject({ line: 'Total: 90%.', fix: 'Suma 10% a otra moneda para guardar.' })
    expect(undoLine('2026-10-02')).toBe('Cambió el 2 oct.')
    expect(stopLabel('careful')).toBe('Prudente')
    expect(joinsLine({ opening: { waiting: [{ asset: 'cbBTC', afterCents: 2500 }] } } as unknown as MeResponse, 'cbBTC')).toBe('Se suma a tu jardín después de $25 plantados')
    expect(STOP_LINE).toBe(en['manager.stopLine'])
    expect(ROWS_LINE.on).toBe(en['manager.rows.on'])
  })
  it('About Sprouts: six Spanish questions, the English constants unchanged', () => {
    const q = disclosures('es')
    expect(q.map(([h]) => h)).toEqual(['¿Quién tiene mi dinero?', '¿Cuánto cuesta?', '¿A dónde va el préstamo?', '¿Qué significa "ganado"?', '¿Qué puede comprar Sprouts?', '¿Puedo pausarlo o detenerlo?'])
    expect(q[0][1].split('\n\n')).toHaveLength(4)
    expect(q[2][1]).toContain(`"${es['venues.title']}"`)   // the lending answer quotes the Rules panel's own name
    expect(DISCLOSURES).toEqual(disclosures('en'))
    expect(HOW_IT_WORKS).toBe(en['about.how'])
  })
})
