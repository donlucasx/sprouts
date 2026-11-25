import { describe, it, expect, beforeEach } from 'vitest'
import { stub } from '../stubs/expo-localization'
import { currentLang, langSignal, phoneLanguage, readLangChoice, t, writeLangChoice } from '@/i18n'
import { en } from '@/i18n/en'
import { es } from '@/i18n/es'

// 0.1.13 (his ruling 11-24): Spanish, the phone's language by default, a pinned choice in Settings, English fallback.
describe('i18n', () => {
  beforeEach(() => { stub.languageCode = 'en'; writeLangChoice('auto') })
  it('follows the phone: Spanish phone -> es, any other -> en', () => {
    stub.languageCode = 'es'
    expect(currentLang()).toBe('es')
    stub.languageCode = 'pt'
    expect(currentLang()).toBe('en')
    stub.languageCode = null
    expect(currentLang()).toBe('en')
  })
  it('a pinned choice wins over the phone, and auto clears it', () => {
    stub.languageCode = 'es'
    writeLangChoice('en')
    expect(readLangChoice()).toBe('en')
    expect(currentLang()).toBe('en')
    writeLangChoice('auto')
    expect(currentLang()).toBe('es')
  })
  it('t() reads the language, falls back to English for a missing line, fills placeholders', () => {
    expect(t('settings.language', undefined, 'es')).toBe('Idioma')
    expect(t('settings.language', undefined, 'en')).toBe('Language')
    const withEs = es as Record<string, string>
    const saved = withEs['settings.language']
    delete withEs['settings.language']
    try { expect(t('settings.language', undefined, 'es')).toBe('Language') } finally { withEs['settings.language'] = saved }
  })
  it('every Spanish key exists in English (no orphan lines)', () => {
    for (const k of Object.keys(es)) expect(Object.keys(en)).toContain(k)
  })
  it('the sign-in signal is the phone code only, never the pinned choice', () => {
    stub.languageCode = 'es'
    writeLangChoice('en')
    expect(langSignal()).toEqual({ lang: 'es' })
    stub.languageCode = null
    expect(langSignal()).toEqual({})
    expect(phoneLanguage()).toBeNull()
  })
})
