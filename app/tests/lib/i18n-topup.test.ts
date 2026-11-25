import { describe, it, expect, afterEach, vi } from 'vitest'

vi.mock('@/lib/session', () => ({ loadSession: async () => null }))
vi.mock('react-native', () => ({ Platform: { OS: 'android', constants: {} } }))
import { t, writeLangChoice } from '@/i18n'
import { en } from '@/i18n/en'
import { TOPUP, chipLabel } from '@/lib/topup'
import { coverage, lowUsdcLine } from '@/lib/usdc-runway'
import { QUESTIONS, optionLabel, questionTitle } from '@/lib/feedback'
import type { Question } from '@/lib/feedback'
import { previewOf, logLine } from '@/lib/support'
import { TERMS_SUMMARY_KEYS, homeTermsSummary, termsSummary } from '@/lib/terms'
import { API_UNANSWERED, apiUnanswered, requestFailed } from '@/lib/api'

// 0.1.13 Spanish pass P6 (e): the top-up, the question cards, Home's Terms lines and the app's own error lines. English stays the
// source (the other tests assert it); these check the variants and that the same calls render Spanish.
afterEach(() => writeLangChoice('auto'))

describe('top-up: one whole sentence per coverage kind', () => {
  it('coverage picks the kind and count the English always said', () => {
    expect(coverage(500, null)).toBeNull()
    expect(coverage(500, 600)).toEqual({ kind: 'one', n: 1 })
    expect(coverage(500, 100)).toEqual({ kind: 'days', n: 5 })
    expect(coverage(1_400, 100)).toEqual({ kind: 'weeks', n: 2 })
    expect(coverage(10_000, 100)).toEqual({ kind: 'months', n: 2 })
  })
  it('English unchanged for every kind', () => {
    const tail = t('topup.fee', undefined, 'en')
    expect(TOPUP.how(500, { kind: 'one', n: 1 })).toBe(`Swaps SOL already in this wallet for $5 of USDC, about 1 day of round-ups. ${tail}`)
    expect(TOPUP.how(1_000, { kind: 'days', n: 4 }, 'SKR')).toBe(`Swaps SKR already in this wallet for $10 of USDC, about 4 days of round-ups. ${tail}`)
    expect(TOPUP.how(2_500, { kind: 'months', n: 2 })).toBe(`Swaps SOL already in this wallet for $25 of USDC, over 2 months of round-ups. ${tail}`)
  })
  it('Spanish: billetera, Spanish fee line, no "jardín" (a top-up lands in the wallet, not the garden)', () => {
    writeLangChoice('es')
    const lines = [TOPUP.open, TOPUP.button(500), TOPUP.how(500, { kind: 'weeks', n: 2 }), TOPUP.swapsLine(['SOL', 'SKR', 'JUP']), TOPUP.done(500), TOPUP.doneLink(500), TOPUP.sendHere, TOPUP.otherWallet('W111...xyz9')]
    expect(TOPUP.open).toBe('Agregar USDC')
    expect(TOPUP.button(1_000)).toBe('Agregar $10 en USDC')
    expect(TOPUP.how(500, { kind: 'weeks', n: 2 })).toBe('Hace un swap de SOL que ya está en esta billetera por $5 en USDC, alcanza para cerca de 2 semanas de redondeos. Sprouts cobra 0,5% al plantar.')
    expect(TOPUP.swapsLine(['SOL', 'SKR', 'JUP'])).toBe('Hace un swap de un poco de tu SOL, SKR o JUP a USDC. Sprouts cobra 0,5% al plantar.')
    expect(TOPUP.swapsLine([])).toBe('Hace un swap de un poco de tu SOL a USDC. Sprouts cobra 0,5% al plantar.')
    expect(TOPUP.done(550)).toBe('Tu billetera ahora tiene $5,50 más en USDC. Sprouts vuelve a plantar en la próxima plantación diaria.')
    expect(TOPUP.back).toBe('Volver')
    for (const l of lines) {
      expect(l).not.toMatch(/jardín|wallet\b|Swaps|Add /)
    }
  })
  it('the amount chips use the formatter: whole dollars, Spanish separators when there are cents', () => {
    expect([500, 1_000, 2_500].map((c) => chipLabel(c))).toEqual(['$5', '$10', '$25'])
    expect(chipLabel(750)).toBe('$7.50')
    writeLangChoice('es')
    expect(chipLabel(750)).toBe('$7,50')
    expect(chipLabel(500)).toBe('$5')
  })
  it('the low-USDC lines', () => {
    expect(lowUsdcLine(300, 100)).toBe("Your wallet has $3.00 of USDC left. Top it up so plantings don't pause.")
    writeLangChoice('es')
    expect(lowUsdcLine(0, null)).toBe('Tu billetera no tiene USDC, así que no se planta nada hasta que agregues. Tus redondeos se siguen contando.')
    expect(lowUsdcLine(300, 100)).toBe('A tu billetera le quedan $3,00 en USDC. Agrega más para que las plantaciones no se pausen.')
  })
})

describe('question cards', () => {
  const qs = Object.keys(QUESTIONS) as Question[]
  it('every title and option has its line, the English the same as QUESTIONS', () => {
    for (const q of qs) {
      expect(questionTitle(q)).toBe(QUESTIONS[q].title)
      for (const o of QUESTIONS[q].options) expect(optionLabel(q, o.value)).toBe(o.label)
    }
  })
  it('Spanish for every title and option, none left as a key or English', () => {
    writeLangChoice('es')
    for (const q of qs) {
      expect(questionTitle(q)).not.toBe(QUESTIONS[q].title)
      for (const o of QUESTIONS[q].options) expect(optionLabel(q, o.value)).not.toBe(o.label)
    }
    expect(questionTitle('wallet_removed')).toBe('Antes de irte: ¿por qué la quitaste?')
    expect(optionLabel('link_failed', 'other')).toBe('Otra cosa')
  })
  it('the Message us log shows an answer in the current language', () => {
    const e = { ref: 'S-7K3Q', ts: '2026-11-01T12:00:00Z', topic: 'link_failed', preview: 'it closed', choice: 'closed_itself' }
    expect(previewOf(e)).toBe('The screen closed by itself: it closed')
    writeLangChoice('es')
    expect(previewOf(e)).toBe('La pantalla se cerró sola: it closed')
    expect(previewOf({ ...e, preview: '' })).toBe('La pantalla se cerró sola')
    expect(logLine(e)).toContain('¿Qué pasó?')
  })
})

describe("Home's Terms lines and the app's own error lines", () => {
  it('the en summary keys are the Terms text word for word', () => {
    expect(TERMS_SUMMARY_KEYS.map((k) => en[k])).toEqual(termsSummary())
    expect(homeTermsSummary()).toEqual(termsSummary())
  })
  it('Spanish on Home', () => {
    writeLangChoice('es')
    const s = homeTermsSummary()
    expect(s).toHaveLength(3)
    expect(s[2]).toContain('0,5%')
  })
  it('api lines: English constant for tests, Spanish when shown', () => {
    expect(apiUnanswered()).toBe(API_UNANSWERED)
    expect(requestFailed(404)).toBe('Request failed (404).')
    writeLangChoice('es')
    expect(apiUnanswered()).toBe('Sprouts no respondió. Revisa tu jardín en un minuto.')
    expect(requestFailed(404)).toBe('La solicitud falló (404).')
  })
})
