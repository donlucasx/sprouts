import { describe, it, expect, afterEach, vi } from 'vitest'

vi.mock('@/lib/session', () => ({ loadSession: async () => null }))
vi.mock('react-native', () => ({ Platform: { OS: 'android', constants: {} } }))
import { t, writeLangChoice } from '@/i18n'
import { en } from '@/i18n/en'
import { TOPUP, chipLabel } from '@/lib/topup'
import { lowUsdcLine } from '@/lib/usdc-runway'
import { QUESTIONS, optionLabel, questionTitle } from '@/lib/feedback'
import type { Question } from '@/lib/feedback'
import { previewOf, logLine } from '@/lib/support'
import { TERMS_SUMMARY_KEYS, homeTermsSummary, termsSummary } from '@/lib/terms'
import { API_UNANSWERED, apiUnanswered, requestFailed } from '@/lib/api'

// 0.1.13 Spanish pass P6 (e): the top-up, the question cards, Home's Terms lines and the app's own error lines. English stays the
// source (the other tests assert it); these check the variants and that the same calls render Spanish.
afterEach(() => writeLangChoice('auto'))

describe('top-up: the no-USDC card (his ruling 11-27)', () => {
  it('English: Top up, its line, the rows, the greyed reasons; no fee sentence', () => {
    expect(TOPUP.open).toBe('Top up')
    expect(TOPUP.disclaimer).toBe('Adds USDC to this wallet so your round-ups can plant.')
    expect(TOPUP.coinTitle('SKR')).toBe('Use SKR')
    expect(TOPUP.coinLine('SOL')).toBe('Swaps SOL in this wallet for USDC.')
    expect(TOPUP.send).toBe('Send USDC')
    expect(TOPUP.sendLine).toBe('From another wallet or an exchange.')
    expect(TOPUP.greyed('SKR', 'none_here')).toBe('No SKR in this wallet')
    expect(TOPUP.greyed('SOL', 'not_enough')).toBe('Not enough SOL for $5')
    expect(TOPUP.button(1_000)).toBe('Add $10 of USDC')
    expect(TOPUP.copy).toBe('Copy')
    expect(t('home.usdc.zero.mine')).toBe('Seed Vault wallet has no USDC')
    expect(t('home.usdc.zero.line')).toBe('Your round-ups wait until you add some.')
    expect('topup.fee' in en).toBe(false)
  })
  it('Spanish: billetera, swap, Agregar; the existing title kept; no "jardín" (a top-up lands in the wallet, not the garden)', () => {
    writeLangChoice('es')
    expect(TOPUP.open).toBe('Agregar USDC')
    expect(TOPUP.disclaimer).toBe('Agrega USDC a esta billetera para que tus redondeos se planten.')
    expect(TOPUP.coinTitle('SKR')).toBe('Usar SKR')
    expect(TOPUP.coinLine('SKR')).toBe('Hace un swap de SKR de esta billetera a USDC.')
    expect(TOPUP.send).toBe('Enviar USDC')
    expect(TOPUP.sendLine).toBe('Desde otra billetera o un exchange.')
    expect(TOPUP.greyed('SKR', 'none_here')).toBe('No hay SKR en esta billetera')
    expect(TOPUP.greyed('SOL', 'not_enough')).toBe('No alcanza el SOL para $5')
    expect(TOPUP.button(1_000)).toBe('Agregar $10 en USDC')
    expect(TOPUP.copy).toBe('Copiar')
    expect(t('home.usdc.zero.mine')).toBe('La billetera Seed Vault no tiene USDC')
    expect(t('home.usdc.zero.line')).toBe('Tus redondeos esperan hasta que agregues.')
    expect(TOPUP.done(550)).toBe('Tu billetera ahora tiene $5,50 más en USDC. Sprouts vuelve a plantar en la próxima plantación diaria.')
    expect(TOPUP.back).toBe('Volver')
    const lines = [TOPUP.open, TOPUP.disclaimer, TOPUP.coinTitle('SOL'), TOPUP.coinLine('SOL'), TOPUP.send, TOPUP.sendLine, TOPUP.greyed('SOL', 'none_here'), TOPUP.greyed('SKR', 'not_enough'), TOPUP.button(500), TOPUP.copy, TOPUP.done(500), TOPUP.doneLink(500), TOPUP.otherWallet('W111...xyz9')]
    for (const l of lines) {
      expect(l).not.toMatch(/jardín|wallet\b|Swaps|Add |—|–/)
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
    expect(lowUsdcLine(300, 100)).toBe('A tu billetera le quedan $3,00 en USDC. Agrega más a tu billetera para que las plantaciones no se pausen.')
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
